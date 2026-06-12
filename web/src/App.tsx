import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createSession, eventsUrl, listSessions, restartSession, sendInput, stopSession } from './api';
import EventCard from './EventCard';
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
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

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
    await sendInput(activeId, text);
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
        <div className="brand">
          <h1>Claude Remote Web</h1>
          <p>Remote Claude sessions</p>
        </div>
        <form className="new-session" onSubmit={onCreateSession}>
          <h2>New session</h2>
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
          <button className="primary-action" type="submit">Create session</button>
        </form>
        <section className="sessions">
          <h2>Sessions</h2>
          {sessions.length === 0 && <p className="muted">No sessions yet.</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.name || session.cwd}</strong>
              <span>{session.cwd}</span>
              <em className={`status status-${session.status}`}>{session.status}</em>
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
                <span className="eyebrow">Remote Claude session</span>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p>{activeSession.cwd}</p>
              </div>
              <div className="actions">
                <button onClick={onStop}>Stop</button>
                <button onClick={onRestart}>Restart</button>
              </div>
            </header>
            <div className="events" aria-live="polite">
              {(events[activeSession.id] ?? []).length > 0 ? (
                (events[activeSession.id] ?? []).map((event, index) => (
                  <EventCard key={`${event.id}-${index}`} event={event} />
                ))
              ) : (
                <div className="empty-thread">No events yet.</div>
              )}
            </div>
            <form className="composer" onSubmit={onSend}>
              <label className="composer-field">
                <span className="sr-only">Message Claude</span>
                <textarea
                  aria-label="Message Claude"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Ask Claude to inspect, edit, test, or explain..."
                  rows={3}
                />
              </label>
              <button className="send-button" type="submit">Send</button>
            </form>
          </>
        ) : (
          <div className="empty-state">Create or select a session.</div>
        )}
      </section>
    </main>
  );
}
