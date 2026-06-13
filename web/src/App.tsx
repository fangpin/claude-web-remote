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
import AppShell, { runtimeStatusLabels, type AppView, type SessionListMode } from './AppShell';
import ConversationWorkspace from './ConversationWorkspace';
import InspectorPanel, { type InspectorTab } from './InspectorPanel';
import SessionSidebar from './SessionSidebar';
import { buildConversationBlocks } from './conversationBlocks';
import { extractSessionPlan } from './sessionPlan';
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
import type { SessionInfo, TaskGroups, TaskInfo, UiEvent } from './types';
import './App.css';

const emptyTaskGroups: TaskGroups = { background: [], finished: [] };
const EVENT_RENDER_LIMIT = 80;
const MESSAGE_INPUT_MAX_HEIGHT = 220;
const EMPTY_STATE_PROMPTS = [
  'Summarize this repository',
  'Review my current changes',
  'Run the relevant tests',
  'Plan the smallest fix'
];
type ObjectPayload = Record<string, unknown>;
type PendingMessage = {
  id: number;
  text: string;
};

function isObjectPayload(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => (isObjectPayload(entry) && entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null))
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .join('\n');
  return text || null;
}

function textFromEventPayload(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (!isObjectPayload(payload)) return null;
  const directMessage = payload.message;
  if (typeof directMessage === 'string' && directMessage.trim()) return directMessage;
  const directText = payload.text;
  if (typeof directText === 'string' && directText.trim()) return directText;
  const directContent = textFromContent(payload.content);
  if (directContent) return directContent;
  if (isObjectPayload(directMessage)) {
    if (typeof directMessage.text === 'string' && directMessage.text.trim()) return directMessage.text;
    return textFromContent(directMessage.content);
  }
  return null;
}

