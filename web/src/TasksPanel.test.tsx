import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TasksPanel from './TasksPanel';
import type { TaskGroups, TaskInfo } from './types';

function task(overrides: Partial<TaskInfo>): TaskInfo {
  return {
    id: 's1:toolu_1',
    sessionId: 's1',
    sessionName: 'Repo One',
    sessionCwd: '/repo/one',
    toolKind: 'Bash',
    title: 'Bash: sleep 10',
    status: 'background',
    startedAt: '2026-06-12T00:00:00Z',
    finishedAt: null,
    startEventId: 1,
    finishEventId: null,
    summary: null,
    ...overrides
  };
}

const groups: TaskGroups = {
  background: [task({ id: 's1:toolu_1', title: 'Bash: sleep 10' })],
  finished: [
    task({
      id: 's1:toolu_2',
      title: 'Agent: Review the branch',
      status: 'completed',
      finishedAt: '2026-06-12T00:01:00Z',
      finishEventId: 4,
      summary: 'No issues found'
    })
  ]
};

describe('TasksPanel', () => {
  beforeEach(() => cleanup());

  it('renders background and finished task groups', () => {
    render(<TasksPanel title="Tasks" tasks={groups} onSelectTask={() => undefined} />);

    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Background tasks')).toBeInTheDocument();
    expect(screen.getByText('Finished tasks')).toBeInTheDocument();
    expect(screen.getByText('Bash: sleep 10')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review the branch')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('calls onSelectTask when a task is clicked', () => {
    const onSelectTask = vi.fn();
    render(<TasksPanel title="Tasks" tasks={groups} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByText('Bash: sleep 10'));

    expect(onSelectTask).toHaveBeenCalledWith(groups.background[0]);
  });

  it('renders an empty state and non-blocking error', () => {
    render(
      <TasksPanel
        title="Tasks"
        tasks={{ background: [], finished: [] }}
        error="failed to load tasks"
        onSelectTask={() => undefined}
      />
    );

    expect(screen.getByText('failed to load tasks')).toBeInTheDocument();
    expect(screen.getByText('No tasks yet.')).toBeInTheDocument();
  });
});
