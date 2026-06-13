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
    expect(screen.getByText('1 running · 1 finished')).toBeInTheDocument();
    expect(screen.getByText('Background')).toBeInTheDocument();
    expect(screen.getByText('Still running')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Finished' })).toBeInTheDocument();
    expect(screen.getByText('Completed, failed, or interrupted')).toBeInTheDocument();
    expect(screen.getByText('Agent: Explore the branch')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review the branch')).toBeInTheDocument();
    expect(screen.getAllByText('Running').some((element) => element.closest('.task-status-pill'))).toBe(true);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('No issues found')).toBeInTheDocument();
    expect(screen.getAllByText('Open')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
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

  it('keeps long task titles constrained while preserving the full title', () => {
    const longTitle = 'Agent: Investigate why the deployment verification job keeps reporting a timeout after the remote log stream has already finished';
    render(
      <TasksPanel
        title="Tasks"
        tasks={{ background: [task({ id: 's1:toolu_long', title: longTitle })], finished: [] }}
        onSelectTask={() => undefined}
      />
    );

    const taskButton = screen.getByRole('button', { name: new RegExp(longTitle) });
    expect(taskButton).toHaveAttribute('title', `Open task: ${longTitle}`);
    expect(screen.getByText(longTitle)).toHaveClass('task-card-title');
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

    expect(screen.getByText('0 running · 0 finished')).toBeInTheDocument();
    expect(screen.getByText('Task refresh failed')).toBeInTheDocument();
    expect(screen.getByText('failed to load tasks')).toBeInTheDocument();
    expect(screen.getByText('No agent activity yet')).toBeInTheDocument();
    expect(screen.getByText('Background and finished task cards will appear here when Claude starts longer-running work.')).toBeInTheDocument();
  });

  it('renders per-section empty states when only one lane has tasks', () => {
    render(<TasksPanel title="Tasks" tasks={{ background: groups.background, finished: [] }} onSelectTask={() => undefined} />);

    expect(screen.getByText('1 running · 0 finished')).toBeInTheDocument();
    expect(screen.getByText('No finished tasks')).toBeInTheDocument();
    expect(screen.queryByText('No agent activity yet')).not.toBeInTheDocument();
  });

  it('filters by failed and running task state', () => {
    render(
      <TasksPanel
        title="Tasks"
        tasks={{
          background: groups.background,
          finished: [
            groups.finished[0],
            task({
              id: 's1:toolu_failed',
              title: 'Agent: Failed verification',
              status: 'failed',
              finishedAt: '2026-06-12T00:02:00Z',
              summary: 'Command failed'
            })
          ]
        }}
        onSelectTask={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.getByText('Agent: Failed verification')).toBeInTheDocument();
    expect(screen.queryByText('Agent: Explore the branch')).not.toBeInTheDocument();
    expect(screen.queryByText('Agent: Review the branch')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Active' }));
    expect(screen.getByText('Agent: Explore the branch')).toBeInTheDocument();
    expect(screen.queryByText('Agent: Failed verification')).not.toBeInTheDocument();
  });
});
