import type { UiEvent } from '../types';

const time = '2026-06-12T00:00:00Z';

function event(id: number, kind: UiEvent['kind'], payload: unknown): UiEvent {
  return { id, sessionId: 'fixture-session', time, kind, payload };
}

export const streamJsonCorpus = {
  plainMessages: [
    event(1, 'assistant', { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from Claude.' }] } }),
    event(2, 'user', { message: 'Thanks.' })
  ],
  markdownAndCode: [
    event(10, 'assistant', {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Use this:\n\n```ts\nconst ok = true;\n```' }] }
    })
  ],
  toolUseAndResult: [
    event(20, 'assistant', {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'toolu_ls', name: 'Bash', input: { command: 'ls web/src' } }] }
    }),
    event(21, 'user', {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_ls', content: 'App.tsx\nmain.tsx' }] }
    })
  ],
  failedTool: [
    event(30, 'tool', { type: 'tool_use', id: 'toolu_fail', name: 'Bash', input: { command: 'npm test' } }),
    event(31, 'tool', { type: 'tool_result', tool_use_id: 'toolu_fail', is_error: true, content: 'Command failed with exit code 1' })
  ],
  hiddenReadOnlyTool: [
    event(40, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/project/src/App.tsx' } }),
    event(41, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'export default function App() { return null; }' })
  ],
  backgroundTaskStartCompleteFail: [
    event(50, 'tool', {
      type: 'tool_use',
      id: 'toolu_bg_start',
      name: 'Bash',
      input: { command: 'npm --prefix web test', description: 'Run frontend tests', run_in_background: true }
    }),
    event(51, 'tool', {
      type: 'tool_result',
      tool_use_id: 'toolu_bg_start',
      content: 'Task started in background with ID bg_1. Output file: /tmp/claude-remote-web-fixture/test.log'
    }),
    event(52, 'tool', { type: 'tool_use', id: 'toolu_bg_done', name: 'TaskOutput', input: { task_id: 'bg_1' } }),
    event(53, 'tool', { type: 'tool_result', tool_use_id: 'toolu_bg_done', content: 'Tests passed' }),
    event(54, 'tool', { type: 'tool_use', id: 'toolu_bg_fail', name: 'TaskOutput', input: { task_id: 'bg_2' } }),
    event(55, 'tool', { type: 'tool_result', tool_use_id: 'toolu_bg_fail', is_error: true, content: 'Task failed: build error' })
  ],
  permissionWaitingEvent: [
    event(60, 'raw', { type: 'permission_request', tool_name: 'Bash', status: 'waiting', prompt: 'Allow command?' })
  ],
  stderrSystemError: [
    event(70, 'error', { line: 'stderr: failed to launch Claude helper' }),
    event(71, 'raw', { type: 'stderr', line: 'panic: helper crashed' })
  ],
  malformedUnknownPayload: [event(80, 'raw', { type: 'future_event', subtype: 'delta_chunk', payload: { nested: true } })],
  streamingText: [
    event(82, 'assistant', { type: 'message_start', message: { role: 'assistant', content: [] } }),
    event(83, 'assistant', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event(84, 'assistant', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
    event(85, 'assistant', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' streamed world.' } }),
    event(86, 'assistant', { type: 'content_block_stop', index: 0 }),
    event(87, 'assistant', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } }),
    event(88, 'assistant', { type: 'message_stop' })
  ],
  partialStreamingText: [
    event(89, 'raw', { type: 'message_start', message: { role: 'assistant', content: [] } }),
    event(90, 'raw', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } }),
    event(91, 'raw', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' response' } })
  ],
  streamingToolUse: [
    event(92, 'assistant', { type: 'message_start', message: { role: 'assistant', content: [] } }),
    event(93, 'tool', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_stream_read', name: 'Read', input: {} } }),
    event(94, 'tool', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path"' } }),
    event(95, 'tool', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ':"/tmp/stream.txt"}' } }),
    event(96, 'assistant', { type: 'content_block_stop', index: 0 }),
    event(97, 'assistant', { type: 'message_stop' }),
    event(98, 'tool', { type: 'tool_result', tool_use_id: 'toolu_stream_read', content: 'streamed file contents' })
  ],
  partialStreamingToolUse: [
    event(99, 'tool', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_partial', name: 'Bash', input: {} } }),
    event(100, 'tool', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"command":"npm' } })
  ],
  mixedStreamingMessage: [
    event(101, 'assistant', { type: 'message_start', message: { role: 'assistant', content: [] } }),
    event(102, 'assistant', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event(103, 'assistant', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will inspect it.' } }),
    event(104, 'tool', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_mixed', name: 'Bash', input: {} } }),
    event(105, 'tool', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"git status"}' } }),
    event(106, 'assistant', { type: 'message_stop' })
  ],
  interleavedEvents: [
    event(90, 'tool', { type: 'tool_use', id: 'toolu_read_interleaved', name: 'Read', input: { file_path: '/tmp/project/README.md' } }),
    event(91, 'assistant', { type: 'assistant', message: { content: [{ type: 'text', text: 'I am checking that file.' }] } }),
    event(92, 'tool', { type: 'tool_use', id: 'toolu_bash_interleaved', name: 'Bash', input: { command: 'npm --prefix web test' } }),
    event(93, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read_interleaved', content: '# Project' }),
    event(94, 'tool', { type: 'tool_result', tool_use_id: 'toolu_bash_interleaved', content: 'Tests passed' })
  ],
  outOfOrderToolResult: [
    event(100, 'tool', { type: 'tool_result', tool_use_id: 'toolu_late_use', name: 'Bash', content: 'late output' }),
    event(101, 'tool', { type: 'tool_use', id: 'toolu_late_use', name: 'Bash', input: { command: 'echo late' } })
  ]
} satisfies Record<string, UiEvent[]>;
