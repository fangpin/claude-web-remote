import type { KeyboardEvent } from 'react';
import ActivityPanel from './ActivityPanel';
import type { ActivityItem, ReviewSurface } from './activityTimeline';
import type { SessionPlan } from './sessionPlan';
import TasksPanel from './TasksPanel';
import type {
  DiagnosticStatus,
  DiagnosticsResponse,
  PathDiagnostics,
  SessionDiagnosticsResponse,
  SessionInfo,
  TaskGroups,
  TaskInfo
} from './types';

export type InspectorTab = 'activity' | 'session' | 'global' | 'plan' | 'diagnostics';

type Props = {
  activities: ActivityItem[];
  activePlan: SessionPlan | null;
  activeSession: SessionInfo | null;
  diagnostics: DiagnosticsResponse | null;
  diagnosticsError: string | null;
  inspectorTab: InspectorTab;
  isActiveSessionMode: boolean;
  isDiagnosticsLoading: boolean;
  isInspectorOpen: boolean;
  sessionDiagnostics: SessionDiagnosticsResponse | null;
  sessionTaskError: string | null;
  sessionTasks: TaskGroups;
  taskError: string | null;
  tasks: TaskGroups;
  waitingMessage: string | null;
  reviewSurface: ReviewSurface | null;
  onInspectorTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onRefreshDiagnostics: () => void;
  onSelectActivity: (activity: ActivityItem) => void;
  onSelectTask: (task: TaskInfo) => void;
  onSetInspectorOpen: (isOpen: boolean) => void;
  onSetInspectorTab: (tab: InspectorTab) => void;
  onToggleInspector: () => void;
};

export default function InspectorPanel({
  activities,
  activePlan,
  activeSession,
  diagnostics,
  diagnosticsError,
  inspectorTab,
  isActiveSessionMode,
  isDiagnosticsLoading,
  isInspectorOpen,
  sessionDiagnostics,
  sessionTaskError,
  sessionTasks,
  taskError,
  tasks,
  waitingMessage,
  reviewSurface,
  onInspectorTabKeyDown,
  onRefreshDiagnostics,
  onSelectActivity,
  onSelectTask,
  onSetInspectorTab,
  onToggleInspector
}: Props) {
  return (
    <>
      {!isInspectorOpen && (
        <button
          type="button"
          className="inspector-floating-toggle"
          aria-label="Show inspector"
          title="Show inspector (⌘/Ctrl+I)"
          onClick={onToggleInspector}
        >
          ‹
        </button>
      )}
      <aside className="inspector" aria-label="Session inspector">
        {isInspectorOpen && (
          <button
            type="button"
            className="inspector-edge-toggle"
            aria-label="Hide inspector"
            title="Hide inspector (⌘/Ctrl+I)"
            onClick={onToggleInspector}
          >
            ›
          </button>
        )}
      <header className="inspector-header">
        <div>
          <h2>Inspector</h2>
          <p>{activeSession ? activeSession.name || activeSession.cwd : 'No session selected'}</p>
        </div>
      </header>
      {isInspectorOpen && (
        <>
          <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
            <button type="button" id="inspector-tab-activity" role="tab" aria-selected={inspectorTab === 'activity'} aria-controls="inspector-panel-activity" tabIndex={inspectorTab === 'activity' ? 0 : -1} onClick={() => onSetInspectorTab('activity')} onKeyDown={onInspectorTabKeyDown}>Activity</button>
            <button type="button" id="inspector-tab-session" role="tab" aria-selected={inspectorTab === 'session'} aria-controls="inspector-panel-session" tabIndex={inspectorTab === 'session' ? 0 : -1} onClick={() => onSetInspectorTab('session')} onKeyDown={onInspectorTabKeyDown}>Session tasks</button>
            <button type="button" id="inspector-tab-global" role="tab" aria-selected={inspectorTab === 'global'} aria-controls="inspector-panel-global" tabIndex={inspectorTab === 'global' ? 0 : -1} onClick={() => onSetInspectorTab('global')} onKeyDown={onInspectorTabKeyDown}>All tasks</button>
            <button type="button" id="inspector-tab-plan" role="tab" aria-selected={inspectorTab === 'plan'} aria-controls="inspector-panel-plan" tabIndex={inspectorTab === 'plan' ? 0 : -1} onClick={() => onSetInspectorTab('plan')} onKeyDown={onInspectorTabKeyDown}>Plan</button>
            <button type="button" id="inspector-tab-diagnostics" role="tab" aria-selected={inspectorTab === 'diagnostics'} aria-controls="inspector-panel-diagnostics" tabIndex={inspectorTab === 'diagnostics' ? 0 : -1} onClick={() => onSetInspectorTab('diagnostics')} onKeyDown={onInspectorTabKeyDown}>Diagnostics</button>
          </div>
          <div id="inspector-panel-activity" role="tabpanel" aria-labelledby="inspector-tab-activity" hidden={inspectorTab !== 'activity'}>
            <ActivityPanel
              activities={activities}
              activeSession={activeSession}
              waitingMessage={waitingMessage}
              onSelectActivity={onSelectActivity}
            />
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
          <section id="inspector-panel-plan" role="tabpanel" aria-labelledby="inspector-tab-plan" className="session-plan" hidden={inspectorTab !== 'plan'}>
            {!activeSession ? (
              <p className="inspector-empty">No session selected.</p>
            ) : activePlan ? (
              <>
                <h3>Session plan</h3>
                <p className="plan-source">From {activePlan.source === 'ExitPlanMode' ? 'ExitPlanMode' : 'plan file'}</p>
                <pre className="plan-content">{activePlan.markdown}</pre>
              </>
            ) : (
              <p className="inspector-empty">No plan available for this session.</p>
            )}
          </section>
          <section id="inspector-panel-diagnostics" role="tabpanel" aria-labelledby="inspector-tab-diagnostics" className="diagnostics-panel" hidden={inspectorTab !== 'diagnostics'}>
            <DiagnosticsPanel
              activeSession={activeSession}
              diagnostics={diagnostics}
              error={diagnosticsError}
              isLoading={isDiagnosticsLoading}
              sessionDiagnostics={sessionDiagnostics}
              onRefresh={onRefreshDiagnostics}
            />
          </section>
        </>
      )}
      </aside>
    </>
  );
}

