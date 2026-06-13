import type { KeyboardEvent } from 'react';
import type { SessionPlan } from './sessionPlan';
import TasksPanel from './TasksPanel';
import type { SessionInfo, TaskGroups, TaskInfo } from './types';

export type InspectorTab = 'session' | 'global' | 'plan';

type Props = {
  activePlan: SessionPlan | null;
  activeSession: SessionInfo | null;
  inspectorTab: InspectorTab;
  isActiveSessionMode: boolean;
  isInspectorOpen: boolean;
  sessionTaskError: string | null;
  sessionTasks: TaskGroups;
  taskError: string | null;
  tasks: TaskGroups;
  onInspectorTabKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onSelectTask: (task: TaskInfo) => void;
  onSetInspectorOpen: (isOpen: boolean) => void;
  onSetInspectorTab: (tab: InspectorTab) => void;
  onToggleInspector: () => void;
};

export default function InspectorPanel({
  activePlan,
  activeSession,
  inspectorTab,
  isActiveSessionMode,
  isInspectorOpen,
  sessionTaskError,
  sessionTasks,
  taskError,
  tasks,
  onInspectorTabKeyDown,
  onSelectTask,
  onSetInspectorOpen,
  onSetInspectorTab,
  onToggleInspector
}: Props) {
  return (
    <aside className="inspector" aria-label="Session inspector">
      <button
        type="button"
        className="inspector-edge-toggle"
        aria-label={isInspectorOpen ? 'Hide inspector' : 'Show inspector'}
        title={isInspectorOpen ? 'Hide inspector' : 'Show inspector'}
        onClick={onToggleInspector}
      >
        {isInspectorOpen ? '›' : '‹'}
      </button>
      <header className="inspector-header">
        <div>
          <h2>Inspector</h2>
          <p>{activeSession ? activeSession.name || activeSession.cwd : 'No session selected'}</p>
        </div>
        <button type="button" onClick={() => onSetInspectorOpen(!isInspectorOpen)}>
          {isInspectorOpen ? 'Hide' : 'Show'}
        </button>
      </header>
      {isInspectorOpen && (
        <>
          <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
            <button type="button" id="inspector-tab-session" role="tab" aria-selected={inspectorTab === 'session'} aria-controls="inspector-panel-session" tabIndex={inspectorTab === 'session' ? 0 : -1} onClick={() => onSetInspectorTab('session')} onKeyDown={onInspectorTabKeyDown}>Session tasks</button>
            <button type="button" id="inspector-tab-global" role="tab" aria-selected={inspectorTab === 'global'} aria-controls="inspector-panel-global" tabIndex={inspectorTab === 'global' ? 0 : -1} onClick={() => onSetInspectorTab('global')} onKeyDown={onInspectorTabKeyDown}>All tasks</button>
            <button type="button" id="inspector-tab-plan" role="tab" aria-selected={inspectorTab === 'plan'} aria-controls="inspector-panel-plan" tabIndex={inspectorTab === 'plan' ? 0 : -1} onClick={() => onSetInspectorTab('plan')} onKeyDown={onInspectorTabKeyDown}>Plan</button>
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
        </>
      )}
    </aside>
  );
}