function normalizedMessageText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function userEventText(event: UiEvent): string | null {
  return event.kind === 'user' ? textFromEventPayload(event.payload) : null;
}

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<SessionListMode>('active');
  const [sessionSearch, setSessionSearch] = useState('');
  const [view, setView] = useState<AppView>('sessions');
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('session');
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const [useWorktree, setUseWorktree] = useState(false);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [awaitingClaudeSessionIds, setAwaitingClaudeSessionIds] = useState<Set<string>>(() => new Set());
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const autocompleteOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const pendingMessagesRef = useRef<Record<string, PendingMessage[]>>({});

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
  const activePlan = useMemo(
    () => extractSessionPlan(activeEvents),
    [activeEvents]
  );
  const hiddenEventCount = displayableEvents.length - visibleEvents.length;
  const isActiveSessionMode = listMode === 'active' && !activeSession?.deletedAt;
  const isComposerSession = isActiveSessionMode && activeSession?.status === 'running';
  const isAwaitingClaude = activeId ? awaitingClaudeSessionIds.has(activeId) : false;
  const hasDraft = message.trim().length > 0;
  const canSend = isComposerSession && hasDraft && !isSending;
  const composerDisabledReason = !activeSession
    ? 'Select a session to send a message.'
    : listMode === 'archived' || activeSession.deletedAt
      ? 'Archived sessions are read-only. Unarchive to continue.'
      : activeSession.status === 'starting'
        ? 'Claude is starting. You can send once the session is ready.'
        : activeSession.status !== 'running'
          ? 'This session is stopped. Resume it to continue.'
          : '';
  const sendStatusText = !isComposerSession
    ? composerDisabledReason
    : isSending
      ? 'Sending...'
      : isAwaitingClaude
        ? 'Sent. Waiting for Claude...'
        : hasDraft
          ? 'Ready to send'
          : 'Message Claude';

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

  const visibleSessions = useMemo(() => {
    const query = sessionSearch.trim().toLocaleLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const runtimeStatus = session.runtimeStatus ?? session.status;
      const searchable = [
        session.name,
        session.cwd,
        session.status,
        runtimeStatus,
        runtimeStatusLabels[runtimeStatus],
        session.permissionMode,
        session.worktree?.branch,
        session.worktree?.sourceCwd,
        session.worktree?.worktreeCwd
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [sessionSearch, sessions]);

  function addPendingMessage(sessionId: string, text: string): number {
    const eventId = -Date.now();
    const pendingEvent: UiEvent = {
      id: eventId,
      sessionId,
      time: new Date().toISOString(),
      kind: 'user',
      payload: { message: text, pending: true }
    };
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: [...(pendingMessagesRef.current[sessionId] ?? []), { id: eventId, text }]
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), pendingEvent]
    }));
    return eventId;
  }

  function removePendingMessage(sessionId: string, eventId: number) {
    const remaining = (pendingMessagesRef.current[sessionId] ?? []).filter((item) => item.id !== eventId);
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: remaining
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).filter((event) => event.id !== eventId)
    }));
  }

  function replaceMatchingPendingMessage(sessionId: string, event: UiEvent): boolean {
    const text = userEventText(event);
    if (!text) return false;
    const pendingMessages = pendingMessagesRef.current[sessionId] ?? [];
    const matching = pendingMessages.find((item) => normalizedMessageText(item.text) === normalizedMessageText(text));
    if (!matching) return false;
    const remaining = pendingMessages.filter((item) => item.id !== matching.id);
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: remaining
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map((currentEvent) => (currentEvent.id === matching.id ? event : currentEvent))
    }));
    return true;
  }

  function markAwaitingClaude(sessionId: string, awaiting: boolean) {
    setAwaitingClaudeSessionIds((current) => {
      const next = new Set(current);
      if (awaiting) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  }

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
    autocompleteOptionRefs.current = [];
  }

  function resizeMessageInput(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = 'auto';
    const contentHeight = element.scrollHeight;
    if (contentHeight > 0) {
      element.style.height = `${Math.min(contentHeight, MESSAGE_INPUT_MAX_HEIGHT)}px`;
    } else {
      element.style.height = '';
    }
    element.style.overflowY = contentHeight > MESSAGE_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
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
      const afterId = (events[sessionId] ?? []).reduce((latest, event) => (event.id > latest ? event.id : latest), 0);
      socket = new WebSocket(eventsUrl(sessionId, afterId));
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as UiEvent;
        if (event.kind === 'user' && replaceMatchingPendingMessage(sessionId, event)) {
          markAwaitingClaude(sessionId, true);
          return;
        }
        if (event.kind === 'assistant' || event.kind === 'error') {
          markAwaitingClaude(sessionId, false);
        }
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
    resizeMessageInput(messageInputRef.current);
  }, [message, isComposerSession]);

  useEffect(() => {
    autocompleteOptionRefs.current[activeSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestionIndex, suggestions]);

  useEffect(() => {
    if (!activeId || isComposerSession) return;
    markAwaitingClaude(activeId, false);
  }, [activeId, isComposerSession]);

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
    if (!activeId || !canSend) return;
    const sessionId = activeId;
    const text = message;
    const pendingEventId = addPendingMessage(sessionId, text);
    setError(null);
    setIsSending(true);
    markAwaitingClaude(sessionId, true);
    setMessage('');
    closeAutocomplete();
    try {
      const updatedSession = await sendInput(sessionId, text);
      if (updatedSession) {
        setSessions((current) => current.map((session) => session.id === updatedSession.id ? updatedSession : session));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      removePendingMessage(sessionId, pendingEventId);
      markAwaitingClaude(sessionId, false);
      setMessage(text);
      refreshAutocomplete(text, text.length);
    } finally {
      setIsSending(false);
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

  function useEmptyStatePrompt(prompt: string) {
    setMessage(prompt);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function onMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as unknown as {
      isComposing?: boolean;
      nativeEvent?: { isComposing?: boolean };
      keyCode?: number;
      which?: number;
    };
    const isComposing =
      nativeEvent.isComposing === true ||
      nativeEvent.nativeEvent?.isComposing === true ||
      (event as unknown as { isComposing?: boolean }).isComposing === true ||
      nativeEvent.keyCode === 229 ||
      nativeEvent.which === 229;

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

      if (event.key === 'Home') {
        event.preventDefault();
        setActiveSuggestionIndex(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setActiveSuggestionIndex(suggestions.length - 1);
        return;
      }

      if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey && !isComposing) {
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

    if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
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
    const tabs: Array<typeof inspectorTab> = ['session', 'global', 'plan'];
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
    <AppShell
      view={view}
      listMode={listMode}
      isInspectorOpen={isInspectorOpen}
      onShowActiveSessions={() => {
        setView('sessions');
        setListMode('active');
      }}
      onShowConfig={() => setView('config')}
      onShowArchivedSessions={() => {
        setView('sessions');
        setListMode('archived');
      }}
      sidebar={
        <SessionSidebar
          activeId={activeId}
          cwd={cwd}
          isListLoading={isListLoading}
          isNewSessionOpen={isNewSessionOpen}
          listMode={listMode}
          permissionMode={permissionMode}
          recentDirectories={recentDirectories}
          sessionSearch={sessionSearch}
          sessions={sessions}
          useWorktree={useWorktree}
          visibleSessions={visibleSessions}
          onCreateSession={onCreateSession}
          onSelectSession={setActiveId}
          onSetCwd={setCwd}
          onSetIsNewSessionOpen={setIsNewSessionOpen}
          onSetListMode={setListMode}
          onSetPermissionMode={setPermissionMode}
          onSetSessionSearch={setSessionSearch}
          onSetUseWorktree={setUseWorktree}
          onToggleNewSession={() => setIsNewSessionOpen((open) => !open)}
        />
      }
      workspace={
        <ConversationWorkspace
          activeBlocks={activeBlocks}
          activeSession={activeSession}
          activeSuggestionIndex={activeSuggestionIndex}
          autocompleteOptionRefs={autocompleteOptionRefs}
          autocompleteToken={autocompleteToken}
          canSend={canSend}
          composerDisabledReason={composerDisabledReason}
          composerRef={composerRef}
          emptyStatePrompts={EMPTY_STATE_PROMPTS}
          error={error}
          eventRenderLimit={EVENT_RENDER_LIMIT}
          eventsRef={eventsRef}
          hiddenEventCount={hiddenEventCount}
          isAwaitingClaude={isAwaitingClaude}
          isComposerSession={isComposerSession}
          isSending={isSending}
          listMode={listMode}
          message={message}
          messageInputRef={messageInputRef}
          sendStatusText={sendStatusText}
          suggestions={suggestions}
          view={view}
          actions={renderActions()}
          onCompleteSuggestion={completeSuggestion}
          onMessageChange={(value, element) => {
            setMessage(value);
            resizeMessageInput(element);
            refreshAutocomplete(value, element.selectionStart);
          }}
          onMessageKeyDown={onMessageKeyDown}
          onMessageSelect={refreshAutocomplete}
          onSend={onSend}
          onSetActiveSuggestionIndex={setActiveSuggestionIndex}
          onStopSession={() => onStop(false)}
          onUseEmptyStatePrompt={useEmptyStatePrompt}
        />
      }
      inspector={
        <InspectorPanel
          activePlan={activePlan}
          activeSession={activeSession}
          inspectorTab={inspectorTab}
          isActiveSessionMode={isActiveSessionMode}
          isInspectorOpen={isInspectorOpen}
          sessionTaskError={sessionTaskError}
          sessionTasks={sessionTasks}
          taskError={taskError}
          tasks={tasks}
          onInspectorTabKeyDown={onInspectorTabKeyDown}
          onSelectTask={onSelectTask}
          onSetInspectorOpen={setIsInspectorOpen}
          onSetInspectorTab={setInspectorTab}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      }
    />
  );
}
