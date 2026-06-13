import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
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
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false);
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

  function focusFallbackAfterSidebarClose() {
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement) || !activeElement.closest('.session-sidebar')) return;
      if (isComposerSession) {
        focusComposer(false);
        return;
      }
      document.querySelector<HTMLButtonElement>('.primary-rail button')?.focus();
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

  function renderActions() {
    const activeSession = sessionState.activeSession;
    if (!activeSession) return null;
    if (sessionState.listMode === 'archived' || activeSession.deletedAt) {
      return (
        <div className="actions">
          <button onClick={sessionState.onUnarchive}>Unarchive</button>
          <button className="danger" onClick={sessionState.onDelete}>Delete</button>
        </div>
      );
    }

    if (activeSession.status === 'running') {
      return (
        <div className="actions">
          {activeSession.worktree ? (
            <>
              <button onClick={() => sessionState.onStop(false)}>Stop only</button>
              {activeSession.worktree.createdByClaudeRemoteWeb && (
                <button onClick={() => sessionState.onStop(true)}>Stop and remove worktree</button>
              )}
            </>
          ) : (
            <button onClick={() => sessionState.onStop(false)}>Stop</button>
          )}
          <button onClick={sessionState.onRestart}>Restart</button>
          <button className="danger" onClick={sessionState.onArchive}>Archive</button>
        </div>
      );
    }

    if (activeSession.status === 'starting') {
      return (
        <div className="actions">
          {activeSession.worktree ? (
            <>
              <button onClick={() => sessionState.onStop(false)}>Stop only</button>
              {activeSession.worktree.createdByClaudeRemoteWeb && (
                <button onClick={() => sessionState.onStop(true)}>Stop and remove worktree</button>
              )}
            </>
          ) : (
            <button onClick={() => sessionState.onStop(false)}>Stop</button>
          )}
          <button className="danger" onClick={sessionState.onArchive}>Archive</button>
        </div>
      );
    }

    return (
      <div className="actions">
        <button className="primary-action" onClick={sessionState.onResume}>{getContinueActionLabel(activeSession)}</button>
        <button className="danger" onClick={sessionState.onArchive}>Archive</button>
      </div>
    );
  }

  return (
    <AppShell
      view={view}
      listMode={sessionState.listMode}
      isInspectorOpen={isInspectorOpen}
      isShortcutHelpOpen={isShortcutHelpOpen}
      isSidebarOpen={isSidebarOpen}
      onSetShortcutHelpOpen={setIsShortcutHelpOpen}
      onShowActiveSessions={() => {
        setView('sessions');
        setIsSidebarOpen(true);
        sessionState.setListMode('active');
      }}
      onShowConfig={() => setView('config')}
      onShowArchivedSessions={() => {
        setView('sessions');
        setIsSidebarOpen(true);
        sessionState.setListMode('archived');
      }}
      onToggleSidebar={toggleSidebar}
      sidebar={
        <SessionSidebar
          activeId={sessionState.activeId}
          isListLoading={sessionState.isListLoading}
          listError={sessionState.listError}
          listMode={sessionState.listMode}
          sessionSearch={sessionState.sessionSearch}
          sessions={sessionState.sessions}
          visibleSessions={sessionState.visibleSessions}
          onNewChat={() => sessionState.openStartSurface()}
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
          eventRenderLimit={EVENT_RENDER_LIMIT}
          eventsRef={eventState.eventsRef}
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
          sendStatusText={composerState.sendStatusText}
          suggestions={composerState.suggestions}
          view={view}
          actions={renderActions()}
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
          onStopSession={() => sessionState.onStop(false)}
          onDismissError={() => reportApiError(null)}
          onRetryEvents={eventState.retryActiveEvents}
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
          onSetInspectorOpen={setIsInspectorOpen}
          onSetInspectorTab={setInspectorTab}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
        />
      }
    />
  );
}