function DiagnosticsPanel({
  activeSession,
  diagnostics,
  error,
  isLoading,
  sessionDiagnostics,
  onRefresh
}: {
  activeSession: SessionInfo | null;
  diagnostics: DiagnosticsResponse | null;
  error: string | null;
  isLoading: boolean;
  sessionDiagnostics: SessionDiagnosticsResponse | null;
  onRefresh: () => void;
}) {
  return (
    <div className="diagnostics-stack">
      <div className="diagnostics-heading">
        <div>
          <h3>Runtime diagnostics</h3>
          <p>{diagnostics ? statusCopy(diagnostics.status) : 'Configuration and recent process health.'}</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? 'Checking...' : 'Refresh'}
        </button>
      </div>
      {error && <p className="task-error">{error}</p>}
      {diagnostics ? (
        <>
          <div className="diagnostic-row">
            <span>Status</span>
            <strong className={`diagnostic-status status-${diagnostics.status}`}>{diagnostics.status}</strong>
          </div>
          <DiagnosticPath title="Data directory" diagnostics={diagnostics.dataDir} />
          <DiagnosticPath title="Web assets" diagnostics={diagnostics.webDir} />
          <div className="diagnostic-block">
            <h4>Launcher argv</h4>
            <code>{diagnostics.launcher.fullArgvPreview.join(' ')}</code>
            {diagnostics.launcher.issues.map((issue) => (
              <p key={issue} className="diagnostic-issue">{issue}</p>
            ))}
          </div>
          <div className="diagnostic-grid">
            <DiagnosticPair label="Bind" value={diagnostics.config.bind} />
            <DiagnosticPair label="Permission" value={diagnostics.config.defaultPermissionMode} />
            <DiagnosticPair label="Config file" value={diagnostics.config.configFileExists ? diagnostics.config.configPath : 'Not found'} />
            <DiagnosticPair label="Restart" value={diagnostics.config.restartRequired ? 'Required' : 'Not required'} />
          </div>
          {diagnostics.recentSessionFailures.length > 0 && (
            <div className="diagnostic-block">
              <h4>Recent failures</h4>
              {diagnostics.recentSessionFailures.slice(0, 4).map((failure) => (
                <div key={failure.sessionId} className="diagnostic-event">
                  <strong>{failure.sessionName || failure.cwd}</strong>
                  <p>{failure.message}</p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="inspector-empty">{isLoading ? 'Checking daemon health...' : 'Open diagnostics to check daemon health.'}</p>
      )}
      {activeSession ? (
        <SessionDiagnosticPanel diagnostics={sessionDiagnostics} isLoading={isLoading} />
      ) : (
        <p className="inspector-empty">Select a session to see process stderr and system events.</p>
      )}
    </div>
  );
}

function SessionDiagnosticPanel({
  diagnostics,
  isLoading
}: {
  diagnostics: SessionDiagnosticsResponse | null;
  isLoading: boolean;
}) {
  if (!diagnostics) {
    return <p className="inspector-empty">{isLoading ? 'Checking selected session...' : 'No session diagnostics loaded.'}</p>;
  }

  return (
    <div className="diagnostic-block">
      <h4>Selected session</h4>
      <div className="diagnostic-row">
        <span>{diagnostics.session.status}</span>
        <strong className={`diagnostic-status status-${diagnostics.status}`}>{diagnostics.status}</strong>
      </div>
      <p>{diagnostics.summary}</p>
      {diagnostics.guidance.length > 0 && (
        <ul className="diagnostic-list">
          {diagnostics.guidance.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {diagnostics.recentStderr.length > 0 && (
        <details className="diagnostic-details" open>
          <summary>Recent stderr</summary>
          {diagnostics.recentStderr.map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}
        </details>
      )}
      {diagnostics.recentErrors.length > 0 && (
        <details className="diagnostic-details">
          <summary>Error events</summary>
          {diagnostics.recentErrors.map((event) => <p key={event.id}>{event.message}</p>)}
        </details>
      )}
      {diagnostics.recentSystemEvents.length > 0 && (
        <details className="diagnostic-details">
          <summary>System events</summary>
          {diagnostics.recentSystemEvents.map((event) => <p key={event.id}>{event.message}</p>)}
        </details>
      )}
    </div>
  );
}

function DiagnosticPath({ title, diagnostics }: { title: string; diagnostics: PathDiagnostics }) {
  return (
    <div className="diagnostic-block">
      <div className="diagnostic-row">
        <h4>{title}</h4>
        <strong className={`diagnostic-status status-${diagnostics.status}`}>{diagnostics.status}</strong>
      </div>
      <p>{diagnostics.message}</p>
      {diagnostics.path && <code>{diagnostics.path}</code>}
    </div>
  );
}

function DiagnosticPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function statusCopy(status: DiagnosticStatus): string {
  if (status === 'healthy') return 'Daemon health checks are passing.';
  if (status === 'warning') return 'Daemon is running with recent warnings.';
  return 'Daemon needs attention before sessions will reliably start.';
}
