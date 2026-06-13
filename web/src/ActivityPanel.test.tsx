import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityPanel from './ActivityPanel';
import type { ActivityItem } from './activityTimeline';
import type { SessionInfo } from './types';

const session: SessionInfo = {
  id: 's1',
  name: 'Repo',
  cwd: '/repo',
  permissionMode: 'acceptEdits',
  status: 'running',
  runtimeStatus: 'waiting',
  claudeSessionId: null,
  deletedAt: null,
  createdAt: '2026-06-13T00:00:00Z',
  updatedAt: '2026-06-13T00:00:00Z'
};

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'activity-toolu_1',
    name: 'Bash',
    status: 'done',
    summary: '$ npm test',
    resultSummary: 'tests passed',
    startedAt: '2026-06-13T00:00:00Z',
    finishedAt: '2026-06-13T00:00:05Z',
    durationMs: 5000,
    startEventId: 1,
    finishEventId: 2,
    anchorEventId: 1,
    rawEventKinds: ['tool', 'tool'],
    isPermissionLike: false,
    transcriptHidden: false,
    ...overrides
  };
}

describe('ActivityPanel', () => {
  beforeEach(() => cleanup());

  it('renders status counts and recent activity cards', () => {
    render(
      <ActivityPanel
        activeSession={session}
        waitingMessage={null}
        activities={[
          activity({ id: 'activity-running', status: 'running', name: 'Read', summary: '/repo/a.ts', resultSummary: undefined }),
          activity({ id: 'activity-failed', status: 'failed', name: 'Bash', resultSummary: 'exit code 1', transcriptHidden: true })
        ]}
        onSelectActivity={() => undefined}
      />
    );

    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('1 running · 0 waiting · 1 failed · 0 done')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Waiting for tool result')).toBeInTheDocument();
    expect(screen.getByText('Transcript summary')).toBeInTheDocument();
  });

  it('opens activity and permission-like review payload without fake approval buttons', () => {
    const onSelectActivity = vi.fn();
    const permissionActivity = activity({
      id: 'activity-permission',
      name: 'PermissionReview',
      status: 'waiting',
      isPermissionLike: true,
      resultSummary: undefined
    });

    render(
      <ActivityPanel
        activeSession={session}
        waitingMessage="Claude appears to be waiting on a permission or review-style event. This build can show the payload, but approval controls are not wired yet."
        activities={[permissionActivity]}
        onSelectActivity={onSelectActivity}
      />
    );

    const waitingSurface = screen.getByLabelText('Waiting status');
    expect(within(waitingSurface).getByText(/approval controls are not wired yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^deny$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review payload' }));
    expect(onSelectActivity).toHaveBeenCalledWith(permissionActivity);
  });
});
