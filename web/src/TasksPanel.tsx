import { useMemo, useState } from 'react';
import type { TaskGroups, TaskInfo, TaskStatus } from './types';
import './TasksPanel.css';

const TASK_SECTION_LIMIT = 8;
type TaskFilter = 'all' | 'running' | 'failed' | 'finished';

type Props = {
  title: string;
  tasks: TaskGroups;
  error?: string | null;
  compact?: boolean;
  onSelectTask: (task: TaskInfo) => void;
};

const taskFilters: Array<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Active' },
  { value: 'failed', label: 'Failed' },
  { value: 'finished', label: 'Done' }
];

const taskStatusLabels: Record<TaskStatus, string> = {
  background: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  interrupted: 'Interrupted'
};

function formatTime(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function taskCountLabel(count: number, label: string) {
  return `${count} ${label}`;
}

function sessionLabel(task: TaskInfo): string {
  return task.sessionName?.trim() || task.sessionCwd;
}

function matchesFilter(task: TaskInfo, filter: TaskFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return task.status === 'background';
  if (filter === 'failed') return task.status === 'failed' || task.status === 'interrupted';
  return task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted';
}

function filterTasks(tasks: TaskGroups, filter: TaskFilter): TaskGroups {
  return {
    background: tasks.background.filter((task) => matchesFilter(task, filter)),
    finished: tasks.finished.filter((task) => matchesFilter(task, filter))
  };
}

function TaskSection({
  heading,
  description,
  emptyLabel,
  tasks,
  tone,
  onSelectTask
}: {
  heading: string;
  description: string;
  emptyLabel: string;
  tasks: TaskInfo[];
  tone: 'background' | 'finished';
  onSelectTask: (task: TaskInfo) => void;
}) {
  const visibleTasks = tasks.slice(0, TASK_SECTION_LIMIT);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  return (
    <section className={`task-section task-section-${tone}`}>
      <div className="task-section-header">
        <div>
          <h4>{heading}</h4>
          <p>{description}</p>
        </div>
        <span className="task-section-count">{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="task-section-empty">{emptyLabel}</div>
      ) : (
        <div className="task-list">
          {hiddenTaskCount > 0 && (
            <p className="task-limit-note">
              Showing latest {TASK_SECTION_LIMIT}; {hiddenTaskCount} older hidden.
            </p>
          )}
          {visibleTasks.map((task) => {
            const time = formatTime(task.finishedAt ?? task.startedAt);
            const statusLabel = taskStatusLabels[task.status];
            return (
              <button
                key={task.id}
                type="button"
                className={`task-card ${task.status}`}
                title={`Open task: ${task.title}`}
                onClick={() => onSelectTask(task)}
              >
                <span className="task-card-main">
                  <span className="task-card-title">{task.title}</span>
                  <span className="task-card-meta">
                    {task.toolKind} · {sessionLabel(task)}
                  </span>
                  <span className="task-card-status-row">
                    <span className="task-status-pill">
                      <span className="task-status-dot" aria-hidden="true" />
                      {statusLabel}
                    </span>
                    {time && <span className="task-card-time">{time}</span>}
                  </span>
                  {task.summary && <span className="task-card-summary">{task.summary}</span>}
                </span>
                <span className="task-card-jump" aria-hidden="true">Open</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function TasksPanel({ title, tasks, error, compact = false, onSelectTask }: Props) {
  const [filter, setFilter] = useState<TaskFilter>('all');
  const filteredTasks = useMemo(() => filterTasks(tasks, filter), [tasks, filter]);
  const empty = tasks.background.length === 0 && tasks.finished.length === 0;
  const filteredEmpty = filteredTasks.background.length === 0 && filteredTasks.finished.length === 0;
  const panelClassName = compact ? 'tasks-panel task-center compact' : 'tasks-panel task-center';

  return (
    <section className={panelClassName}>
      <header className="task-center-header">
        <div>
          <h3>{title}</h3>
          <p>{taskCountLabel(tasks.background.length, 'running')} · {taskCountLabel(tasks.finished.length, 'finished')}</p>
        </div>
      </header>
      {!empty && (
        <div className="task-filter" role="group" aria-label={`${title} filters`}>
          {taskFilters.map((option) => (
            <button
              key={option.value}
              type="button"
              className={filter === option.value ? 'selected' : ''}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <div role="alert" className="task-error">
          <span className="task-error-title">Task refresh failed</span>
          <span>{error}</span>
          <span>Showing the last task snapshot available.</span>
        </div>
      )}
      {empty ? (
        <div className="task-panel-empty">
          <span className="task-panel-empty-title">No agent activity yet</span>
          <span>{compact ? 'This session is quiet.' : 'Background and finished task cards will appear here when Claude starts longer-running work.'}</span>
        </div>
      ) : filteredEmpty ? (
        <div className="task-panel-empty">
          <span className="task-panel-empty-title">No matching tasks</span>
          <span>Try a different status filter.</span>
        </div>
      ) : (
        <>
          <TaskSection
            heading="Background"
            description="Still running"
            emptyLabel="No background tasks"
            tasks={filteredTasks.background}
            tone="background"
            onSelectTask={onSelectTask}
          />
          <TaskSection
            heading="Finished"
            description="Completed, failed, or interrupted"
            emptyLabel="No finished tasks"
            tasks={filteredTasks.finished}
            tone="finished"
            onSelectTask={onSelectTask}
          />
        </>
      )}
    </section>
  );
}
