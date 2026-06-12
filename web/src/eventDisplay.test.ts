import { describe, expect, it } from 'vitest';
import { parseDisplayEvent, parseDisplayEvents } from './eventDisplay';
import type { UiEvent } from './types';

function event(payload: unknown, kind: UiEvent['kind'] = 'raw'): UiEvent {
  return {
    id: 1,
    sessionId: 's1',
    time: '2026-06-12T00:00:00Z',
    kind,
    payload
  };
}

describe('parseDisplayEvent', () => {
  it('extracts assistant text from Claude content arrays', () => {
    const display = parseDisplayEvent(
      event({ type: 'assistant', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] }, 'assistant')
    );

    expect(display).toMatchObject({ kind: 'message', role: 'assistant', label: 'assistant', text: 'hello\n\nworld' });
  });

  it('extracts assistant text from nested Claude message content objects', () => {
    const display = parseDisplayEvent(
      event({ message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }, 'assistant')
    );

    expect(display).toMatchObject({ kind: 'message', role: 'assistant', label: 'assistant', text: 'hello' });
  });

  it('extracts user text from simple message fields', () => {
    const display = parseDisplayEvent(event({ message: 'run the tests' }, 'user'));

    expect(display).toMatchObject({ kind: 'message', role: 'user', label: 'user', text: 'run the tests' });
  });

  it('extracts nested assistant tool uses as running tool display events', () => {
    const displays = parseDisplayEvents(
      event({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'pwd' } }] } }, 'assistant')
    );

    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({
      kind: 'tool',
      name: 'Bash',
      status: 'running',
      defaultOpen: true,
      input: '{\n  "command": "pwd"\n}'
    });
  });

  it('extracts nested user tool results as completed tool display events', () => {
    const displays = parseDisplayEvents(
      event({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok', is_error: false }] } }, 'user')
    );

    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({
      kind: 'tool',
      name: 'tool',
      status: 'complete',
      defaultOpen: false,
      output: 'ok'
    });
  });

  it('preserves mixed text and nested tool block order', () => {
    const displays = parseDisplayEvents(
      event(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'before' },
              { type: 'tool_use', name: 'Bash', input: { command: 'pwd' } },
              { type: 'text', text: 'after' }
            ]
          }
        },
        'assistant'
      )
    );

    expect(displays).toHaveLength(3);
    expect(displays.map((display) => display.kind)).toEqual(['message', 'tool', 'message']);
    expect(displays[0]).toMatchObject({ kind: 'message', text: 'before' });
    expect(displays[1]).toMatchObject({ kind: 'tool', name: 'Bash' });
    expect(displays[2]).toMatchObject({ kind: 'message', text: 'after' });
  });

  it('marks tool uses without results as running and expanded', () => {
    const display = parseDisplayEvent(event({ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }, 'tool'));

    expect(display).toMatchObject({ kind: 'tool', name: 'Bash', status: 'running', defaultOpen: true, input: '{\n  "command": "git status"\n}' });
  });

  it('marks tool results as complete and collapsed', () => {
    const display = parseDisplayEvent(event({ type: 'tool_result', name: 'Bash', content: [{ type: 'text', text: 'ok' }] }, 'tool'));

    expect(display).toMatchObject({ kind: 'tool', name: 'Bash', status: 'complete', defaultOpen: false, output: 'ok' });
  });

  it('marks tool errors as failed and collapsed', () => {
    const display = parseDisplayEvent(event({ type: 'tool_result', name: 'Read', error: 'file missing' }, 'tool'));

    expect(display).toMatchObject({ kind: 'tool', name: 'Read', status: 'error', defaultOpen: false, error: 'file missing' });
  });

  it('marks tool_result is_error payloads as failed and uses content as fallback error text', () => {
    const display = parseDisplayEvent(event({ type: 'tool_result', name: 'Read', is_error: true, content: 'file missing' }, 'tool'));

    expect(display).toMatchObject({ kind: 'tool', name: 'Read', status: 'error', defaultOpen: false, error: 'file missing' });
  });

  it('extracts error event text into a status block', () => {
    const display = parseDisplayEvent(event({ error: 'failed to start' }, 'error'));

    expect(display).toMatchObject({ kind: 'status', tone: 'error', label: 'error', text: 'failed to start' });
  });

  it('extracts raw line payloads into raw status blocks', () => {
    const display = parseDisplayEvent(event({ line: 'session started' }, 'raw'));

    expect(display).toMatchObject({ kind: 'status', tone: 'raw', label: 'raw', text: 'session started' });
  });

  it('keeps unknown raw payloads available as unknown display events', () => {
    const payload = { unexpected: { nested: true } };
    const display = parseDisplayEvent(event(payload, 'raw'));

    expect(display).toMatchObject({ kind: 'unknown', label: 'raw', raw: payload });
  });
});
