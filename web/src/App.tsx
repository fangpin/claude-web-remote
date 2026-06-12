import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession,
  eventsUrl,
  listSessionTasks,
  listSessions,
  listTasks,
  restartSession,
  sendInput,
  stopAndRemoveWorktree,
  stopSession
} from './api';
import ConversationBlockList from './ConversationBlockList';
import { buildConversationBlocks } from './conversationBlocks';
import TasksPanel from './TasksPanel';
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
import type { SessionInfo, TaskGroups, TaskInfo, UiEvent } from './types';
import './App.css';

const emptyTaskGroups: TaskGroups = { background: [], finished: [] };
const EVENT_RENDER_LIMIT = 80;

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [permissionMode, setPermissionMode] = useState('acceptEdits');
  const [useWorktree, setUseWorktree] = useState(false);
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [autocompleteToken, setAutocompleteToken] = useState<SlashCommandToken | null>(null);
  const [suggestions, setSuggestions] = useState<ClaudeCommand[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [sessionTasks, setSessionTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [sessionTaskError, setSessionTaskError] = useState<string | null>(null);
  const [pendingEventId, setPendingEventId] = useState<number | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const eventsRef = useRef<HTMLDivElement | null>(null);
  const taskRefreshIdRef = useRef(0);
  const sessionTaskRefreshIdRef = useRef(0);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );
  const activeEvents = useMemo(
    () => (activeId ? events[activeId] ?? [] : []),
    [activeId, events]
  );
  const visibleEvents = useMemo(
    () => activeEvents.slice(-EVENT_RENDER_LIMIT),
    [activeEvents]
  );
  const activeBlocks = useMemo(
    () => buildConversationBlocks(visibleEvents),
    [visibleEvents]
  );
  const hiddenEventCount = activeEvents.length - visibleEvents.length;

  const recentDirectories = useMemo(() => {
    const seen = new Set<string>();
    return [...sessions]
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .filter((session) => {
        if (seen.has(session.cwd)) return false;
        seen.add(session.cwd);
        return true;
      })
      .slice(0, 5)
      .map((session) => session.cwd);
  }, [sessions]);

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

  const refreshTasks = useCallback(async () => {
    const refreshId = ++taskRefreshIdRef.current;
    try {
      setTaskError(null);
      const loadedTasks = await listTasks();
      if (refreshId !== taskRefreshIdRef.current) return;
      setTasks(loadedTasks);
    } catch (err: unknown) {
      if (refreshId !== taskRefreshIdRef.current) return;
      setTaskError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshSessionTasks = useCallback(async (sessionId: string) => {
    const refreshId = ++sessionTaskRefreshIdRef.current;
    try {
      setSessionTaskError(null);
      const loadedTasks = await listSessionTasks(sessionId);
      if (refreshId !== sessionTaskRefreshIdRef.current || activeIdRef.current !== sessionId) return;
      setSessionTasks(loadedTasks);
    } catch (err: unknown) {
      if (refreshId !== sessionTaskRefreshIdRef.current || activeIdRef.current !== sessionId) return;
      setSessionTasks(emptyTaskGroups);
      setSessionTaskError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  function onSelectTask(task: TaskInfo) {
    setActiveId(task.sessionId);
    setPendingEventId(task.startEventId);
  }

  useEffect(() => {
    listSessions()
      .then((loaded) => {
        setSessions(loaded);
        setActiveId(loaded[0]?.id ?? null);
        void refreshTasks();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [refreshTasks]);

  useEffect(() => {
    activeIdRef.current = activeId;
    setSessionTaskError(null);
    sessionTaskRefreshIdRef.current += 1;
    void refreshTasks();
    if (!activeId) {
      setSessionTasks(emptyTaskGroups);
      return;
    }
    setSessionTasks(emptyTaskGroups);
    void refreshSessionTasks(activeId);
  }, [activeId, refreshTasks, refreshSessionTasks]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshTasks();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshTasks]);

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
      void refreshTasks();
      void refreshSessionTasks(activeId);
    };
    socket.onclose = () => undefined;
    return () => socket.close();
  }, [activeId, refreshTasks, refreshSessionTasks]);

  useEffect(() => {
    if (!activeId) return;
    composerRef.current?.scrollIntoView({ block: 'end' });
  }, [activeId]);

  useEffect(() => {
    const eventsElement = eventsRef.current;
    if (!eventsElement) return;
    eventsElement.scrollTop = eventsElement.scrollHeight;
  }, [activeId, visibleEvents.length]);

  useEffect(() => {
    if (pendingEventId === null) return;
    const element = document.getElementById(`event-${pendingEventId}`);
    if (!element) return;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
    element.classList.add('event-highlight');
    window.setTimeout(() => element.classList.remove('event-highlight'), 1600);
    setPendingEventId(null);
  }, [pendingEventId, activeId, events]);

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        name: name.trim() || undefined,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      setSessions((current) => [created, ...current]);
      setActiveId(created.id);
      setCwd('');
      setName('');
      setUseWorktree(false);
      void refreshTasks();
      void refreshSessionTasks(created.id);
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

  async function onStop(removeWorktree = false) {
    if (!activeId) return;
    const sessionId = activeId;
    setError(null);
    try {
      if (removeWorktree) {
        await stopAndRemoveWorktree(sessionId);
      } else {
        await stopSession(sessionId);
      }
      setSessions((current) => current.map((session) => {
        if (session.id !== sessionId) return session;
        if (removeWorktree && session.worktree) {
          return { ...session, cwd: session.worktree.sourceCwd, status: 'stopped', worktree: null };
        }
        return { ...session, status: 'stopped' };
      }));
    } catch (err: unknown) {
      if (removeWorktree) {
        setSessions((current) => current.map((session) => (
          session.id === sessionId ? { ...session, status: 'stopped' } : session
        )));
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      void refreshTasks();
      void refreshSessionTasks(sessionId);
    }
  }

  async function onRestart() {
    if (!activeId) return;
    const restarted = await restartSession(activeId);
    setSessions((current) => current.map((session) => session.id === activeId ? restarted : session));
    void refreshTasks();
    void refreshSessionTasks(activeId);
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
          {recentDirectories.length > 0 && (
            <div className="directory-suggestions" aria-label="Recent working directories">
              <span>Recent</span>
              {recentDirectories.map((directory) => (
                <button key={directory} type="button" onClick={() => setCwd(directory)} aria-label={`Use ${directory}`}>
                  {directory}
                </button>
              ))}
            </div>
          )}
          <label className="checkbox-label">
            <input type="checkbox" checked={useWorktree} onChange={(event) => setUseWorktree(event.target.checked)} />
            Use git worktree
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
              <span className="session-path" title={session.cwd}>{session.cwd}</span>
              {session.worktree && <span className="session-path" title={session.worktree.branch}>{session.worktree.branch}</span>}
              <em>{session.status}</em>
            </button>
          ))}
        </section>
        <TasksPanel title="Tasks" tasks={tasks} error={taskError} onSelectTask={onSelectTask} />
      </aside>
      <section className="conversation">
        {error && <p role="alert" className="error">{error}</p>}
        {activeSession ? (
          <>
            <header className="conversation-header">
              <div>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p title={activeSession.cwd}>{activeSession.cwd}</p>
                {activeSession.worktree && (
                  <div className="worktree-meta">
                    <span>Source: {activeSession.worktree.sourceCwd}</span>
                    <span>Branch: {activeSession.worktree.branch}</span>
                  </div>
                )}
              </div>
              <div className="actions">
                {activeSession.worktree ? (
                  <>
                    <button onClick={() => onStop(false)}>Stop only</button>
                    {activeSession.worktree.createdByClaudeRemoteWeb && (
                      <button onClick={() => onStop(true)}>Stop and remove worktree</button>
                    )}
                  </>
                ) : (
                  <button onClick={() => onStop(false)}>Stop</button>
                )}
                <button onClick={onRestart}>Restart</button>
              </div>
            </header>
            <TasksPanel
              title="Session tasks"
              tasks={sessionTasks}
              error={sessionTaskError}
              compact
              onSelectTask={onSelectTask}
            />
            <div className="events" ref={eventsRef}>
              {hiddenEventCount > 0 && (
                <div className="event-limit-note">
                  Showing latest {EVENT_RENDER_LIMIT} events. {hiddenEventCount} older events hidden.
                </div>
              )}
              <ConversationBlockList blocks={activeBlocks} />
            </div>
            <form className="composer" onSubmit={onSend} ref={composerRef}>
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
