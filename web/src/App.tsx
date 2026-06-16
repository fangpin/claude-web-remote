import { FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import AppShell, { type AppView } from './AppShell';
import { allowPermission, denyPermission, listPendingPermissions } from './api';
import { buildActivityTimeline, latestReviewActivity, reviewSurface, waitingCopy, type ActivityItem } from './activityTimeline';
import ConversationWorkspace from './ConversationWorkspace';
import InspectorPanel, { type InspectorTab } from './InspectorPanel';
import { hasAppModifier, isEditableTarget, isPlainSlash } from './keyboardShortcuts';
import { mergePendingPermissions, permissionsFromEvents } from './permissionEvents';
import type { ConversationDisplayMode } from './presentationPolicy';
import ProjectHome from './ProjectHome';
import SessionSidebar, { type SessionRowAction } from './SessionSidebar';
import { getContinueActionLabel } from './sessionContinuity';
import type { PendingPermissionRequest, PermissionCapability, SessionInfo, TaskInfo } from './types';
import { useComposerState } from './useComposerState';
import { useDiagnostics } from './useDiagnostics';
import { useSessionEvents } from './useSessionEvents';
import { useSessions } from './useSessions';
import { useTasks } from './useTasks';
import './App.css';

const EVENT_RENDER_LIMIT = 80;
const INSPECTOR_DEFAULT_WIDTH = 360;
const INSPECTOR_MIN_WIDTH = 300;
const INSPECTOR_MAX_WIDTH = 640;
const EMPTY_STATE_PROMPTS = [
  'Summarize this repository',
  'Review my current changes',
  'Run the relevant tests',
  'Plan the smallest fix'
];

type ApiError = {
  message: string;
  detail: string | null;
};

type TaskActions = {
  refreshTasks: () => Promise<void>;
  refreshSessionTasks: (sessionId: string) => Promise<void>;
};

type EventActions = {
  removeSessionEvents: (sessionId: string) => void;
  setPendingEventId: (eventId: number) => void;
};

export default function App() {
  const [view, setView] = useState<AppView>('sessions');
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [dismissedAttentionKey, setDismissedAttentionKey] = useState<string | null>(null);
  const [notifiedAttentionKey, setNotifiedAttentionKey] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('activity');
  const [conversationDisplayModes, setConversationDisplayModes] = useState<Record<string, ConversationDisplayMode>>({});
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [apiPendingPermissions, setApiPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [permissionCapability, setPermissionCapability] = useState<PermissionCapability | null>(null);
  const isDeveloperMode = import.meta.env.DEV;
  const isDiagnosticsVisible = isDeveloperMode && view === 'sessions' && isInspectorOpen && inspectorTab === 'diagnostics';
  const taskActionsRef = useRef<TaskActions>({
    refreshTasks: async () => undefined,
    refreshSessionTasks: async (_sessionId: string) => undefined
  });
  const shouldFocusComposerAfterCreateRef = useRef(false);
  const eventActionsRef = useRef<EventActions>({
    removeSessionEvents: (_sessionId: string) => undefined,
    setPendingEventId: (_eventId: number) => undefined
  });

  const refreshTasks = useCallback(() => taskActionsRef.current.refreshTasks(), []);
  const refreshSessionTasks = useCallback((sessionId: string) => taskActionsRef.current.refreshSessionTasks(sessionId), []);
  const removeSessionEvents = useCallback((sessionId: string) => eventActionsRef.current.removeSessionEvents(sessionId), []);
  const reportApiError = useCallback((detail: string | null) => {
    setErrorDetail(detail);
  }, []);

  const sessionState = useSessions({
    setError: reportApiError,
    onTasksChanged: () => {
      void refreshTasks();
    },
    onSessionTasksChanged: (sessionId) => {
      void refreshSessionTasks(sessionId);
    },
    onDeleteSessionEvents: removeSessionEvents
  });

  const isComposerSession = Boolean(
    sessionState.isActiveSessionMode && sessionState.activeSession?.status === 'running'
  );

  const taskState = useTasks({
    activeId: sessionState.activeId,
    listMode: sessionState.listMode
  });
  taskActionsRef.current = {
    refreshTasks: taskState.refreshTasks,
    refreshSessionTasks: taskState.refreshSessionTasks
  };
  const conversationDisplayMode = sessionState.activeId ? (conversationDisplayModes[sessionState.activeId] ?? 'chat') : 'chat';
  const setConversationDisplayMode = useCallback((mode: ConversationDisplayMode) => {
    const sessionId = sessionState.activeId;
    if (!sessionId) return;
    setConversationDisplayModes((current) => ({
      ...current,
      [sessionId]: mode
    }));
  }, [sessionState.activeId]);

  const eventState = useSessionEvents({
    activeId: sessionState.activeId,
    activeSession: sessionState.activeSession,
    displayMode: conversationDisplayMode,
    eventRenderLimit: EVENT_RENDER_LIMIT,
    isActiveSessionMode: sessionState.isActiveSessionMode,
    isComposerSession,
    refreshTasks,
    refreshSessionTasks
  });
  eventActionsRef.current = {
    removeSessionEvents: eventState.removeSessionEvents,
    setPendingEventId: eventState.setPendingEventId
  };

  const composerState = useComposerState({
    activeId: sessionState.activeId,
    activeSession: sessionState.activeSession,
    addPendingMessage: eventState.addPendingMessage,
    isAwaitingClaude: eventState.isAwaitingClaude,
    isComposerSession,
    listMode: sessionState.listMode,
    markAwaitingClaude: eventState.markAwaitingClaude,
    removePendingMessage: eventState.removePendingMessage,
    setError: reportApiError,
    setSessions: sessionState.setSessions
  });
  const diagnosticsState = useDiagnostics({
    activeSessionId: sessionState.activeSession?.id ?? null,
    enabled: isDiagnosticsVisible
  });

  const apiError: ApiError | null = errorDetail
    ? {
        message: 'The daemon could not complete that request. Try again from the same place.',
        detail: errorDetail
      }
    : null;
  const activities = buildActivityTimeline(eventState.activeEvents, eventState.activeBlockEventIds);
  const eventPendingPermissions = permissionsFromEvents(eventState.activeEvents);
  const pendingPermissions = mergePendingPermissions(eventPendingPermissions, Array.isArray(apiPendingPermissions) ? apiPendingPermissions : []);
  const effectivePermissionCapability = permissionCapability ?? sessionState.activeSession?.permissionCapability ?? null;
  const latestPermissionActivity = activities.find((activity) => activity.isPermissionLike && ['running', 'waiting'].includes(activity.status));
  const currentReviewSurface = reviewSurface(sessionState.activeSession, latestReviewActivity(activities));
  const waitingMessage = waitingCopy(sessionState.activeSession, latestPermissionActivity ?? null);

  useEffect(() => {
    const sessionId = sessionState.activeSession?.id;
    if (!sessionId) {
      setApiPendingPermissions([]);
      setPermissionCapability(null);
      return;
    }
    const activeSessionId = sessionId;
    let cancelled = false;
    async function loadPendingPermissions() {
      try {
        const result = await listPendingPermissions(activeSessionId);
        if (cancelled) return;
        setApiPendingPermissions(result.pending);
        setPermissionCapability(result.capability);
      } catch (error) {
        if (cancelled) return;
        setApiPendingPermissions([]);
        setPermissionCapability({ status: 'unavailable', reason: error instanceof Error ? error.message : String(error) });
      }
    }
    void loadPendingPermissions();
    return () => {
      cancelled = true;
    };
  }, [sessionState.activeSession?.id, sessionState.activeSession?.updatedAt]);

  async function onAllowPermission(permission: PendingPermissionRequest, updatedInput?: unknown) {
    try {
      const resolved = await allowPermission(permission.sessionId, permission.requestId, updatedInput);
      setApiPendingPermissions((current) => current.filter((item) => item.requestId !== resolved.requestId));
    } catch (error) {
      reportApiError(error instanceof Error ? error.message : String(error));
    }
  }

  async function onDenyPermission(permission: PendingPermissionRequest, message: string) {
    try {
      const resolved = await denyPermission(permission.sessionId, permission.requestId, message);
      setApiPendingPermissions((current) => current.filter((item) => item.requestId !== resolved.requestId));
    } catch (error) {
      reportApiError(error instanceof Error ? error.message : String(error));
    }
  }

  function focusComposer(seedSlash = false) {
    if (!isComposerSession) return;
    const input = composerState.messageInputRef.current;
    if (!input) return;
    const nextMessage = seedSlash && composerState.message.length === 0 ? '/' : composerState.message;
    if (nextMessage !== composerState.message) {
      composerState.onMessageChange(nextMessage, input);
    }
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(nextMessage.length, nextMessage.length);
      composerState.onMessageSelect(nextMessage, nextMessage.length);
    });
  }

  function focusSessionButton(sessionId: string) {
    const escapedSessionId = window.CSS?.escape ? window.CSS.escape(sessionId) : sessionId.replace(/"/g, '\\"');
    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`button.session[data-session-id="${escapedSessionId}"]`)?.focus();
    });
  }

  type CommandPaletteAction = {
  id: string;
  title: string;
  hint: string;
  kind: 'Command' | 'Chat';
  shortcut?: string;
  run: () => void;
};

