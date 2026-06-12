import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSession,
  deleteSession,
  eventsUrl,
  listSessionTasks,
  listSessions,
  listTasks,
  permanentlyDeleteSession,
  restartSession,
  restoreSession,
  resumeSession,
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
type SessionListMode = 'active' | 'deleted';

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<SessionListMode>('active');
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
  const [isListLoading, setIsListLoading] = useState(false);
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
  const listRefreshIdRef = useRef(0);
  const skipNextListRefresh = useRef(false);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );
  const activeEvents = useMemo(
    () => (activeId ? events[activeId] ?? [] : []),
    [activeId, events]
  );
  const displayableEvents = useMemo(
    () => activeEvents.filter((event) => event.kind !== 'raw' && event.kind !== 'system'),
    [activeEvents]
  );
  const visibleEvents = useMemo(
    () => displayableEvents.slice(-EVENT_RENDER_LIMIT),
    [displayableEvents]
  );
  const activeBlocks = useMemo(
    () => buildConversationBlocks(visibleEvents),
    [visibleEvents]
  );
  const hiddenEventCount = displayableEvents.length - visibleEvents.length;
  const isActiveSessionMode = listMode === 'active' && !activeSession?.deletedAt;

  const recentDirectories = useMemo(() => {
    const seen = new Set<string>();
    return [...sessions]
      .filter((session) => !session.deletedAt)
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
    if (listMode !== 'active') {
      skipNextListRefresh.current = false;
      setListMode('active');
    }
    setActiveId(task.sessionId);
    setPendingEventId(task.startEventId);
  }

  useEffect(() => {
    if (skipNextListRefresh.current) {
      skipNextListRefresh.current = false;
      return;
    }
    const refreshId = ++listRefreshIdRef.current;
    setIsListLoading(true);
    setSessions([]);
    setActiveId(null);
    listSessions({ deletedOnly: listMode === 'deleted' })
      .then((loaded) => {
        if (refreshId !== listRefreshIdRef.current) return;
        setSessions(loaded);
        setActiveId(loaded[0]?.id ?? null);
        if (listMode === 'active') void refreshTasks();
      })
      .catch((err: unknown) => {
        if (refreshId !== listRefreshIdRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (refreshId !== listRefreshIdRef.current) return;
        setIsListLoading(false);
      });
  }, [listMode, refreshTasks]);

  useEffect(() => {
    activeIdRef.current = activeId;
    setSessionTaskError(null);
    sessionTaskRefreshIdRef.current += 1;
    void refreshTasks();
    if (!activeId || listMode === 'deleted') {
      setSessionTasks(emptyTaskGroups);
      return;
    }
    setSessionTasks(emptyTaskGroups);
    void refreshSessionTasks(activeId);
  }, [activeId, listMode, refreshTasks, refreshSessionTasks]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshTasks();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshTasks]);

  useEffect(() => {
    if (!activeSession || !isActiveSessionMode) return;
    if (activeSession.status !== 'running' && activeSession.status !== 'starting') return;
    const sessionId = activeSession.id;
    const afterId = events[sessionId]?.at(-1)?.id ?? 0;
    const socket = new WebSocket(eventsUrl(sessionId, afterId));
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as UiEvent;
      setEvents((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), event]
      }));
      void refreshTasks();
      void refreshSessionTasks(sessionId);
    };
    socket.onclose = () => undefined;
    return () => socket.close();
  }, [activeSession?.id, activeSession?.status, activeSession?.updatedAt, isActiveSessionMode, refreshTasks, refreshSessionTasks]);

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
      if (listMode === 'deleted') {
        skipNextListRefresh.current = true;
        setListMode('active');
        setSessions([created]);
      } else {
        setSessions((current) => [created, ...current]);
      }
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
    if (!activeId || !message.trim() || !isActiveSessionMode) return;
    const text = message;
    setError(null);
    setMessage('');
    closeAutocomplete();
    try {
      await sendInput(activeId, text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setMessage(text);
      refreshAutocomplete(text, text.length);
    }
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
    const sessionId = activeId;
    setError(null);
    try {
      const restarted = await restartSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? restarted : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      void refreshTasks();
      void refreshSessionTasks(sessionId);
    }
  }

  async function onResume() {
    if (!activeId) return;
    const sessionId = activeId;
    setError(null);
    try {
      const resumed = await resumeSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? resumed : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      void refreshTasks();
      void refreshSessionTasks(sessionId);
    }
  }

  function removeSessionFromCurrentList(removedId: string) {
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== removedId);
      setActiveId((currentActiveId) => {
        if (currentActiveId !== removedId && remaining.some((session) => session.id === currentActiveId)) {
          return currentActiveId;
        }
        return remaining[0]?.id ?? null;
      });
      return remaining;
    });
  }

  async function onDelete() {
    if (!activeId) return;
    const removedId = activeId;
    if (!confirm('Delete this session? It can be restored from Deleted sessions.')) return;
    setError(null);
    try {
      await deleteSession(removedId);
      removeSessionFromCurrentList(removedId);
      void refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestore() {
    if (!activeId) return;
    const restoredId = activeId;
    setError(null);
    try {
      await restoreSession(restoredId);
      removeSessionFromCurrentList(restoredId);
      void refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPermanentDelete() {
    if (!activeId) return;
    const removedId = activeId;
    if (!confirm('Permanently delete this session and its local event logs? This cannot be undone.')) return;
    setError(null);
    try {
      await permanentlyDeleteSession(removedId);
      removeSessionFromCurrentList(removedId);
      setEvents((current) => {
        const next = { ...current };
        delete next[removedId];
        return next;
      });
      void refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function renderActions() {
    if (!activeSession) return null;
    if (listMode === 'deleted' || activeSession.deletedAt) {
      return (
        <div className="actions">
          <button onClick={onRestore}>Restore</button>
          <button className="danger" onClick={onPermanentDelete}>Permanently delete</button>
        </div>
      );
    }

    if (activeSession.status === 'running') {
      return (
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
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      );
    }

    if (activeSession.status === 'starting') {
      return (
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
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      );
    }

    return (
      <div className="actions">
        <button onClick={onResume}>Resume</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    );
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
          <button className="primary-action" type="submit">Create session</button>
        </form>
        <div className="session-modes" role="group" aria-label="Session list mode">
          <button
            type="button"
            className={listMode === 'active' ? 'selected' : undefined}
            aria-pressed={listMode === 'active'}
            onClick={() => setListMode('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={listMode === 'deleted' ? 'selected' : undefined}
            aria-pressed={listMode === 'deleted'}
            onClick={() => setListMode('deleted')}
          >
            Deleted
          </button>
        </div>
        <section className="sessions">
          <h2>{listMode === 'deleted' ? 'Deleted sessions' : 'Sessions'}</h2>
          {isListLoading && <p className="muted">Loading sessions...</p>}
          {!isListLoading && sessions.length === 0 && <p className="muted">{listMode === 'deleted' ? 'No deleted sessions.' : 'No sessions yet.'}</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.name || session.cwd}</strong>
              <span className="session-path" title={session.cwd}>{session.cwd}</span>
              {session.worktree && <span className="session-path" title={session.worktree.branch}>{session.worktree.branch}</span>}
              <em className={`status status-${session.status}`}>{session.status}</em>
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
                <span className="eyebrow">{listMode === 'deleted' ? 'Deleted Claude session' : 'Remote Claude session'}</span>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p title={activeSession.cwd}>{activeSession.cwd}</p>
                {activeSession.worktree && (
                  <div className="worktree-meta">
                    <span>Source: {activeSession.worktree.sourceCwd}</span>
                    <span>Branch: {activeSession.worktree.branch}</span>
                  </div>
                )}
              </div>
              {renderActions()}
            </header>
            {listMode === 'deleted' && (
              <p className="deleted-note">This session is deleted. Restore it before resuming work or sending messages.</p>
            )}
            {isActiveSessionMode && (
              <TasksPanel
                title="Session tasks"
                tasks={sessionTasks}
                error={sessionTaskError}
                compact
                onSelectTask={onSelectTask}
              />
            )}
            <div className="events" ref={eventsRef}>
              {hiddenEventCount > 0 && (
                <div className="event-limit-note">
                  Showing latest {EVENT_RENDER_LIMIT} events. {hiddenEventCount} older events hidden.
                </div>
              )}
              <ConversationBlockList blocks={activeBlocks} />
            </div>
            {isActiveSessionMode && activeSession.status === 'running' && (
              <form className="composer" onSubmit={onSend} ref={composerRef}>
                <div className="composer-input">
                  <label>
                    Message
                    <textarea
                      ref={messageInputRef}
                      value={message}
                      placeholder="Ask Claude to inspect, edit, test, or explain..."
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
                <button className="send-button" type="submit">Send</button>
              </form>
            )}
          </>
        ) : (
          <div className="empty-state">Create or select a session.</div>
        )}
      </section>
    </main>
  );
}
