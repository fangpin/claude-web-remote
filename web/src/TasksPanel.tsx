import type { TaskGroups, TaskInfo } from './types';

const TASK_SECTION_LIMIT = 8;

type Props = {
  title: string;
  tasks: TaskGroups;
  error?: string | null;
  compact?: boolean;
  onSelectTask: (task: TaskInfo) => void;
};

function formatTime(value?: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleTimeString();
}

function TaskSection({
  heading,
  tasks,
  onSelectTask
}: {
  heading: string;
  tasks: TaskInfo[];
  onSelectTask: (task: TaskInfo) => void;
}) {
  const visibleTasks = tasks.slice(-TASK_SECTION_LIMIT);
  const hiddenTaskCount = tasks.length - visibleTasks.length;

  return (
    <section className="task-section">
      <h4>{heading}</h4>
      {tasks.length === 0 ? (
        <p className="task-empty">None.</p>
      ) : (
        <div className="task-list">
          {hiddenTaskCount > 0 && (
            <p className="task-limit-note">
              Showing latest {TASK_SECTION_LIMIT}. {hiddenTaskCount} older hidden.
            </p>
          )}
          {visibleTasks.map((task) => {
            const time = formatTime(task.finishedAt ?? task.startedAt);
            return (
              <button
                key={task.id}
                type="button"
                className={`task-card ${task.status}`}
                onClick={() => onSelectTask(task)}
              >
                <span className="task-card-title">{task.title}</span>
                <span className="task-card-meta">
                  {task.toolKind} · {task.sessionName || task.sessionCwd}
                </span>
                <span className="task-card-meta">
                  <span>{task.status}</span>{time ? ` · ${time}` : ''}
                </span>
                {task.summary && <span className="task-card-summary">{task.summary}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function TasksPanel({ title, tasks, error, compact = false, onSelectTask }: Props) {
  const empty = tasks.background.length === 0 && tasks.finished.length === 0;

  return (
    <section className={compact ? 'tasks-panel compact' : 'tasks-panel'}>
      <h3>{title}</h3>
      {error && <p role="alert" className="task-error">{error}</p>}
      {empty ? (
        <p className="task-empty">No tasks yet.</p>
      ) : (
        <>
          <TaskSection heading="Background tasks" tasks={tasks.background} onSelectTask={onSelectTask} />
          <TaskSection heading="Finished tasks" tasks={tasks.finished} onSelectTask={onSelectTask} />
        </>
      )}
    </section>
  );
}