function AttentionToast({
  title,
  message,
  canNotify,
  onEnableNotifications,
  onReview,
  onDismiss
}: {
  title: string;
  message: string;
  canNotify: boolean;
  onEnableNotifications: () => void;
  onReview: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="attention-toast" role="status" aria-label="Claude attention notification">
      <div>
        <span className="state-kicker">Claude needs attention</span>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <div className="attention-toast-actions">
        <button type="button" onClick={onReview}>Review</button>
        {canNotify && <button type="button" onClick={onEnableNotifications}>Enable notifications</button>}
        <button type="button" onClick={onDismiss} aria-label="Dismiss attention notification">Dismiss</button>
      </div>
    </section>
  );
}

function KeyboardShortcutList() {
  return (
    <dl>
      <div><dt>⌘/Ctrl P</dt><dd>Open command palette</dd></div>
      <div><dt>⌘/Ctrl N</dt><dd>New chat</dd></div>
      <div><dt>⌘/Ctrl K</dt><dd>Focus composer</dd></div>
      <div><dt>/</dt><dd>Focus composer</dd></div>
      <div><dt>⌘/Ctrl B</dt><dd>Toggle sidebar</dd></div>
      <div><dt>⌘/Ctrl I</dt><dd>Toggle Activity</dd></div>
      <div><dt>⌥ Up/Down</dt><dd>Switch sessions</dd></div>
      <div><dt>Esc</dt><dd>Close popovers</dd></div>
    </dl>
  );
}

