import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveSession,
  createSession,
  deleteSession,
  eventsUrl,
  listSessionTasks,
  listSessions,
  listTasks,
  restartSession,
  resumeSession,
  sendInput,
  stopAndRemoveWorktree,
  stopSession,
  unarchiveSession
} from './api';
import ConfigView from './ConfigView';
import ConversationBlockList from './ConversationBlockList';
import { buildConversationBlocks } from './conversationBlocks';
import TasksPanel from './TasksPanel';
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
import type { SessionInfo, TaskGroups, TaskInfo, UiEvent } from './types';
import './App.css';

const emptyTaskGroups: TaskGroups = { background: [], finished: [] };
const EVENT_RENDER_LIMIT = 80;
type SessionListMode = 'active' | 'archived';
type AppView = 'sessions' | 'config';

const runtimeStatusLabels = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting for you',
  ended: 'Ended',
  exited: 'Ended',
  stopped: 'Stopped',
  failed: 'Failed'
};

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<SessionListMode>('active');
  const [view, setView] = useState<AppView>('sessions');
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'session' | 'global' | 'details'>('session');
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
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
  const displayableEvents = activeEvents;
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

  const refreshSessions = useCallback(async (mode: SessionListMode, options: { reset?: boolean } = {}) => {
    const refreshId = ++listRefreshIdRef.current;
    if (options.reset) {
      setIsListLoading(true);
      setSessions([]);
      setActiveId(null);
    }
    try {
      const loaded = await listSessions({ archivedOnly: mode === 'archived' });
      if (refreshId !== listRefreshIdRef.current) return;
      setSessions(loaded);
      if (options.reset) {
        setActiveId(loaded[0]?.id ?? null);
      } else {
        setActiveId((currentActiveId) => {
          if (!currentActiveId) return loaded[0]?.id ?? null;
          return loaded.some((session) => session.id === currentActiveId) ? currentActiveId : loaded[0]?.id ?? null;
        });
      }
      if (mode === 'active') void refreshTasks();
    } catch (err: unknown) {
      if (refreshId !== listRefreshIdRef.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshId !== listRefreshIdRef.current) return;
      if (options.reset) setIsListLoading(false);
    }
  }, [refreshTasks]);

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
    void refreshSessions(listMode, { reset: true });
  }, [listMode, refreshSessions]);

  useEffect(() => {
    activeIdRef.current = activeId;
    setSessionTaskError(null);
    sessionTaskRefreshIdRef.current += 1;
    void refreshTasks();
    if (!activeId || listMode === 'archived') {
      setSessionTasks(emptyTaskGroups);
      return;
    }
    setSessionTasks(emptyTaskGroups);
    void refreshSessionTasks(activeId);
  }, [activeId, listMode, refreshTasks, refreshSessionTasks]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshTasks();
      if (listMode === 'active') {
        void refreshSessions('active');
      }
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [listMode, refreshSessions, refreshTasks]);

  useEffect(() => {
    if (!activeSession || !isActiveSessionMode) return;
    if (activeSession.status !== 'running' && activeSession.status !== 'starting') return;
    const sessionId = activeSession.id;
    let socket: WebSocket | null = null;
    const connectTimeoutId = window.setTimeout(() => {
      if (activeIdRef.current !== sessionId) return;
      const afterId = events[sessionId]?.at(-1)?.id ?? 0;
      socket = new WebSocket(eventsUrl(sessionId, afterId));
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
    }, 0);
    return () => {
      window.clearTimeout(connectTimeoutId);
      socket?.close();
    };
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
      if (listMode === 'archived') {
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
      setIsNewSessionOpen(false);
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
          return { ...session, cwd: session.worktree.sourceCwd, status: 'stopped', runtimeStatus: 'stopped', worktree: null };
        }
        return { ...session, status: 'stopped', runtimeStatus: 'stopped' };
      }));
    } catch (err: unknown) {
      if (removeWorktree) {
        setSessions((current) => current.map((session) => (
          session.id === sessionId ? { ...session, status: 'stopped', runtimeStatus: 'stopped' } : session
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

  async function onArchive() {
    if (!activeId) return;
    const archivedId = activeId;
    if (!confirm('Archive this session? It will be hidden from active sessions while keeping local data.')) return;
    setError(null);
    try {
      await archiveSession(archivedId);
      removeSessionFromCurrentList(archivedId);
      void refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onUnarchive() {
    if (!activeId) return;
    const unarchivedId = activeId;
    setError(null);
    try {
      await unarchiveSession(unarchivedId);
      removeSessionFromCurrentList(unarchivedId);
      void refreshTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete() {
    if (!activeId) return;
    const removedId = activeId;
    if (!confirm('Delete this archived session and its local event logs? This cannot be undone.')) return;
    setError(null);
    try {
      await deleteSession(removedId);
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

  function onInspectorTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs: Array<typeof inspectorTab> = ['session', 'global', 'details'];
    const currentIndex = tabs.indexOf(inspectorTab);
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setInspectorTab(tabs[nextIndex]);
    document.getElementById(`inspector-tab-${tabs[nextIndex]}`)?.focus();
  }

  function renderActions() {
    if (!activeSession) return null;
    if (listMode === 'archived' || activeSession.deletedAt) {
      return (
        <div className="actions">
          <button onClick={onUnarchive}>Unarchive</button>
          <button className="danger" onClick={onDelete}>Delete</button>
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
          <button className="danger" onClick={onArchive}>Archive</button>
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
          <button className="danger" onClick={onArchive}>Archive</button>
        </div>
      );
    }

    return (
      <div className="actions">
        <button onClick={onResume}>Resume</button>
        <button className="danger" onClick={onArchive}>Archive</button>
      </div>
    );
  }

  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
      <nav className="primary-rail" aria-label="Primary navigation">
        <div className="rail-brand" aria-label="Claude Remote Web">CRW</div>
        <button
          type="button"
          aria-current={view === 'sessions' && listMode === 'active' ? 'page' : 'false'}
          className={view === 'sessions' && listMode === 'active' ? 'active' : ''}
          onClick={() => {
            setView('sessions');
            setListMode('active');
          }}
        >
          Sessions
        </button>
        <button type="button" aria-current={view === 'config' ? 'page' : 'false'} className={view === 'config' ? 'active' : ''} onClick={() => setView('config')}>Config</button>
        <button
          type="button"
          aria-current={listMode === 'archived' && view === 'sessions' ? 'page' : 'false'}
          aria-label="Archived sessions"
          className={listMode === 'archived' && view === 'sessions' ? 'active' : ''}
          onClick={() => {
            setView('sessions');
            setListMode('archived');
          }}
        >
          Archived
        </button>
      </nav>

      {view === 'sessions' && (
        <aside className="session-sidebar" aria-label="Session navigation">
          <div className="sidebar-header">
            <div>
              <h1>Claude Remote Web</h1>
              <p>Remote Claude sessions</p>
            </div>
            <button type="button" className="primary-action" onClick={() => setIsNewSessionOpen((open) => !open)}>
              New chat
            </button>
          </div>

          {isNewSessionOpen && (
            <form className="new-session-panel" onSubmit={onCreateSession}>
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
                  <option value="bypassPermissions">bypassPermissions</option>
                  <option value="acceptEdits">acceptEdits</option>
                  <option value="auto">auto</option>
                  <option value="default">default</option>
                </select>
              </label>
              <button className="primary-action" type="submit">Create session</button>
            </form>
          )}

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
              className={listMode === 'archived' ? 'selected' : undefined}
              aria-pressed={listMode === 'archived'}
              onClick={() => setListMode('archived')}
            >
              Archived
            </button>
          </div>

          <section className="sessions">
            <h2>{listMode === 'archived' ? 'Archived sessions' : 'Sessions'}</h2>
            {isListLoading && <p className="muted">Loading sessions...</p>}
            {!isListLoading && sessions.length === 0 && <p className="muted">{listMode === 'archived' ? 'No archived sessions.' : 'No sessions yet.'}</p>}
            {sessions.map((session) => {
              const runtimeStatus = session.runtimeStatus ?? session.status;
              return (
                <button
                  key={session.id}
                  className={session.id === activeId ? 'session active' : 'session'}
                  onClick={() => setActiveId(session.id)}
                >
                  <strong>{session.name || session.cwd}</strong>
                  <span className="session-path" title={session.cwd}>{session.cwd}</span>
                  {session.worktree && <span className="session-path" title={session.worktree.branch}>{session.worktree.branch}</span>}
                  <em className={`status status-${runtimeStatus}`}>{runtimeStatusLabels[runtimeStatus]}</em>
                </button>
              );
            })}
          </section>
        </aside>
      )}

      {view === 'config' ? (
        <main className="workspace config-workspace" aria-label="Configuration workspace">
          <ConfigView />
        </main>
      ) : (
        <main className={listMode === 'archived' ? 'workspace conversation-workspace with-deleted-note' : 'workspace conversation-workspace'} aria-label="Conversation workspace">
          {error && <p role="alert" className="error">{error}</p>}
          {activeSession ? (
            <>
              <header className="conversation-header">
                <div>
                  <span className="eyebrow">{listMode === 'archived' ? 'Archived Claude session' : 'Remote Claude session'}</span>
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
              {listMode === 'archived' && (
                <p className="deleted-note">This session is archived. Unarchive it before resuming work or sending messages.</p>
              )}
              <div className="events" ref={eventsRef}>
                <div className="conversation-content">
                  {hiddenEventCount > 0 && (
                    <div className="event-limit-note">
                      Showing latest {EVENT_RENDER_LIMIT} events. {hiddenEventCount} older events hidden.
                    </div>
                  )}
                  <ConversationBlockList blocks={activeBlocks} />
                </div>
              </div>
              {isActiveSessionMode && activeSession.status === 'running' && (
                <form className="composer" onSubmit={onSend} ref={composerRef} aria-label="Message composer">
                  <div className="composer-input">
                    <label className="sr-only" htmlFor="message-input">Message</label>
                    <textarea
                      id="message-input"
                      ref={messageInputRef}
                      value={message}
                      aria-label="Message"
                      placeholder="Ask Claude to inspect, edit, test, or explain..."
                      onChange={(event) => {
                        setMessage(event.target.value);
                        refreshAutocomplete(event.target.value, event.target.selectionStart);
                      }}
                      onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onKeyDown={onMessageKeyDown}
                      rows={3}
                    />
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
        </main>
      )}

      {view === 'sessions' && (
        <aside className="inspector" aria-label="Session inspector">
          <header className="inspector-header">
            <div>
              <h2>Inspector</h2>
              <p>{activeSession ? activeSession.name || activeSession.cwd : 'No session selected'}</p>
            </div>
            <button type="button" onClick={() => setIsInspectorOpen((open) => !open)}>
              {isInspectorOpen ? 'Hide' : 'Show'}
            </button>
          </header>
          {isInspectorOpen && (
            <>
              <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
                <button type="button" id="inspector-tab-session" role="tab" aria-selected={inspectorTab === 'session'} aria-controls="inspector-panel-session" tabIndex={inspectorTab === 'session' ? 0 : -1} onClick={() => setInspectorTab('session')} onKeyDown={onInspectorTabKeyDown}>Session tasks</button>
                <button type="button" id="inspector-tab-global" role="tab" aria-selected={inspectorTab === 'global'} aria-controls="inspector-panel-global" tabIndex={inspectorTab === 'global' ? 0 : -1} onClick={() => setInspectorTab('global')} onKeyDown={onInspectorTabKeyDown}>All tasks</button>
                <button type="button" id="inspector-tab-details" role="tab" aria-selected={inspectorTab === 'details'} aria-controls="inspector-panel-details" tabIndex={inspectorTab === 'details' ? 0 : -1} onClick={() => setInspectorTab('details')} onKeyDown={onInspectorTabKeyDown}>Details</button>
              </div>
              <div id="inspector-panel-session" role="tabpanel" aria-labelledby="inspector-tab-session" hidden={inspectorTab !== 'session'}>
                {isActiveSessionMode ? (
                  <TasksPanel title="Session tasks" tasks={sessionTasks} error={sessionTaskError} compact onSelectTask={onSelectTask} />
                ) : (
                  <p className="inspector-empty">No active session tasks.</p>
                )}
              </div>
              <div id="inspector-panel-global" role="tabpanel" aria-labelledby="inspector-tab-global" hidden={inspectorTab !== 'global'}>
                <TasksPanel title="All tasks" tasks={tasks} error={taskError} compact onSelectTask={onSelectTask} />
              </div>
              <section id="inspector-panel-details" role="tabpanel" aria-labelledby="inspector-tab-details" className="session-details" hidden={inspectorTab !== 'details'}>
                {activeSession ? (
                  <>
                    <h3>Session details</h3>
                    <dl>
                      <dt>Status</dt>
                      <dd>{activeSession.status}</dd>
                      <dt>Directory</dt>
                      <dd>{activeSession.cwd}</dd>
                      <dt>Permission mode</dt>
                      <dd>{activeSession.permissionMode}</dd>
                      {activeSession.claudeSessionId && (
                        <>
                          <dt>Claude session</dt>
                          <dd>{activeSession.claudeSessionId}</dd>
                        </>
                      )}
                      {activeSession.worktree && (
                        <>
                          <dt>Worktree branch</dt>
                          <dd>{activeSession.worktree.branch}</dd>
                        </>
                      )}
                    </dl>
                  </>
                ) : (
                  <p className="inspector-empty">No session selected.</p>
                )}
              </section>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
