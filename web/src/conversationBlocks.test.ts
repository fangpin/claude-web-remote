import { describe, expect, it } from 'vitest';
import { buildConversationBlocks } from './conversationBlocks';
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

  it('renders direct system text events as readable message blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'system', { message: 'daemon notice' }),
      event(2, 'system', { status: 'session resumed' })
    ]);

    expect(blocks).toEqual([
      {
        id: 'message-system-1',
        type: 'message',
        role: 'system',
        text: 'daemon notice\n\nsession resumed',
        eventIds: [1, 2],
        rawEvents: [
          { id: 1, kind: 'system', payload: { message: 'daemon notice' } },
          { id: 2, kind: 'system', payload: { status: 'session resumed' } }
        ]
      }
    ]);
  });

  it('extracts assistant text and preserves Claude stream-json system content as raw details only', () => {
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
      },
      {
        id: 'raw-2',
        type: 'raw',
        label: 'system',
        eventIds: [2],
        rawEvents: [{ id: 2, kind: 'system', payload: systemPayload }]
      }
    ]);
  });

  it('preserves Claude stream-json user text content as raw details only', () => {
    const userPayload = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /tmp/skill' }] }
    };
    const blocks = buildConversationBlocks([event(1, 'user', userPayload)]);

    expect(blocks).toEqual([
      {
        id: 'raw-1',
        type: 'raw',
        label: 'user',
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
        inputSummary: '$ git status',
        resultSummary: 'clean',
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
      resultDisplay: 'collapsed',
      resultLabel: 'Result collapsed (12 chars)'
    });
  });

  it('marks Read Glob and Grep tool results as hidden by default', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a.txt' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'file contents' }),
      event(3, 'tool', { type: 'tool_use', id: 'toolu_glob', name: 'Glob', input: { pattern: '**/*.ts' } }),
      event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_glob', content: '/tmp/a.ts\n/tmp/b.ts' }),
      event(5, 'tool', { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'TODO' } }),
      event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_grep', content: 'line 1\nline 2' })
    ]);

    expect(blocks).toMatchObject([
      {
        id: 'tool-toolu_read',
        type: 'tool',
        name: 'Read',
        inputSummary: '/tmp/a.txt',
        resultDisplay: 'hidden',
        resultSummary: 'Read output hidden (13 chars)',
        resultLabel: 'Read output hidden (13 chars)'
      },
      {
        id: 'tool-toolu_glob',
        type: 'tool',
        name: 'Glob',
        inputSummary: '**/*.ts',
        resultDisplay: 'hidden',
        resultSummary: 'Matched 2 paths',
        resultLabel: 'Matched 2 paths'
      },
      {
        id: 'tool-toolu_grep',
        type: 'tool',
        name: 'Grep',
        inputSummary: '"TODO"',
        resultDisplay: 'hidden',
        resultSummary: 'Matched 2 lines',
        resultLabel: 'Matched 2 lines'
      }
    ]);
  });

  it('pairs nested Claude tool_use and tool_result content blocks', () => {
    const assistantPayload = {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/tmp/a.txt' } }] }
    };
    const userPayload = {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'contents' }] }
    };
    const blocks = buildConversationBlocks([event(1, 'assistant', assistantPayload), event(2, 'user', userPayload)]);

    expect(blocks).toEqual([
      {
        id: 'tool-toolu_1',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        inputSummary: '/tmp/a.txt',
        resultSummary: 'Read output hidden (8 chars)',
        resultDisplay: 'hidden',
        resultLabel: 'Read output hidden (8 chars)',
        eventIds: [1, 2],
        rawEvents: [
          { id: 1, kind: 'assistant', payload: assistantPayload },
          { id: 2, kind: 'user', payload: userPayload }
        ]
      }
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
        inputSummary: '/tmp/example.txt',
        resultSummary: '',
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
      resultDisplay: 'visible',
      resultLabel: 'Failed result shown (21 chars)',
      eventIds: [1, 2]
    });
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
      {
        id: 'tool-toolu_success_text',
        type: 'tool',
        status: 'completed',
        inputSummary: '$ npm test',
        resultSummary: 'Found 0 errors',
        resultDisplay: 'collapsed',
        resultLabel: 'Result collapsed (14 chars)'
      },
      {
        id: 'tool-toolu_no_errors',
        type: 'tool',
        status: 'completed',
        inputSummary: '/tmp/report.txt',
        resultSummary: 'Read output hidden (18 chars)',
        resultDisplay: 'hidden',
        resultLabel: 'Read output hidden (18 chars)'
      },
      {
        id: 'tool-toolu_structured_error',
        type: 'tool',
        status: 'failed',
        inputSummary: '/tmp/missing.txt',
        resultSummary: 'file missing',
        resultDisplay: 'visible',
        resultLabel: 'Failed result shown (12 chars)'
      },
      {
        id: 'tool-toolu_status_error',
        type: 'tool',
        status: 'failed',
        inputSummary: '/tmp/missing2.txt',
        resultSummary: 'missing2',
        resultDisplay: 'visible',
        resultLabel: 'Failed result shown (8 chars)'
      },
      {
        id: 'tool-toolu_failed_text',
        type: 'tool',
        status: 'failed',
        inputSummary: '$ npm test',
        resultSummary: 'Command failed with exit code 1',
        resultDisplay: 'visible',
        resultLabel: 'Failed result shown (31 chars)'
      }
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
        id: 'task-toolu_list',
        type: 'task',
        title: 'Task list',
        source: 'Task list',
        status: 'completed',
        summary: 'Completed.',
        completionSummary: '1 pending task',
        eventIds: [5, 6]
      },
      {
        id: 'task-toolu_get',
        type: 'task',
        title: 'Task #7',
        source: 'Task lookup',
        status: 'completed',
        summary: 'Completed.',
        completionSummary: 'Task #7: Add tests',
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

  it('preserves Node TLS warning stderr lines as raw details only', () => {
    const firstPayload = {
      line: "(node:3972575) Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED environment variable to '0' makes TLS connections and HTTPS requests insecure by disabling certificate verification."
    };
    const secondPayload = { line: 'Use `node --trace-warnings ...` to show where the warning was created' };
    const blocks = buildConversationBlocks([
      event(1, 'error', firstPayload),
      event(2, 'error', secondPayload)
    ]);

    expect(blocks).toEqual([
      {
        id: 'raw-1',
        type: 'raw',
        label: 'error',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'error', payload: firstPayload }]
      },
      {
        id: 'raw-2',
        type: 'raw',
        label: 'error',
        eventIds: [2],
        rawEvents: [{ id: 2, kind: 'error', payload: secondPayload }]
      }
    ]);
  });

  it('preserves unknown events as raw blocks', () => {
    const blocks = buildConversationBlocks([event(1, 'raw', { unexpected: { nested: true } })]);

    expect(blocks).toEqual([
      {
        id: 'raw-1',
        type: 'raw',
        label: 'raw',
        eventIds: [1],
        rawEvents: [{ id: 1, kind: 'raw', payload: { unexpected: { nested: true } } }]
      }
    ]);
  });
});
