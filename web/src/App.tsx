import { KeyboardEvent, useCallback, useRef, useState } from 'react';
import AppShell, { type AppView } from './AppShell';
import { buildActivityTimeline, waitingCopy, type ActivityItem } from './activityTimeline';
import ConversationWorkspace from './ConversationWorkspace';
import InspectorPanel, { type InspectorTab } from './InspectorPanel';
import SessionSidebar from './SessionSidebar';
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
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('session');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const isDiagnosticsVisible = view === 'sessions' && isInspectorOpen && inspectorTab === 'diagnostics';
  const taskActionsRef = useRef<TaskActions>({
    refreshTasks: async () => undefined,
    refreshSessionTasks: async (_sessionId: string) => undefined
  });
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
  const waitingMessage = waitingCopy(sessionState.activeSession, latestPermissionActivity ?? null);

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
        <button onClick={sessionState.onResume}>Resume</button>
        <button className="danger" onClick={sessionState.onArchive}>Archive</button>
      </div>
    );
  }

  return (
    <AppShell
      view={view}
      listMode={sessionState.listMode}
      isInspectorOpen={isInspectorOpen}
      onShowActiveSessions={() => {
        setView('sessions');
        sessionState.setListMode('active');
      }}
      onShowConfig={() => setView('config')}
      onShowArchivedSessions={() => {
        setView('sessions');
        sessionState.setListMode('archived');
      }}
      sidebar={
        <SessionSidebar
          activeId={sessionState.activeId}
          cwd={sessionState.cwd}
          isListLoading={sessionState.isListLoading}
          isNewSessionOpen={sessionState.isNewSessionOpen}
          listError={sessionState.listError}
          listMode={sessionState.listMode}
          permissionMode={sessionState.permissionMode}
          recentDirectories={sessionState.recentDirectories}
          sessionSearch={sessionState.sessionSearch}
          sessions={sessionState.sessions}
          useWorktree={sessionState.useWorktree}
          visibleSessions={sessionState.visibleSessions}
          onCreateSession={sessionState.onCreateSession}
          onSelectSession={sessionState.selectSession}
          onSetCwd={sessionState.setCwd}
          onSetIsNewSessionOpen={sessionState.setIsNewSessionOpen}
          onSetListMode={sessionState.setListMode}
          onSetPermissionMode={sessionState.setPermissionMode}
          onSetSessionSearch={sessionState.setSessionSearch}
          onSetUseWorktree={sessionState.setUseWorktree}
          onToggleNewSession={sessionState.toggleNewSession}
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
          emptyStatePrompts={EMPTY_STATE_PROMPTS}
          error={apiError}
          eventConnectionError={eventState.activeConnection.error}
          eventConnectionState={eventState.activeConnection.state}
          eventRenderLimit={EVENT_RENDER_LIMIT}
          eventsRef={eventState.eventsRef}
          hiddenEventCount={eventState.hiddenEventCount}
          isAwaitingClaude={eventState.isAwaitingClaude}
          isComposerSession={isComposerSession}
          isSending={composerState.isSending}
          isSessionListLoading={sessionState.isListLoading}
          listMode={sessionState.listMode}
          message={composerState.message}
          messageInputRef={composerState.messageInputRef}
          sendStatusText={composerState.sendStatusText}
          suggestions={composerState.suggestions}
          view={view}
          actions={renderActions()}
          onCompleteSuggestion={composerState.completeSuggestion}
          onMessageChange={composerState.onMessageChange}
          onMessageKeyDown={composerState.onMessageKeyDown}
          onMessageSelect={composerState.onMessageSelect}
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
