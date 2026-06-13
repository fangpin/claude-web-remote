import { describe, expect, it } from 'vitest';
import { extractSessionPlan } from './sessionPlan';
import type { EventKind, UiEvent } from './types';

function event(id: number, kind: EventKind, payload: unknown): UiEvent {
  return {
    id,
    sessionId: 's1',
    time: `2026-06-12T00:0${id}:00Z`,
    kind,
    payload
  };
}

describe('extractSessionPlan', () => {
  it('returns null for empty events', () => {
    expect(extractSessionPlan([])).toBeNull();
  });

  it('extracts plan from top-level ExitPlanMode input', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_use',
        name: 'ExitPlanMode',
        input: { plan: '# Plan\n\nDo the thing.' }
      })
    ]);

    expect(plan).toMatchObject({ markdown: '# Plan\n\nDo the thing.', source: 'ExitPlanMode', eventId: 1 });
  });

  it('extracts plan from nested ExitPlanMode tool use', () => {
    const plan = extractSessionPlan([
      event(1, 'assistant', {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Planning.' },
            { type: 'tool_use', name: 'ExitPlanMode', input: { markdown: 'Nested plan' } }
          ]
        }
      })
    ]);

    expect(plan?.markdown).toBe('Nested plan');
    expect(plan?.source).toBe('ExitPlanMode');
  });

  it('extracts plan from tool result text blocks', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_result',
        name: 'ExitPlanMode',
        content: [{ type: 'text', text: 'Result plan' }]
      })
    ]);

    expect(plan?.markdown).toBe('Result plan');
  });

  it('falls back to plan file Write content', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_use',
        name: 'Write',
        input: {
          file_path: '/Users/me/project/.claude/plans/example.md',
          content: '# File plan'
        }
      })
    ]);

    expect(plan).toMatchObject({ markdown: '# File plan', source: 'plan-file', eventId: 1 });
  });

  it('falls back to plan file Read result content', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_result',
        name: 'Read',
        input: { file_path: '/repo/.claude/plans/example.md' },
        content: '# Read plan'
      })
    ]);

    expect(plan).toMatchObject({ markdown: '# Read plan', source: 'plan-file' });
  });

  it('uses the latest valid plan of a source', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_use',
        name: 'ExitPlanMode',
        input: { plan: 'Old plan' }
      }),
      event(2, 'tool', {
        type: 'tool_use',
        name: 'ExitPlanMode',
        input: { plan: 'New plan' }
      })
    ]);

    expect(plan?.markdown).toBe('New plan');
    expect(plan?.eventId).toBe(2);
  });

  it('prefers ExitPlanMode over later plan file content', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_use',
        name: 'ExitPlanMode',
        input: { plan: 'Approved plan' }
      }),
      event(2, 'tool', {
        type: 'tool_use',
        name: 'Write',
        input: {
          path: '/repo/.claude/plans/later.md',
          content: 'File plan'
        }
      })
    ]);

    expect(plan).toMatchObject({ markdown: 'Approved plan', source: 'ExitPlanMode' });
  });

  it('ignores empty candidates', () => {
    const plan = extractSessionPlan([
      event(1, 'tool', {
        type: 'tool_use',
        name: 'ExitPlanMode',
        input: { plan: '   ' }
      })
    ]);

    expect(plan).toBeNull();
  });
});
