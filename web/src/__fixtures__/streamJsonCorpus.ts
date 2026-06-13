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
