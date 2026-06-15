import { describe, expect, it } from 'vitest';
import { permissionsFromEvents } from './permissionEvents';
import type { UiEvent } from './types';

function event(id: number, payload: unknown): UiEvent {
  return {
    id,
    sessionId: 'session-1',
    time: '2026-06-14T00:00:00Z',
    kind: 'system',
    payload
  };
}

describe('permissionsFromEvents', () => {
  it('extracts pending permission requests from permission_request events', () => {
    const permissions = permissionsFromEvents([
      event(1, {
        type: 'permission_request',
        permission: {
          requestId: 'req-1',
          sessionId: 'session-1',
          hookSessionId: 'hook-1',
          toolName: 'Bash',
          toolInput: { command: 'npm --prefix web test' },
          summary: 'Run: npm --prefix web test',
          cwd: '/repo',
          permissionMode: 'default',
          status: 'pending',
          editable: 'bashCommand',
          decision: null,
          createdAt: '2026-06-14T00:00:00Z',
          resolvedAt: null
        }
      })
    ]);

    expect(permissions).toHaveLength(1);
    expect(permissions[0].requestId).toBe('req-1');
    expect(permissions[0].summary).toBe('Run: npm --prefix web test');
  });

  it('removes resolved permissions from the active pending list', () => {
    const pending = {
      requestId: 'req-1',
      sessionId: 'session-1',
      hookSessionId: null,
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      summary: 'Run: npm test',
      cwd: '/repo',
      permissionMode: 'default',
      status: 'pending',
      editable: 'bashCommand',
      decision: null,
      createdAt: '2026-06-14T00:00:00Z',
      resolvedAt: null
    };

    const permissions = permissionsFromEvents([
      event(1, { type: 'permission_request', permission: pending }),
      event(2, { type: 'permission_resolved', permission: { ...pending, status: 'allowed', resolvedAt: '2026-06-14T00:00:01Z' } })
    ]);

    expect(permissions).toEqual([]);
  });
});