function CommandPalette({ actions, onClose }: { actions: CommandPaletteAction[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleActions = normalizedQuery
    ? actions.filter((action) => `${action.title} ${action.hint}`.toLowerCase().includes(normalizedQuery))
    : actions;

  function runAction(action: CommandPaletteAction) {
    onClose();
    action.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' && visibleActions.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleActions.length);
      return;
    }
    if (event.key === 'ArrowUp' && visibleActions.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleActions.length) % visibleActions.length);
      return;
    }
    if (event.key === 'Enter' && visibleActions[activeIndex]) {
      if (event.target instanceof HTMLElement && event.target.closest('.command-palette-shortcuts')) return;
      event.preventDefault();
      runAction(visibleActions[activeIndex]);
    }
  }

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()}>
        <div className="command-palette-header">
          <span className="state-kicker">Quick actions</span>
          <h2>What would you like to do?</h2>
        </div>
        <label className="command-palette-search">
          <span className="sr-only">Search commands</span>
          <input
            autoFocus
            value={query}
            placeholder="Search commands..."
            aria-label="Search commands"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
          />
        </label>
        <div className="command-palette-list" aria-label="Command palette actions">
          {visibleActions.length > 0 ? visibleActions.map((action, index) => (
            <button
              key={action.id}
              type="button"
              className={index === activeIndex ? 'active' : undefined}
              aria-current={index === activeIndex ? 'true' : undefined}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runAction(action)}
            >
              <span>
                <strong>{action.title}</strong>
                <small><span className="command-palette-kind">{action.kind}</span>{action.hint}</small>
              </span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </button>
          )) : (
            <p className="command-palette-empty">No commands match “{query}”.</p>
          )}
        </div>
        <details className="command-palette-shortcuts">
          <summary>Keyboard shortcuts</summary>
          <KeyboardShortcutList />
        </details>
      </section>
    </div>
  );
}

