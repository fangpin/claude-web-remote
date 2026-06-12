import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createSession, eventsUrl, listSessions, restartSession, sendInput, stopSession } from './api';
import EventCard from './EventCard';
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
import type { SessionInfo, UiEvent } from './types';
import './App.css';

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [permissionMode, setPermissionMode] = useState('acceptEdits');
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [autocompleteToken, setAutocompleteToken] = useState<SlashCommandToken | null>(null);
  const [suggestions, setSuggestions] = useState<ClaudeCommand[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  function refreshAutocomplete(value: string, cursor: number | null | undefined) {
    const token = findSlashCommandToken(value, cursor);
    const nextSuggestions = token ? getCommandSuggestions(token.query) : [];
    setAutocompleteToken(token && nextSuggestions.length > 0 ? token : null);
    setSuggestions(nextSuggestions);
    setActiveSuggestionIndex(0);
  }

  function closeAutocomplete() {
    setAutocompleteToken(null);
    setSuggestions([]);
    setActiveSuggestionIndex(0);
  }

  useEffect(() => {
    listSessions()
      .then((loaded) => {
        setSessions(loaded);
        setActiveId(loaded[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const afterId = events[activeId]?.at(-1)?.id ?? 0;
    const socket = new WebSocket(eventsUrl(activeId, afterId));
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as UiEvent;
      setEvents((current) => ({
        ...current,
        [activeId]: [...(current[activeId] ?? []), event]
      }));
    };
    socket.onclose = () => undefined;
    return () => socket.close();
  }, [activeId]);

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        name: name.trim() || undefined,
        permissionMode
      });
      setSessions((current) => [created, ...current]);
      setActiveId(created.id);
      setCwd('');
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !message.trim()) return;
    const text = message;
    setMessage('');
    closeAutocomplete();
    await sendInput(activeId, text);
  }

  function completeSuggestion(suggestion: ClaudeCommand) {
    if (!autocompleteToken) return;
    const completed = applyCommandCompletion(message, autocompleteToken, suggestion.name);
    setMessage(completed.value);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  }

  function completeActiveSuggestion() {
    const suggestion = suggestions[activeSuggestionIndex];
    if (!suggestion) return;
    completeSuggestion(suggestion);
  }

  function onMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length > 0 && autocompleteToken) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }

      if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        completeActiveSuggestion();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeAutocomplete();
        return;
      }
    }

    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function onStop() {
    if (!activeId) return;
    await stopSession(activeId);
    setSessions((current) => current.map((session) => session.id === activeId ? { ...session, status: 'stopped' } : session));
  }

  async function onRestart() {
    if (!activeId) return;
    const restarted = await restartSession(activeId);
    setSessions((current) => current.map((session) => session.id === activeId ? restarted : session));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>Claude Remote Web</h1>
        <form className="new-session" onSubmit={onCreateSession}>
          <label>
            Working directory
            <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
          </label>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Permission mode
            <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
              <option value="acceptEdits">acceptEdits</option>
              <option value="auto">auto</option>
              <option value="default">default</option>
            </select>
          </label>
          <button type="submit">Create session</button>
        </form>
        <section className="sessions">
          {sessions.length === 0 && <p>No sessions yet.</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.name || session.cwd}</strong>
              <span>{session.cwd}</span>
              <em>{session.status}</em>
            </button>
          ))}
        </section>
      </aside>
      <section className="conversation">
        {error && <p role="alert" className="error">{error}</p>}
        {activeSession ? (
          <>
            <header className="conversation-header">
              <div>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p>{activeSession.cwd}</p>
              </div>
              <div className="actions">
                <button onClick={onStop}>Stop</button>
                <button onClick={onRestart}>Restart</button>
              </div>
            </header>
            <div className="events">
              {(events[activeSession.id] ?? []).map((event, index) => (
                <EventCard key={`${event.id}-${index}`} event={event} />
              ))}
            </div>
            <form className="composer" onSubmit={onSend}>
              <div className="composer-input">
                <label>
                  Message
                  <textarea
                    ref={messageInputRef}
                    value={message}
                    onChange={(event) => {
                      setMessage(event.target.value);
                      refreshAutocomplete(event.target.value, event.target.selectionStart);
                    }}
                    onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                    onKeyDown={onMessageKeyDown}
                    rows={3}
                  />
                </label>
                {suggestions.length > 0 && autocompleteToken && (
                  <div className="autocomplete" role="listbox" aria-label="Claude command suggestions">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={suggestion.name}
                        type="button"
                        role="option"
                        aria-selected={index === activeSuggestionIndex}
                        className={index === activeSuggestionIndex ? 'autocomplete-option active' : 'autocomplete-option'}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => completeSuggestion(suggestion)}
                      >
                        <strong>{suggestion.name}</strong>
                        <span>{suggestion.description}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="submit">Send</button>
            </form>
          </>
        ) : (
          <div className="empty-state">Create or select a session.</div>
        )}
      </section>
    </main>
  );
}
