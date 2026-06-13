import { describe, expect, it } from 'vitest';
import { buildActivityTimeline, waitingCopy } from './activityTimeline';
import type { EventKind, SessionInfo, UiEvent } from './types';

function event(id: number, kind: EventKind, payload: unknown, time = `2026-06-13T00:00:0${id}Z`): UiEvent {
  return {
    id,
    kind,
    payload,
    sessionId: 's1',
    time
  };
}

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

describe('buildActivityTimeline', () => {
  it('pairs tool calls with results and sorts newest first', () => {
    const activities = buildActivityTimeline([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }, '2026-06-13T00:00:00Z'),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_1', content: 'tests passed' }, '2026-06-13T00:00:05Z'),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/repo/a.ts' } }, '2026-06-13T00:00:06Z')
    ], [1, 2, 3]);

    expect(activities).toMatchObject([
      {
        id: 'activity-toolu_2',
        name: 'Read',
        status: 'running',
        summary: '/repo/a.ts',
        anchorEventId: 3
      },
      {
        id: 'activity-toolu_1',
        name: 'Bash',
        status: 'done',
        summary: '$ npm test',
        resultSummary: 'tests passed',
        durationMs: 5000,
        startEventId: 1,
        finishEventId: 2
      }
    ]);
  });

  it('keeps hidden read-only inspection activity available for inspector navigation', () => {
    const activities = buildActivityTimeline([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/repo/a.ts' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'contents' })
    ], []);

    expect(activities[0]).toMatchObject({
      name: 'Read',
      status: 'done',
      transcriptHidden: true,
      anchorEventId: 1
    });
  });

  it('marks permission-like events as waiting until a result arrives', () => {
    const activities = buildActivityTimeline([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_permission',
        name: 'PermissionReview',
        input: { path: '/repo/package.json', action: 'approve risky edit' }
      })
    ], [1]);

    expect(activities[0]).toMatchObject({
      status: 'waiting',
      isPermissionLike: true
    });
    expect(waitingCopy(session, activities[0])).toContain('approval controls are not wired yet');
  });
});
