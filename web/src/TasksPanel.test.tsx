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
    toolKind: 'Agent',
    title: 'Agent: Review branch',
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
  background: [task({ id: 's1:toolu_1', title: 'Agent: Explore the branch' })],
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
    expect(screen.getByText('Agent: Explore the branch')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review the branch')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('calls onSelectTask when a task is clicked', () => {
    const onSelectTask = vi.fn();
    render(<TasksPanel title="Tasks" tasks={groups} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByText('Agent: Explore the branch'));

    expect(onSelectTask).toHaveBeenCalledWith(groups.background[0]);
  });

  it('shows the newest tasks from already sorted groups', () => {
    const manyTasks: TaskGroups = {
      background: Array.from({ length: 10 }, (_, index) => task({
        id: `s1:toolu_${index}`,
        title: `Agent task ${index}`,
        startedAt: `2026-06-12T00:${String(10 - index).padStart(2, '0')}:00Z`
      })),
      finished: []
    };

    render(<TasksPanel title="Tasks" tasks={manyTasks} onSelectTask={() => undefined} />);

    expect(screen.getByText('Agent task 0')).toBeInTheDocument();
    expect(screen.getByText('Agent task 7')).toBeInTheDocument();
    expect(screen.queryByText('Agent task 8')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent task 9')).not.toBeInTheDocument();
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
