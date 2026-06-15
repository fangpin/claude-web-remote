import { describe, expect, it } from 'vitest';
import { buildConversationBlocks } from './conversationBlocks';
import { streamJsonCorpus } from './__fixtures__/streamJsonCorpus';
import type { UiEvent } from './types';

function event(id: number, kind: UiEvent['kind'], payload: unknown): UiEvent {
  return {
    id,
    sessionId: 's1',
    time: '2026-06-12T00:00:00Z',
    kind,
    payload
  };
}

describe('buildConversationBlocks', () => {
  it('merges consecutive same-role text events into one message block', () => {
    const blocks = buildConversationBlocks([
      event(1, 'assistant', { message: 'hello' }),
      event(2, 'assistant', { text: 'from claude' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'message-assistant-1',
        type: 'message',
        role: 'assistant',
        text: 'hello\n\nfrom claude',
        eventIds: [1, 2],
        rawEvents: [
          { id: 1, kind: 'assistant', payload: { message: 'hello' } },
          { id: 2, kind: 'assistant', payload: { text: 'from claude' } }
        ]
      }
    ]);
  });

  it('merges consecutive user text events into one message block', () => {
    const blocks = buildConversationBlocks([
      event(1, 'user', { message: 'first instruction' }),
      event(2, 'user', { text: 'second instruction' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'message-user-1',
        type: 'message',
        role: 'user',
        text: 'first instruction\n\nsecond instruction',
        eventIds: [1, 2],
        rawEvents: [
          { id: 1, kind: 'user', payload: { message: 'first instruction' } },
          { id: 2, kind: 'user', payload: { text: 'second instruction' } }
        ]
      }
    ]);
  });

  it('hides system text events from conversation blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'system', { message: 'daemon notice' }),
      event(2, 'system', { status: 'session resumed' })
    ]);

    expect(blocks).toEqual([]);
  });

  it('keeps chat projection defaults when no display mode is passed', () => {
    const blocks = buildConversationBlocks([
      event(1, 'system', { message: 'daemon notice' }),
      event(2, 'raw', { type: 'result', subtype: 'success' }),
      event(3, 'raw', { message: 'transport detail' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'raw-3', type: 'raw', label: 'Unknown event', severity: 'warning' }
    ]);
  });

  it('projects hidden system and metadata events as raw blocks in debug mode', () => {
    const blocks = buildConversationBlocks([
      event(1, 'system', { message: 'daemon notice' }),
      event(2, 'raw', { type: 'result', subtype: 'success' }),
      event(3, 'user', { type: 'user', message: { content: [{ type: 'text', text: 'internal wrapper' }] } })
    ], { displayMode: 'debug' });

    expect(blocks).toMatchObject([
      { id: 'raw-1', type: 'raw', label: 'System event', severity: 'info', eventIds: [1] },
      { id: 'raw-2', type: 'raw', label: 'Raw event', severity: 'info', eventIds: [2] },
      { id: 'raw-3', type: 'raw', label: 'Raw event', severity: 'info', eventIds: [3] }
    ]);
  });

  it('extracts assistant text and hides Claude stream-json system content', () => {
    const assistantPayload = { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } };
    const systemPayload = { type: 'system', content: [{ type: 'text', text: 'session ready' }] };
    const blocks = buildConversationBlocks([
      event(1, 'assistant', assistantPayload),
      event(2, 'system', systemPayload)
    ]);

    expect(blocks).toEqual([
      {
        id: 'message-assistant-1',
        type: 'message',
        role: 'assistant',
        text: 'done',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'assistant', payload: assistantPayload }]
      }
    ]);
  });

  it('keeps Claude stream-json user wrappers out of the visible transcript', () => {
    const userPayload = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /tmp/skill' }] }
    };
    const blocks = buildConversationBlocks([event(1, 'user', userPayload)]);

    expect(blocks).toEqual([
      {
        id: 'anchor-event-1',
        type: 'anchor',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'user', payload: userPayload }]
      }
    ]);
  });

  it('pairs tool_use and tool_result events with the same tool_use_id', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_1', content: 'clean' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'tool-toolu_1',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        density: 'compact',
        inputSummary: '$ git status',
        resultSummary: 'clean',
        resultKind: 'text',
        resultDisplay: 'collapsed',
        resultLabel: 'Result collapsed (5 chars)',
        eventIds: [1, 2],
        rawEvents: [
          { id: 1, kind: 'tool', payload: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } } },
          { id: 2, kind: 'tool', payload: { type: 'tool_result', tool_use_id: 'toolu_1', content: 'clean' } }
        ]
      }
    ]);
  });

  it('marks Bash tool results as collapsed by default', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm test' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_bash', content: 'large stdout' })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'tool-toolu_bash',
      type: 'tool',
      name: 'Bash',
      status: 'completed',
      inputSummary: '$ npm test',
      resultSummary: 'large stdout',
      resultKind: 'text',
      resultDisplay: 'collapsed',
      resultLabel: 'Result collapsed (12 chars)'
    });
  });

  it('hides completed Read Glob and Grep tool blocks behind anchors', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a.txt' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'file contents' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_glob', name: 'Glob', input: { pattern: '**/*.ts' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_glob', content: '/tmp/a.ts\n/tmp/b.ts' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'TODO' } }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_grep', content: 'line 1\nline 2' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'anchor-toolu_read-2', type: 'anchor', eventIds: [1, 2] },
      { id: 'anchor-toolu_glob-4', type: 'anchor', eventIds: [3, 4] },
      { id: 'anchor-toolu_grep-6', type: 'anchor', eventIds: [5, 6] }
    ]);
  });

  it('hides completed nested Claude Read tool_use and tool_result content blocks behind an anchor', () => {
    const assistantPayload = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.txt' } }] }
    };
    const userPayload = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'contents' }] }
    };
    const blocks = buildConversationBlocks([event(1, 'assistant', assistantPayload), event(2, 'user', userPayload)]);

    expect(blocks).toMatchObject([{ id: 'anchor-toolu_1-2', type: 'anchor', eventIds: [1, 2] }]);
  });

  it('adjusts pending tool indexes after hiding a completed read-only tool', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a.txt' } }),
      event(2, 'tool', { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm test' } }),
      event(3, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'file contents' }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_bash', content: 'tests passed' })
    ]);

    expect(blocks).toMatchObject([
      {
        id: 'anchor-toolu_read-3',
        type: 'anchor',
        eventIds: [1, 3]
      },
      {
        id: 'tool-toolu_bash',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        resultSummary: 'tests passed',
        resultDisplay: 'collapsed',
        eventIds: [2, 4]
      }
    ]);
  });

  it('skips hidden standalone tool results', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_result', name: 'Read', content: 'file contents' }),
      event(2, 'tool', { type: 'tool_result', name: 'Bash', content: 'tests passed' })
    ]);

    expect(blocks).toMatchObject([
      {
        id: 'tool-result-2',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        resultSummary: 'tests passed',
        resultDisplay: 'collapsed'
      }
    ]);
  });

  it('collapses successful Bash output and expands failed Bash output', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_ok', name: 'Bash', input: { command: 'npm test' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_ok', content: 'tests passed' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_fail', name: 'Bash', input: { command: 'npm test' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_fail', content: 'Command failed with exit code 1' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'tool-toolu_ok', type: 'tool', status: 'completed', resultDisplay: 'collapsed' },
      { id: 'tool-toolu_fail', type: 'tool', status: 'failed', resultDisplay: 'visible' }
    ]);
  });

  it('renders ordinary tools as running until they receive results', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/example.txt' } })
    ]);

    expect(blocks).toEqual([
      {
        id: 'tool-toolu_read',
        type: 'tool',
        name: 'Read',
        status: 'running',
        density: 'compact',
        inputSummary: '/tmp/example.txt',
        resultSummary: '',
        resultKind: 'text',
        resultDisplay: 'visible',
        resultLabel: 'Waiting for result',
        eventIds: [1],
        rawEvents: [
          { id: 1, kind: 'tool', payload: { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/example.txt' } } }
        ]
      }
    ]);
  });

  it('renders ordinary tool results containing errors as failed', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/missing.txt' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'Error: file not found' })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'tool-toolu_read',
      type: 'tool',
      name: 'Read',
      status: 'failed',
      inputSummary: '/tmp/missing.txt',
      resultSummary: 'Error: file not found',
      resultKind: 'text',
      resultDisplay: 'visible',
      resultLabel: 'Failed result shown (21 chars)',
      eventIds: [1, 2]
    });
  });

  it('uses shared compact summary input for Bash, Read, and Edit blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/repo/a.ts', offset: 1, limit: 2 } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', is_error: true, content: 'Error: missing' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'web/src/App.tsx', old_string: 'old', new_string: 'new' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_edit', content: 'updated' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'tool-toolu_read', type: 'tool', inputSummary: '/repo/a.ts (offset 1, limit 2)' },
      { id: 'tool-toolu_edit', type: 'tool', inputSummary: 'web/src/App.tsx · replace "old" -> "new"' }
    ]);
  });

  it('classifies tool result semantics for diff, code, and path output', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_diff', name: 'Bash', input: { command: 'git diff' } }),
      event(2, 'tool', {
        type: 'tool_result',
        tool_use_id: 'toolu_diff',
        content: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n@@ -1 +1 @@\n-old\n+new'
      }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/repo/web/src/App.tsx' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', is_error: true, content: 'const value: string = "ok";' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_list', name: 'Bash', input: { command: 'rg --files web/src' } }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_list', content: 'web/src/App.tsx\nweb/src/ConversationBlockList.tsx' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'tool-toolu_diff', type: 'tool', resultKind: 'diff', resultLanguage: 'diff', resultDisplay: 'collapsed' },
      {
        id: 'tool-toolu_read',
        type: 'tool',
        status: 'failed',
        resultKind: 'code',
        resultLanguage: 'tsx',
        resultDisplay: 'visible'
      },
      { id: 'anchor-toolu_list-6', type: 'anchor' }
    ]);
  });

  it('uses structured result fields for failure status without matching successful error text', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_success_text', name: 'Bash', input: { command: 'npm test' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_success_text', content: 'Found 0 errors' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_no_errors', name: 'Read', input: { file_path: '/tmp/report.txt' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_no_errors', content: 'No errors detected' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_structured_error', name: 'Read', input: { file_path: '/tmp/missing.txt' } }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_structured_error', is_error: true, content: 'file missing' }),
      event(7, 'tool', { type: 'tool_use', id: 'toolu_status_error', name: 'Read', input: { file_path: '/tmp/missing2.txt' } }),
      event(8, 'tool', { type: 'tool_result', tool_use_id: 'toolu_status_error', status: 'error', content: 'missing2' }),
      event(9, 'tool', { type: 'tool_use', id: 'toolu_failed_text', name: 'Bash', input: { command: 'npm test' } }),
      event(10, 'tool', { type: 'tool_result', tool_use_id: 'toolu_failed_text', content: 'Command failed with exit code 1' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'tool-toolu_success_text', type: 'tool', status: 'completed', resultSummary: 'Found 0 errors', resultDisplay: 'collapsed' },
      { id: 'anchor-toolu_no_errors-4', type: 'anchor', eventIds: [3, 4] },
      { id: 'tool-toolu_structured_error', type: 'tool', status: 'failed', resultSummary: 'file missing', resultDisplay: 'visible' },
      { id: 'tool-toolu_status_error', type: 'tool', status: 'failed', resultSummary: 'missing2', resultDisplay: 'visible' },
      { id: 'tool-toolu_failed_text', type: 'tool', status: 'failed', resultSummary: 'Command failed with exit code 1', resultDisplay: 'visible' }
    ]);
  });

  it('renders background Bash as a running task block with output path', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_bg',
        name: 'Bash',
        input: { command: 'npm --prefix web test', run_in_background: true, description: 'Run frontend tests' }
      }),
      event(2, 'tool', {
        type: 'tool_result',
        tool_use_id: 'toolu_bg',
        content: 'Task started in background with ID abc123. Output file: /tmp/test.log'
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_bg',
      type: 'task',
      title: 'Run frontend tests',
      source: 'Background Bash',
      status: 'running',
      summary: 'Started in background (ID abc123).',
      detail: 'npm --prefix web test',
      outputPath: '/tmp/test.log',
      eventIds: [1, 2]
    });
  });

  it('classifies background Bash from result text even without run_in_background input', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_bg_text',
        name: 'Bash',
        input: { command: 'npm --prefix web run build', description: 'Run frontend build' }
      }),
      event(2, 'tool', {
        type: 'tool_result',
        tool_use_id: 'toolu_bg_text',
        content: 'Task started in background with ID build123. Output file: /tmp/build.log'
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_bg_text',
      type: 'task',
      title: 'Run frontend build',
      source: 'Background Bash',
      status: 'running',
      summary: 'Started in background (ID build123).',
      detail: 'npm --prefix web run build',
      outputPath: '/tmp/build.log',
      eventIds: [1, 2]
    });
  });

  it('renders Agent subagent calls as task blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_agent',
        name: 'Agent',
        input: { description: 'Explore output rendering', subagent_type: 'Explore', prompt: 'Find rendering files' }
      }),
      event(2, 'tool', {
        type: 'tool_result',
        tool_use_id: 'toolu_agent',
        content: 'Found ConversationBlockList.tsx and App.tsx'
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_agent',
      type: 'task',
      title: 'Explore output rendering',
      source: 'Explore subagent',
      status: 'completed',
      summary: 'Completed.',
      completionSummary: 'Found ConversationBlockList.tsx and App.tsx',
      eventIds: [1, 2]
    });
  });

  it('renders TaskUpdate tools as task blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_task',
        name: 'TaskUpdate',
        input: { taskId: '3', status: 'completed' }
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_task',
      type: 'task',
      title: 'Task #3',
      source: 'Task update',
      status: 'completed',
      summary: 'Marked completed.',
      eventIds: [1]
    });
  });

  it('does not let TaskUpdate completed input status mask a failed result', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_task_failed',
        name: 'TaskUpdate',
        input: { taskId: '3', status: 'completed' }
      }),
      event(2, 'tool', {
        type: 'tool_result',
        tool_use_id: 'toolu_task_failed',
        is_error: true,
        content: 'Task update failed'
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_task_failed',
      type: 'task',
      title: 'Task #3',
      source: 'Task update',
      status: 'failed',
      summary: 'Failed.',
      failureSummary: 'Task update failed',
      eventIds: [1, 2]
    });
  });

  it('renders Workflow and task management tools as task blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', {
        type: 'tool_use',
        id: 'toolu_workflow',
        name: 'Workflow',
        input: { description: 'Coordinate implementation', prompt: 'Run the workflow' }
      }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_workflow', content: 'Workflow complete' }),
      event(3, 'tool', {
        type: 'tool_use',
        id: 'toolu_create',
        name: 'TaskCreate',
        input: { subject: 'Add tests', description: 'Add missing coverage' }
      }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_create', content: 'Task #7 created successfully' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_list', name: 'TaskList', input: {} }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_list', content: '1 pending task' }),
      event(7, 'tool', { type: 'tool_use', id: 'toolu_get', name: 'TaskGet', input: { taskId: '7' } }),
      event(8, 'tool', { type: 'tool_result', tool_use_id: 'toolu_get', content: 'Task #7: Add tests' }),
      event(9, 'tool', { type: 'tool_use', id: 'toolu_output', name: 'TaskOutput', input: { task_id: 'bg123' } }),
      event(10, 'tool', { type: 'tool_result', tool_use_id: 'toolu_output', content: 'Build output ready' }),
      event(11, 'tool', { type: 'tool_use', id: 'toolu_stop', name: 'TaskStop', input: { task_id: 'bg123' } }),
      event(12, 'tool', { type: 'tool_result', tool_use_id: 'toolu_stop', content: 'Stopped task bg123' })
    ]);

    expect(blocks).toMatchObject([
      {
        id: 'task-toolu_workflow',
        type: 'task',
        title: 'Coordinate implementation',
        source: 'Workflow',
        status: 'completed',
        summary: 'Completed.',
        completionSummary: 'Workflow complete',
        eventIds: [1, 2]
      },
      {
        id: 'task-toolu_create',
        type: 'task',
        title: 'Add tests',
        source: 'Task create',
        status: 'pending',
        summary: 'Task #7 created successfully',
        eventIds: [3, 4]
      },
      {
        id: 'anchor-toolu_list-6',
        type: 'anchor',
        eventIds: [5, 6]
      },
      {
        id: 'anchor-toolu_get-8',
        type: 'anchor',
        eventIds: [7, 8]
      },
      {
        id: 'task-toolu_output',
        type: 'task',
        title: 'Task output',
        source: 'Task output',
        status: 'completed',
        summary: 'Completed.',
        detail: 'bg123',
        completionSummary: 'Build output ready',
        eventIds: [9, 10]
      },
      {
        id: 'task-toolu_stop',
        type: 'task',
        title: 'Stop task',
        source: 'Task control',
        status: 'completed',
        summary: 'Completed.',
        detail: 'bg123',
        completionSummary: 'Stopped task bg123',
        eventIds: [11, 12]
      }
    ]);
  });

  it('renders error events as error blocks with useful messages', () => {
    const blocks = buildConversationBlocks([event(1, 'error', { error: 'failed to start' })]);

    expect(blocks).toEqual([
      {
        id: 'error-1',
        type: 'error',
        message: 'failed to start',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'error', payload: { error: 'failed to start' } }]
      }
    ]);
  });

  it('hides Node TLS warning stderr lines from conversation blocks', () => {
    const firstPayload = {
      line: "(node:3972575) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification."
    };
    const secondPayload = { line: 'Use `node --trace-warnings ...` to show where the warning was created' };
    const blocks = buildConversationBlocks([
      event(1, 'error', firstPayload),
      event(2, 'error', secondPayload)
    ]);

    expect(blocks).toEqual([]);
  });

  it('renders unknown raw events with a subdued user-facing label while hiding system events', () => {
    const blocks = buildConversationBlocks([
      event(1, 'raw', { message: 'transport detail' }),
      event(2, 'system', { message: 'session detail' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'raw-1',
        type: 'raw',
        label: 'Unknown event',
        severity: 'warning',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'raw', payload: { message: 'transport detail' } }]
      }
    ]);
  });

  it('hides successful Claude result events while preserving failed result events', () => {
    const blocks = buildConversationBlocks([
      event(1, 'raw', { type: 'result', subtype: 'success', duration_ms: 1250 }),
      event(2, 'raw', { type: 'result', status: 'success' }),
      event(3, 'raw', { type: 'result', subtype: 'error', error: 'command failed' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'error-3',
        type: 'error',
        message: 'command failed',
        eventIds: [3],
        rawEvents: [{ id: 3, kind: 'raw', payload: { type: 'result', subtype: 'error', error: 'command failed' } }]
      }
    ]);
  });

  it('covers representative Claude stream-json corpus shapes with stable blocks', () => {
    expect(buildConversationBlocks(streamJsonCorpus.plainMessages)).toMatchObject([
      { type: 'message', role: 'assistant', text: 'Hello from Claude.' },
      { type: 'message', role: 'user', text: 'Thanks.' }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.markdownAndCode)).toMatchObject([
      { type: 'message', role: 'assistant', text: 'Use this:\n\n```ts\nconst ok = true;\n```' }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.toolUseAndResult)).toMatchObject([
      {
        id: 'anchor-toolu_ls-21',
        type: 'anchor',
        eventIds: [20, 21]
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.failedTool)).toMatchObject([
      {
        id: 'tool-toolu_fail',
        type: 'tool',
        name: 'Bash',
        status: 'failed',
        resultSummary: 'Command failed with exit code 1',
        resultDisplay: 'visible'
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.hiddenReadOnlyTool)).toMatchObject([
      { id: 'anchor-toolu_read-41', type: 'anchor', eventIds: [40, 41] }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.backgroundTaskStartCompleteFail)).toMatchObject([
      {
        id: 'task-toolu_bg_start',
        type: 'task',
        source: 'Background Bash',
        status: 'running',
        outputPath: '/tmp/claude-remote-web-fixture/test.log'
      },
      {
        id: 'task-toolu_bg_done',
        type: 'task',
        source: 'Task output',
        status: 'completed',
        completionSummary: 'Tests passed'
      },
      {
        id: 'task-toolu_bg_fail',
        type: 'task',
        source: 'Task output',
        status: 'failed',
        failureSummary: 'Task failed: build error'
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.permissionWaitingEvent)).toMatchObject([
      { id: 'raw-60', type: 'raw', label: 'Permission event', severity: 'permission', eventIds: [60] }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.stderrSystemError)).toMatchObject([
      { id: 'error-70', type: 'error', message: 'stderr: failed to launch Claude helper' },
      { id: 'error-71', type: 'error', message: 'panic: helper crashed' }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.malformedUnknownPayload)).toMatchObject([
      { id: 'raw-80', type: 'raw', label: 'Unknown event', severity: 'warning', eventIds: [80] }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.streamingText)).toMatchObject([
      {
        id: 'message-assistant-83',
        type: 'message',
        role: 'assistant',
        text: 'Hello streamed world.',
        eventIds: [82, 83, 84, 85, 86, 87, 88]
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.partialStreamingText)).toMatchObject([
      {
        id: 'message-assistant-90',
        type: 'message',
        role: 'assistant',
        text: 'Partial response',
        eventIds: [89, 90, 91]
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.streamingToolUse)).toMatchObject([
      { id: 'anchor-toolu_stream_read-98', type: 'anchor', eventIds: [92, 93, 94, 95, 96, 97, 98] }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.partialStreamingToolUse)).toMatchObject([
      {
        id: 'tool-toolu_partial',
        type: 'tool',
        name: 'Bash',
        status: 'running',
        inputSummary: '{"command":"npm',
        eventIds: [99, 100]
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.mixedStreamingMessage)).toMatchObject([
      {
        id: 'message-assistant-102',
        type: 'message',
        role: 'assistant',
        text: 'I will inspect it.',
        eventIds: [101, 102, 103, 106]
      },
      {
        id: 'tool-toolu_mixed',
        type: 'tool',
        name: 'Bash',
        status: 'running',
        inputSummary: '$ git status',
        eventIds: [101, 104, 105, 106]
      }
    ]);

    expect(buildConversationBlocks(streamJsonCorpus.interleavedEvents)).toMatchObject([
      { id: 'anchor-toolu_read_interleaved-93', type: 'anchor', eventIds: [90, 93] },
      { id: 'message-assistant-91', type: 'message', role: 'assistant', text: 'I am checking that file.' },
      {
        id: 'tool-toolu_bash_interleaved',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        resultSummary: 'Tests passed',
        eventIds: [92, 94]
      }
    ]);
  });

  it('pairs out-of-order tool results when the matching tool_use arrives later', () => {
    const blocks = buildConversationBlocks(streamJsonCorpus.outOfOrderToolResult);

    expect(blocks).toMatchObject([
      {
        id: 'tool-toolu_late_use',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: '$ echo late',
        resultSummary: 'late output',
        eventIds: [101, 100]
      }
    ]);
  });

  it('hides noisy raw metadata and internal bookkeeping cards by default', () => {
    const blocks = buildConversationBlocks([
      event(1, 'raw', { type: 'result', subtype: 'success' }),
      event(2, 'user', { type: 'user', message: { content: [{ type: 'text', text: 'internal wrapper' }] } }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_list', name: 'TaskList', input: {} }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_list', content: '1 task' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_get', name: 'TaskGet', input: { taskId: '1' } }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_get', content: 'Task #1' }),
      event(7, 'tool', { type: 'tool_use', id: 'toolu_update', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }),
      event(8, 'tool', { type: 'tool_result', tool_use_id: 'toolu_update', content: 'updated' }),
      event(9, 'tool', { type: 'tool_use', id: 'toolu_ls', name: 'Bash', input: { command: 'ls web/src' } }),
      event(10, 'tool', { type: 'tool_result', tool_use_id: 'toolu_ls', content: 'App.tsx' })
    ]);

    expect(blocks.every((block) => block.type === 'anchor')).toBe(true);
  });

  it('renders meaningful task and command work as compact instead of prominent full cards', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_create', name: 'TaskCreate', input: { subject: 'Fix output rendering' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_create', content: 'Task #1 created successfully' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_test', name: 'Bash', input: { command: 'npm --prefix web test' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_test', content: 'Tests passed' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'task-toolu_create', type: 'task', title: 'Fix output rendering', density: 'compact' },
      { id: 'tool-toolu_test', type: 'tool', name: 'Bash', density: 'compact', resultDisplay: 'collapsed' }
    ]);
  });

  it('keeps failed task updates and permission raw events visible', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_update_failed', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_update_failed', is_error: true, content: 'Task update failed' }),
      event(3, 'raw', { type: 'permission_request', status: 'waiting', prompt: 'Allow command?' })
    ]);

    expect(blocks).toMatchObject([
      { id: 'task-toolu_update_failed', type: 'task', status: 'failed', failureSummary: 'Task update failed' },
      { id: 'raw-3', type: 'raw', label: 'Permission event', severity: 'permission' }
    ]);
  });
});