function focusFallbackAfterSidebarClose() {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !activeElement.closest('.session-sidebar')) return;
      if (isComposerSession) {
        focusComposer(false);
        return;
      }
      document.querySelector<HTMLElement>('.workspace')?.focus();
    });
  }

  function toggleSidebar() {
    setIsSidebarOpen((open) => {
      const nextOpen = !open;
      if (!nextOpen) focusFallbackAfterSidebarClose();
      return nextOpen;
    });
  }

  function selectVisibleSession(offset: number) {
    const visibleSessions = sessionState.visibleSessions;
    if (visibleSessions.length === 0) return;
    const currentIndex = Math.max(0, visibleSessions.findIndex((session) => session.id === sessionState.activeId));
    const nextSession = visibleSessions[(currentIndex + offset + visibleSessions.length) % visibleSessions.length];
    setView('sessions');
    sessionState.selectSession(nextSession.id);
    if (!isSidebarOpen) setIsSidebarOpen(true);
    focusSessionButton(nextSession.id);
  }

  async function onStartSession(initialPrompt: string) {
    shouldFocusComposerAfterCreateRef.current = true;
    await sessionState.onStartSession(initialPrompt);
  }

  function onSelectTask(task: TaskInfo) {
    if (sessionState.listMode !== 'active') {
      sessionState.setListMode('active');
    }
    sessionState.selectSession(task.sessionId);
    eventState.setPendingEventId(task.startEventId);
  }

  function onSelectActivity(activity: ActivityItem) {
    eventState.setPendingEventId(activity.anchorEventId);
  }

  function onOpenReviewActivity(review: typeof currentReviewSurface) {
    if (!review?.activity) return;
    setView('sessions');
    setIsInspectorOpen(true);
    setInspectorTab('activity');
    onSelectActivity(review.activity);
  }

  function openActivityInspector() {
    setView('sessions');
    setIsInspectorOpen(true);
    setInspectorTab('activity');
  }

  function openDiagnosticsInspector() {
    setView('sessions');
    setIsInspectorOpen(true);
    setInspectorTab('diagnostics');
  }

  function onOpenPreviewPath(path: string) {
    setView('sessions');
    setIsInspectorOpen(true);
    setInspectorTab('preview');
    setSelectedPreviewPath(path);
  }

  function showActiveSessions() {
    setView('sessions');
    setIsSidebarOpen(true);
    sessionState.setListMode('active');
  }

  function showArchivedSessions() {
    setView('sessions');
    setIsSidebarOpen(true);
    sessionState.setListMode('archived');
  }

  function openNewChat() {
    showActiveSessions();
    sessionState.openStartSurface();
  }

  function openCommandPalette() {
    setIsCommandPaletteOpen(true);
  }

  const attentionKey = pendingPermissions[0]
    ? `${pendingPermissions[0].sessionId}:${pendingPermissions[0].requestId}`
    : currentReviewSurface
      ? `${sessionState.activeSession?.id ?? 'session'}:${currentReviewSurface.activity?.id ?? currentReviewSurface.title}`
      : null;
  const shouldShowAttentionToast = Boolean((pendingPermissions[0] || currentReviewSurface) && attentionKey !== dismissedAttentionKey);
  const canRequestNotifications = typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default';

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
  }

  useEffect(() => {
    if (!attentionKey || notifiedAttentionKey === attentionKey) return;
    if (!pendingPermissions[0] && !currentReviewSurface) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(pendingPermissions[0] ? 'Claude needs your permission' : currentReviewSurface!.title, {
      body: pendingPermissions[0]?.summary ?? currentReviewSurface!.message,
      tag: attentionKey
    });
    setNotifiedAttentionKey(attentionKey);
  }, [attentionKey, currentReviewSurface, notifiedAttentionKey, pendingPermissions]);

  const chatSwitchActions: CommandPaletteAction[] = sessionState.visibleSessions.slice(0, 6).map((session) => ({
    id: `chat-${session.id}`,
    title: session.name || session.cwd,
    hint: `Open chat · ${session.cwd}`,
    kind: 'Chat',
    run: () => {
      setView('sessions');
      setIsSidebarOpen(true);
      sessionState.selectSession(session.id);
    }
  }));
  const commandPaletteActions: CommandPaletteAction[] = [
    { id: 'new-chat', title: 'New chat', hint: 'Choose a project and start a Claude session', kind: 'Command', shortcut: 'N', run: openNewChat },
    { id: 'focus-composer', title: 'Focus composer', hint: 'Jump back to the message input', kind: 'Command', shortcut: '⌘K', run: () => focusComposer(false) },
    { id: 'slash-command', title: 'Open slash commands', hint: 'Start command autocomplete in the composer', kind: 'Command', shortcut: '/', run: () => focusComposer(true) },
    ...chatSwitchActions,
    { id: 'active-sessions', title: 'Show active chats', hint: 'Return to active conversations', kind: 'Command', run: showActiveSessions },
    { id: 'archived-sessions', title: 'Show archived chats', hint: 'Browse archived conversations', kind: 'Command', run: showArchivedSessions },
    { id: 'settings', title: 'Open settings', hint: 'View app and runtime configuration', kind: 'Command', run: () => setView('config') },
    { id: 'toggle-sidebar', title: isSidebarOpen ? 'Hide sidebar' : 'Show sidebar', hint: 'Toggle project and chat navigation', kind: 'Command', shortcut: '⌘B', run: toggleSidebar },
    { id: 'toggle-inspector', title: isInspectorOpen ? 'Hide activity' : 'Show activity', hint: 'Toggle Claude activity, tasks, and plan', kind: 'Command', shortcut: '⌘I', run: () => setIsInspectorOpen((open) => !open) }
  ];

  useEffect(() => {
    if (!shouldFocusComposerAfterCreateRef.current || !isComposerSession) return;
    shouldFocusComposerAfterCreateRef.current = false;
    focusComposer(false);
  }, [isComposerSession, sessionState.activeId]);

  useEffect(() => {
    function onGlobalKeyDown(event: globalThis.KeyboardEvent) {
      const editableTarget = isEditableTarget(event.target);
      const hasAutocomplete = composerState.suggestions.length > 0 && composerState.autocompleteToken;

      if (event.key === 'Escape') {
        if (isCommandPaletteOpen) {
          event.preventDefault();
          setIsCommandPaletteOpen(false);
          return;
        }
        if (hasAutocomplete) {
          event.preventDefault();
          composerState.closeAutocomplete();
          return;
        }
        if (isInspectorOpen) {
          event.preventDefault();
          setIsInspectorOpen(false);
        }
        return;
      }

      if (hasAppModifier(event) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setIsCommandPaletteOpen((open) => !open);
        return;
      }

      if (hasAppModifier(event) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openNewChat();
        return;
      }

      if (hasAppModifier(event) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setView('sessions');
        focusComposer(true);
        return;
      }

      if (hasAppModifier(event) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (hasAppModifier(event) && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setIsInspectorOpen((open) => !open);
        return;
      }

      if (!editableTarget && event.altKey && !event.metaKey && !event.ctrlKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        selectVisibleSession(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (!editableTarget && isPlainSlash(event)) {
        event.preventDefault();
        setView('sessions');
        focusComposer(true);
      }
    }

    window.addEventListener('keydown', onGlobalKeyDown);
    return () => window.removeEventListener('keydown', onGlobalKeyDown);
  });

  function visibleInspectorTabs(): InspectorTab[] {
    return isDeveloperMode ? ['activity', 'preview', 'session', 'plan', 'global', 'diagnostics'] : ['activity', 'preview', 'session', 'plan', 'global'];
  }

  function onResizeInspectorStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!isInspectorOpen) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerStartX = event.clientX;
    const widthStart = inspectorWidth;

    function onPointerMove(moveEvent: PointerEvent) {
      const nextWidth = widthStart + pointerStartX - moveEvent.clientX;
      setInspectorWidth(Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, nextWidth)));
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onInspectorTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs: InspectorTab[] = visibleInspectorTabs().filter((tab) => tab !== 'global' && tab !== 'diagnostics');
    const currentIndex = tabs.indexOf(inspectorTab);
    if (currentIndex === -1) return;
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

  useEffect(() => {
    if (!isDeveloperMode && inspectorTab === 'diagnostics') {
      setInspectorTab('activity');
    }
  }, [inspectorTab, isDeveloperMode]);

  function openWorktreePreview(session: SessionInfo) {
    setView('sessions');
    sessionState.selectSession(session.id);
    setInspectorTab('preview');
    setIsInspectorOpen(true);
  }

  function removeWorktreeActionForSession(session: SessionInfo): SessionRowAction | null {
    if (!session.worktree?.createdByClaudeRemoteWeb) return null;
    if (session.id !== sessionState.activeId) {
      return {
        id: 'remove-worktree-unavailable',
        label: 'Stop and remove worktree',
        disabled: true,
        title: 'Select this chat to check clean worktree status before cleanup.',
        onClick: () => undefined
      };
    }
    const status = sessionState.activeWorktreeStatus;
    const unavailable = sessionState.isWorktreeStatusLoading || sessionState.activeWorktreeStatusError || !status;
    if (status?.dirty) {
      return {
        id: 'remove-worktree-dirty',
        label: 'Review dirty worktree first',
        disabled: true,
        title: 'Stop only keeps this dirty worktree so you can review, commit, stash, or clean its changes.',
        onClick: () => undefined
      };
    }
    return {
      id: 'remove-worktree',
      label: 'Stop and remove worktree',
      disabled: Boolean(unavailable),
      title: unavailable ? 'Worktree cleanup is available after the clean status check completes.' : undefined,
      onClick: () => {
        if (confirm('Stop this session and remove the clean app-created worktree? The source repository will remain.')) {
          void sessionState.onStopSession(session.id, true);
        }
      }
    };
  }

  function getSessionActions(session: SessionInfo): SessionRowAction[] {
    if (session.deletedAt || sessionState.listMode === 'archived') {
      return [
        { id: 'unarchive', label: 'Unarchive', title: 'Restore this archived chat', onClick: () => void sessionState.onUnarchiveSession(session.id) },
        { id: 'delete', label: 'Delete', variant: 'danger', title: 'Delete archived metadata and event log', onClick: () => void sessionState.onDeleteSession(session.id) }
      ];
    }

    if (session.status === 'running' || session.status === 'starting' || session.runtimeStatus === 'running' || session.runtimeStatus === 'starting') {
      return [
        ...(session.worktree ? [{ id: 'open-worktree-diff', label: 'Open worktree diff', onClick: () => openWorktreePreview(session) } satisfies SessionRowAction] : []),
        { id: 'stop', label: session.worktree ? 'Stop only' : 'End session', onClick: () => void sessionState.onStopSession(session.id, false) },
        ...(session.worktree ? [removeWorktreeActionForSession(session)].filter((action): action is SessionRowAction => Boolean(action)) : []),
        ...(session.status === 'running' || session.runtimeStatus === 'running'
          ? [{ id: 'restart', label: 'Restart', title: 'Resume with the persisted Claude session id when available', onClick: () => void sessionState.onRestartSession(session.id) } satisfies SessionRowAction]
          : []),
        { id: 'archive', label: 'Archive', variant: 'danger', title: 'Stop if needed and archive this chat', onClick: () => void sessionState.onArchiveSession(session.id) }
      ];
    }

    return [
      { id: 'continue', label: getContinueActionLabel(session), variant: 'primary', title: 'Resume with the persisted Claude session id when available', onClick: () => void sessionState.onResumeSession(session.id) },
      { id: 'archive', label: 'Archive', variant: 'danger', title: 'Archive this chat', onClick: () => void sessionState.onArchiveSession(session.id) }
    ];
  }


  return (
    <>
    <AppShell
      view={view}
      isInspectorOpen={isInspectorOpen}
      inspectorWidth={inspectorWidth}
      isSidebarOpen={isSidebarOpen}
      sidebar={
        <SessionSidebar
          activeId={sessionState.activeId}
          isListLoading={sessionState.isListLoading}
          listError={sessionState.listError}
          listMode={sessionState.listMode}
          sessionSearch={sessionState.sessionSearch}
          sessions={sessionState.sessions}
          sessionGroups={sessionState.sessionGroups}
          visibleSessions={sessionState.visibleSessions}
          getSessionActions={getSessionActions}
          onCreateGroup={sessionState.onCreateGroup}
          onDeleteGroup={sessionState.onDeleteGroup}
          onMoveSessionToGroup={sessionState.onMoveSessionToGroup}
          onNewChat={openNewChat}
          onOpenCommandPalette={openCommandPalette}
          onRenameGroup={sessionState.onRenameGroup}
          onRenameSession={sessionState.onRename}
          onSelectSession={sessionState.selectSession}
          onSetListMode={sessionState.setListMode}
          onSetSessionSearch={sessionState.setSessionSearch}
          onRetryList={() => {
            reportApiError(null);
            void sessionState.refreshSessions(sessionState.listMode, { reset: true });
          }}
        />
      }
      workspace={
        <ConversationWorkspace
          activeBlocks={eventState.activeBlocks}
          activeSession={sessionState.activeSession}
          activeSuggestionIndex={composerState.activeSuggestionIndex}
          autocompleteOptionRefs={composerState.autocompleteOptionRefs}
          autocompleteToken={composerState.autocompleteToken}
          canSend={composerState.canSend}
          conversationDisplayMode={conversationDisplayMode}
          composerDisabledReason={composerState.composerDisabledReason}
          composerRef={composerState.composerRef}
          contextAttachments={composerState.contextAttachments}
          emptyStatePrompts={EMPTY_STATE_PROMPTS}
          error={apiError}
          eventConnectionError={eventState.activeConnection.error}
          eventConnectionState={eventState.activeConnection.state}
          visibleEventCount={eventState.visibleEvents.length}
          eventsRef={eventState.eventsRef}
          activeWorktreeStatus={sessionState.activeWorktreeStatus}
          activeWorktreeStatusError={sessionState.activeWorktreeStatusError}
          isWorktreeStatusLoading={sessionState.isWorktreeStatusLoading}
          canLoadOlderEvents={eventState.canLoadOlderEvents}
          hiddenEventCount={eventState.hiddenEventCount}
          reviewSurface={currentReviewSurface}
          pendingPermissions={pendingPermissions}
          permissionCapability={effectivePermissionCapability}
          isActivityDrawerOpen={isInspectorOpen}
          isAwaitingClaude={eventState.isAwaitingClaude}
          isComposerSession={isComposerSession}
          isSending={composerState.isSending}
          isSessionListLoading={sessionState.isListLoading}
          isStartSurfaceOpen={sessionState.isStartSurfaceOpen}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={toggleSidebar}
          onOpenActivity={openActivityInspector}
          listMode={sessionState.listMode}
          message={composerState.message}
          messageInputRef={composerState.messageInputRef}
          sendStatusText={composerState.sendStatusText}
          suggestions={composerState.suggestions}
          view={view}
          startSurface={(
            <ProjectHome
              cwd={sessionState.cwd}
              permissionMode={sessionState.permissionMode}
              recentProjects={sessionState.recentProjects}
              recentSessions={sessionState.recentSessions}
              useWorktree={sessionState.useWorktree}
              onStartSession={onStartSession}
              onSelectSession={sessionState.selectSession}
              onSetCwd={sessionState.setCwd}
              onSetPermissionMode={sessionState.setPermissionMode}
              onSetUseWorktree={sessionState.setUseWorktree}
            />
          )}
          onAddPathContextAttachment={composerState.addPathContextAttachment}
          onAddTextContextAttachment={composerState.addTextContextAttachment}
          onCompleteSuggestion={composerState.completeSuggestion}
          onConversationDisplayModeChange={setConversationDisplayMode}
          onMessageChange={composerState.onMessageChange}
          onMessageKeyDown={composerState.onMessageKeyDown}
          onMessageSelect={composerState.onMessageSelect}
          onRemoveContextAttachment={composerState.removeContextAttachment}
          onSend={composerState.onSend}
          onStopSession={() => {
            void sessionState.onStop(false);
          }}
          onSetActiveSuggestionIndex={composerState.setActiveSuggestionIndex}
          onToggleActivityDrawer={() => {
            setInspectorTab('activity');
            setIsInspectorOpen((open) => !open);
          }}
          onUsePrompt={composerState.usePrompt}
          onDismissError={() => reportApiError(null)}
          onRetryEvents={eventState.retryActiveEvents}
          onLoadOlderEvents={eventState.loadOlderEvents}
          onOpenReviewActivity={onOpenReviewActivity}
          onAllowPermission={onAllowPermission}
          onDenyPermission={onDenyPermission}
          onOpenPreviewPath={onOpenPreviewPath}
          onUseEmptyStatePrompt={composerState.useEmptyStatePrompt}
        />
      }
      inspector={
        <InspectorPanel
          activeEvents={eventState.activeEvents}
          activities={activities}
          activePlan={eventState.activePlan}
          activeSession={sessionState.activeSession}
          diagnostics={diagnosticsState.diagnostics}
          diagnosticsError={diagnosticsState.error}
          inspectorTab={inspectorTab}
          isActiveSessionMode={sessionState.isActiveSessionMode}
          isDeveloperMode={isDeveloperMode}
          isDiagnosticsLoading={diagnosticsState.isLoading}
          isInspectorOpen={isInspectorOpen}
          selectedPreviewPath={selectedPreviewPath}
          sessionDiagnostics={diagnosticsState.sessionDiagnostics}
          sessionTaskError={taskState.sessionTaskError}
          sessionTasks={taskState.sessionTasks}
          taskError={taskState.taskError}
          tasks={taskState.tasks}
          waitingMessage={waitingMessage}
          reviewSurface={currentReviewSurface}
          pendingPermissions={pendingPermissions}
          permissionCapability={effectivePermissionCapability}
          onInspectorTabKeyDown={onInspectorTabKeyDown}
          onRefreshDiagnostics={diagnosticsState.refreshDiagnostics}
          onSelectActivity={onSelectActivity}
          onAllowPermission={onAllowPermission}
          onDenyPermission={onDenyPermission}
          onSelectTask={onSelectTask}
          onResizeInspectorStart={onResizeInspectorStart}
          onSetInspectorTab={setInspectorTab}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      }
    />
    {shouldShowAttentionToast && attentionKey && (pendingPermissions[0] || currentReviewSurface) && (
      <AttentionToast
        title={pendingPermissions[0] ? 'Claude needs your permission' : currentReviewSurface!.title}
        message={pendingPermissions[0]?.summary ?? currentReviewSurface!.message}
        canNotify={canRequestNotifications}
        onEnableNotifications={enableBrowserNotifications}
        onReview={() => {
          if (currentReviewSurface) onOpenReviewActivity(currentReviewSurface);
          setDismissedAttentionKey(attentionKey);
        }}
        onDismiss={() => setDismissedAttentionKey(attentionKey)}
      />
    )}
    {isCommandPaletteOpen && <CommandPalette actions={commandPaletteActions} onClose={() => setIsCommandPaletteOpen(false)} />}
    </>
  );
}
