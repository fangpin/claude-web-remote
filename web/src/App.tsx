import { FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import AppShell, { type AppView } from './AppShell';
import { buildActivityTimeline, latestReviewActivity, reviewSurface, waitingCopy, type ActivityItem } from './activityTimeline';
import ConversationWorkspace from './ConversationWorkspace';
import InspectorPanel, { type InspectorTab } from './InspectorPanel';
import { hasAppModifier, isEditableTarget, isPlainSlash } from './keyboardShortcuts';
import ProjectHome from './ProjectHome';
import SessionSidebar from './SessionSidebar';
import { getContinueActionLabel } from './sessionContinuity';
import type { TaskInfo } from './types';
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
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [dismissedAttentionKey, setDismissedAttentionKey] = useState<string | null>(null);
  const [notifiedAttentionKey, setNotifiedAttentionKey] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('session');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const isDiagnosticsVisible = view === 'sessions' && isInspectorOpen && inspectorTab === 'diagnostics';
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

  const eventState = useSessionEvents({
    activeId: sessionState.activeId,
    activeSession: sessionState.activeSession,
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
  const latestPermissionActivity = activities.find((activity) => activity.isPermissionLike && ['running', 'waiting'].includes(activity.status));
  const currentReviewSurface = reviewSurface(sessionState.activeSession, latestReviewActivity(activities));
  const waitingMessage = waitingCopy(sessionState.activeSession, latestPermissionActivity ?? null);

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
  keepPaletteOpen?: boolean;
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

function CommandPalette({ actions, onClose }: { actions: CommandPaletteAction[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleActions = normalizedQuery
    ? actions.filter((action) => `${action.title} ${action.hint}`.toLowerCase().includes(normalizedQuery))
    : actions;

  function runAction(action: CommandPaletteAction) {
    action.run();
    if (!action.keepPaletteOpen) onClose();
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
      document.querySelector<HTMLElement>(view === 'config' ? '.config-workspace' : '.conversation-workspace')?.focus();
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

  async function onCreateSession(event: FormEvent) {
    shouldFocusComposerAfterCreateRef.current = true;
    await sessionState.onCreateSession(event);
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

  function showKeyboardShortcuts() {
    setIsCommandPaletteOpen(false);
    queueMicrotask(() => setIsShortcutHelpOpen(true));
  }

  const attentionKey = currentReviewSurface
    ? `${sessionState.activeSession?.id ?? 'session'}:${currentReviewSurface.activity?.id ?? currentReviewSurface.title}`
    : null;
  const shouldShowAttentionToast = Boolean(currentReviewSurface && attentionKey !== dismissedAttentionKey);
  const canRequestNotifications = typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default';

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) return;
    await Notification.requestPermission();
  }

  useEffect(() => {
    if (!currentReviewSurface || !attentionKey || notifiedAttentionKey === attentionKey) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    new Notification(currentReviewSurface.title, {
      body: currentReviewSurface.message,
      tag: attentionKey
    });
    setNotifiedAttentionKey(attentionKey);
  }, [attentionKey, currentReviewSurface, notifiedAttentionKey]);

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
    {
      id: 'diagnostics',
      title: 'Show diagnostics',
      hint: 'Open runtime and session diagnostics in the inspector drawer',
      kind: 'Command',
      run: () => {
        setView('sessions');
        setIsInspectorOpen(true);
        setInspectorTab('diagnostics');
      }
    },
    {
      id: 'keyboard-shortcuts',
      title: 'Show keyboard shortcuts',
      hint: 'Review app-level shortcuts',
      kind: 'Command',
      run: showKeyboardShortcuts,
      keepPaletteOpen: true
    },
    { id: 'toggle-sidebar', title: isSidebarOpen ? 'Hide sidebar' : 'Show sidebar', hint: 'Toggle project and chat navigation', kind: 'Command', shortcut: '⌘B', run: toggleSidebar },
    { id: 'toggle-inspector', title: isInspectorOpen ? 'Hide inspector' : 'Show inspector', hint: 'Toggle activity, tasks, plan, and diagnostics', kind: 'Command', shortcut: '⌘I', run: () => setIsInspectorOpen((open) => !open) }
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
        if (isShortcutHelpOpen) {
          event.preventDefault();
          setIsShortcutHelpOpen(false);
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
        setIsShortcutHelpOpen(false);
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
    const tabs: Array<typeof inspectorTab> = ['activity', 'session', 'global', 'plan', 'diagnostics'];
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

  function renderRemoveWorktreeButton() {
    const status = sessionState.activeWorktreeStatus;
    const unavailable = sessionState.isWorktreeStatusLoading || sessionState.activeWorktreeStatusError || !status;
    if (status?.dirty) {
      return <button disabled title="Stop only keeps this dirty worktree so you can review, commit, stash, or clean its changes.">Review dirty worktree first</button>;
    }
    return (
      <button
        disabled={Boolean(unavailable)}
        title={unavailable ? 'Worktree cleanup is available after the clean status check completes.' : undefined}
        onClick={() => {
          if (confirm('Stop this session and remove the clean app-created worktree? The source repository will remain.')) {
            void sessionState.onStop(true);
          }
        }}
      >
        Stop and remove worktree
      </button>
    );
  }

  function renderWorktreeStopActions() {
    const activeSession = sessionState.activeSession;
    return (
      <>
        <button onClick={() => sessionState.onStop(false)}>Stop only</button>
        {activeSession?.worktree?.createdByClaudeRemoteWeb && renderRemoveWorktreeButton()}
      </>
    );
  }

  function renderActions() {
    const activeSession = sessionState.activeSession;
    if (!activeSession) return null;
    if (sessionState.listMode === 'archived' || activeSession.deletedAt) {
      return (
        <div className="actions session-actions">
          <button onClick={sessionState.onUnarchive}>Unarchive</button>
          <button className="danger" onClick={sessionState.onDelete}>Delete</button>
        </div>
      );
    }

    if (activeSession.status === 'running') {
      return (
        <div className="actions session-actions">
          {activeSession.worktree ? renderWorktreeStopActions() : <button onClick={() => sessionState.onStop(false)}>End session</button>}
          <button onClick={sessionState.onRestart}>Restart</button>
          <button className="danger" onClick={sessionState.onArchive}>Archive</button>
        </div>
      );
    }

    if (activeSession.status === 'starting') {
      return (
        <div className="actions session-actions">
          {activeSession.worktree ? renderWorktreeStopActions() : <button onClick={() => sessionState.onStop(false)}>End session</button>}
          <button className="danger" onClick={sessionState.onArchive}>Archive</button>
        </div>
      );
    }

    return (
      <div className="actions session-actions">
        <button className="primary-action" onClick={sessionState.onResume}>{getContinueActionLabel(activeSession)}</button>
        <button className="danger" onClick={sessionState.onArchive}>Archive</button>
      </div>
    );
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
          sessionActions={renderActions()}
          onCreateGroup={sessionState.onCreateGroup}
          onDeleteGroup={sessionState.onDeleteGroup}
          onMoveSessionToGroup={sessionState.onMoveSessionToGroup}
          onNewChat={openNewChat}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onRenameGroup={sessionState.onRenameGroup}
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
          isAwaitingClaude={eventState.isAwaitingClaude}
          isComposerSession={isComposerSession}
          isSending={composerState.isSending}
          isSessionListLoading={sessionState.isListLoading}
          isStartSurfaceOpen={sessionState.isStartSurfaceOpen}
          listMode={sessionState.listMode}
          message={composerState.message}
          messageInputRef={composerState.messageInputRef}
          promptHistory={composerState.promptHistory}
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
              onCreateSession={onCreateSession}
              onSelectSession={sessionState.selectSession}
              onSetCwd={sessionState.setCwd}
              onSetPermissionMode={sessionState.setPermissionMode}
              onSetUseWorktree={sessionState.setUseWorktree}
            />
          )}
          onAddPathContextAttachment={composerState.addPathContextAttachment}
          onAddTextContextAttachment={composerState.addTextContextAttachment}
          onCompleteSuggestion={composerState.completeSuggestion}
          onMessageChange={composerState.onMessageChange}
          onMessageKeyDown={composerState.onMessageKeyDown}
          onMessageSelect={composerState.onMessageSelect}
          onRemoveContextAttachment={composerState.removeContextAttachment}
          onSend={composerState.onSend}
          onSetActiveSuggestionIndex={composerState.setActiveSuggestionIndex}
          onUsePrompt={composerState.usePrompt}
          onDismissError={() => reportApiError(null)}
          onRetryEvents={eventState.retryActiveEvents}
          onLoadOlderEvents={eventState.loadOlderEvents}
          onOpenReviewActivity={onOpenReviewActivity}
          onRenameSession={sessionState.onRename}
          onUseEmptyStatePrompt={composerState.useEmptyStatePrompt}
        />
      }
      inspector={
        <InspectorPanel
          activities={activities}
          activePlan={eventState.activePlan}
          activeSession={sessionState.activeSession}
          diagnostics={diagnosticsState.diagnostics}
          diagnosticsError={diagnosticsState.error}
          inspectorTab={inspectorTab}
          isActiveSessionMode={sessionState.isActiveSessionMode}
          isDiagnosticsLoading={diagnosticsState.isLoading}
          isInspectorOpen={isInspectorOpen}
          sessionDiagnostics={diagnosticsState.sessionDiagnostics}
          sessionTaskError={taskState.sessionTaskError}
          sessionTasks={taskState.sessionTasks}
          taskError={taskState.taskError}
          tasks={taskState.tasks}
          waitingMessage={waitingMessage}
          reviewSurface={currentReviewSurface}
          onInspectorTabKeyDown={onInspectorTabKeyDown}
          onRefreshDiagnostics={diagnosticsState.refreshDiagnostics}
          onSelectActivity={onSelectActivity}
          onSelectTask={onSelectTask}
          onResizeInspectorStart={onResizeInspectorStart}
          onSetInspectorOpen={setIsInspectorOpen}
          onSetInspectorTab={setInspectorTab}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      }
    />
    {shouldShowAttentionToast && currentReviewSurface && attentionKey && (
      <AttentionToast
        title={currentReviewSurface.title}
        message={currentReviewSurface.message}
        canNotify={canRequestNotifications}
        onEnableNotifications={enableBrowserNotifications}
        onReview={() => {
          onOpenReviewActivity(currentReviewSurface);
          setDismissedAttentionKey(attentionKey);
        }}
        onDismiss={() => setDismissedAttentionKey(attentionKey)}
      />
    )}
    {isShortcutHelpOpen && (
      <section id="keyboard-shortcuts-help" className="shortcut-help-popover app-shortcut-help-popover" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <dl>
          <div><dt>⌘/Ctrl P</dt><dd>Open command palette</dd></div>
          <div><dt>⌘/Ctrl N</dt><dd>New chat</dd></div>
          <div><dt>⌘/Ctrl K</dt><dd>Focus composer</dd></div>
          <div><dt>/</dt><dd>Focus composer</dd></div>
          <div><dt>⌘/Ctrl B</dt><dd>Toggle sidebar</dd></div>
          <div><dt>⌘/Ctrl I</dt><dd>Toggle inspector</dd></div>
          <div><dt>⌥ Up/Down</dt><dd>Switch sessions</dd></div>
          <div><dt>Esc</dt><dd>Close popovers</dd></div>
        </dl>
      </section>
    )}
    {isCommandPaletteOpen && <CommandPalette actions={commandPaletteActions} onClose={() => setIsCommandPaletteOpen(false)} />}
    </>
  );
}
