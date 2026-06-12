# Claude App Output Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-event output cards with Claude app-style conversation blocks while preserving raw event payloads and showing background/agent/workflow activity as task blocks.

**Architecture:** Keep the Rust event stream and `UiEvent` contract unchanged. Add a frontend-only `buildConversationBlocks(events)` adapter that groups raw events into display blocks, then render those blocks through focused React components with raw JSON details collapsed.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing REST/WebSocket APIs.

---

## File structure

- Create `web/src/conversationBlocks.ts` — pure event-to-block classification, text extraction, tool pairing, task detection, and raw payload preservation.
- Create `web/src/conversationBlocks.test.ts` — focused unit tests for the block builder.
- Create `web/src/RawEventDetails.tsx` — reusable collapsed raw JSON renderer.
- Create `web/src/ConversationBlockList.tsx` — block list renderer and block-specific presentation components.
- Create `web/src/ConversationBlockList.test.tsx` — component tests for message, tool, task, error, and raw fallback rendering.
- Modify `web/src/App.tsx` — render `ConversationBlockList` instead of mapping `EventCard` for every raw event.
- Modify `web/src/App.test.tsx` — assert WebSocket events flow through block rendering, including a task-like event.
- Modify `web/src/App.css` — replace `.event*` styling with conversation block, tool, task, and raw details styles.
- Modify `web/src/EventCard.tsx` and `web/src/EventCard.test.tsx` — remove from the main path by deleting these files after the block renderer is wired.
- Create `AGENTS.md` — project guidance for future agents to align output UX with Claude Code app hierarchy.

## Task 1: Add conversation block builder

**Files:**
- Create: `web/src/conversationBlocks.ts`
- Create: `web/src/conversationBlocks.test.ts`

- [ ] **Step 1: Write failing tests for text, tool pairing, task detection, and raw fallback**

Create `web/src/conversationBlocks.test.ts`:

```ts
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
  it('merges consecutive assistant text events into one message block', () => {
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

  it('pairs tool_use and tool_result events with the same tool_use_id', () => {
    const blocks = buildConversationBlocks([
      event(1, 'tool', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git status' } }),
      event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_1', content: 'clean' })
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'tool-toolu_1',
      type: 'tool',
      name: 'Bash',
      status: 'completed',
      inputSummary: 'command: git status',
      resultSummary: 'clean',
      eventIds: [1, 2]
    });
  });

  it('renders background Bash results as task blocks instead of ordinary tool blocks', () => {
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

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_bg',
      type: 'task',
      title: 'Run frontend tests',
      source: 'Bash',
      status: 'running',
      summary: 'Task started in background with ID abc123. Output file: /tmp/test.log',
      outputPath: '/tmp/test.log',
      eventIds: [1, 2]
    });
  });

  it('renders Agent tool calls as task blocks', () => {
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
        content: 'Found EventCard.tsx and App.tsx'
      })
    ]);

    expect(blocks[0]).toMatchObject({
      id: 'task-toolu_agent',
      type: 'task',
      title: 'Explore output rendering',
      source: 'Explore agent',
      status: 'completed',
      summary: 'Found EventCard.tsx and App.tsx'
    });
  });

  it('renders workflow and task-list tools as task blocks', () => {
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
      title: 'TaskUpdate #3',
      source: 'TaskUpdate',
      status: 'completed',
      summary: 'status: completed'
    });
  });

  it('preserves unknown events as raw blocks', () => {
    const blocks = buildConversationBlocks([
      event(1, 'raw', { unexpected: { nested: true } })
    ]);

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --prefix web test -- conversationBlocks.test.ts
```

Expected: FAIL with an import error like `Failed to resolve import "./conversationBlocks"`.

- [ ] **Step 3: Implement the block builder**

Create `web/src/conversationBlocks.ts`:

```ts
import type { EventKind, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

export type RawEventRef = {
  id: number;
  kind: EventKind;
  payload: unknown;
};

export type MessageBlock = {
  id: string;
  type: 'message';
  role: 'assistant' | 'user' | 'system';
  text: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ToolBlock = {
  id: string;
  type: 'tool';
  name: string;
  status: 'running' | 'completed' | 'failed';
  inputSummary: string;
  resultSummary: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type TaskBlock = {
  id: string;
  type: 'task';
  title: string;
  source: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  summary: string;
  outputPath?: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ErrorBlock = {
  id: string;
  type: 'error';
  message: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type RawBlock = {
  id: string;
  type: 'raw';
  label: string;
  eventIds: number[];
  rawEvents: RawEventRef[];
};

export type ConversationBlock = MessageBlock | ToolBlock | TaskBlock | ErrorBlock | RawBlock;

type PendingTool = {
  event: UiEvent;
  payload: ObjectPayload;
  index: number;
};

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawEvent(event: UiEvent): RawEventRef {
  return { id: event.id, kind: event.kind, payload: event.payload };
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function payloadType(event: UiEvent, payload: ObjectPayload): string {
  return typeof payload.type === 'string' ? payload.type : event.kind;
}

function toolName(payload: ObjectPayload): string {
  return stringField(payload, ['name', 'tool_name', 'toolName']) ?? 'tool';
}

function textContent(payload: ObjectPayload): string | null {
  const direct = stringField(payload, ['message', 'text', 'content', 'status', 'error']);
  if (direct) return direct;

  const message = payload.message;
  if (isObject(message)) return stringField(message, ['content', 'text']);

  return null;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(summarize).filter(Boolean).join('\n');
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '';
    return entries
      .map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`)
      .join(', ');
  }
  return String(value);
}

function toolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['id', 'tool_use_id', 'toolUseId']);
}

function resultToolUseId(payload: ObjectPayload): string | null {
  return stringField(payload, ['tool_use_id', 'toolUseId', 'id']);
}

function resultSummary(payload: ObjectPayload): string {
  return summarize(payload.result ?? payload.content ?? payload.output ?? payload.error ?? payload.message ?? '');
}

function commandDescription(input: unknown): string | null {
  if (!isObject(input)) return null;
  return stringField(input, ['description']) ?? stringField(input, ['command']);
}

function isBackgroundBash(name: string, input: unknown, result: string): boolean {
  if (name !== 'Bash' || !isObject(input)) return false;
  return input.run_in_background === true || /Task started in background|Output file:/i.test(result);
}

function isTaskTool(name: string): boolean {
  return ['Agent', 'Workflow', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskOutput', 'TaskStop'].includes(name);
}

function outputPath(summary: string): string | undefined {
  const match = summary.match(/Output file:\s*(\S+)/i);
  return match?.[1];
}

function taskStatus(name: string, input: unknown, result: string, hasResult: boolean): TaskBlock['status'] {
  if (isObject(input) && typeof input.status === 'string') {
    if (input.status === 'completed') return 'completed';
    if (input.status === 'pending') return 'pending';
    if (input.status === 'failed') return 'failed';
    if (input.status === 'in_progress') return 'running';
  }
  if (/failed|error/i.test(result)) return 'failed';
  if (/Task started in background/i.test(result)) return 'running';
  if (name === 'TaskCreate') return 'pending';
  return hasResult ? 'completed' : 'running';
}

function taskTitle(name: string, input: unknown): string {
  if (!isObject(input)) return name;
  if (typeof input.description === 'string' && input.description.trim()) return input.description;
  if (typeof input.subject === 'string' && input.subject.trim()) return input.subject;
  if (typeof input.taskId === 'string' && input.taskId.trim()) return `${name} #${input.taskId}`;
  if (typeof input.command === 'string' && input.command.trim()) return input.command;
  return name;
}

function taskSource(name: string, input: unknown): string {
  if (name === 'Agent' && isObject(input)) {
    const subagent = stringField(input, ['subagent_type', 'subagentType']);
    return subagent ? `${subagent} agent` : 'Agent';
  }
  return name;
}

function makeToolBlock(use: PendingTool, resultEvent: UiEvent | null, resultPayload: ObjectPayload | null): ToolBlock | TaskBlock {
  const name = toolName(use.payload);
  const input = use.payload.input;
  const inputSummary = summarize(input);
  const result = resultPayload ? resultSummary(resultPayload) : '';
  const events = resultEvent ? [use.event, resultEvent] : [use.event];
  const raws = events.map(rawEvent);
  const id = toolUseId(use.payload) ?? String(use.event.id);
  const taskLike = isBackgroundBash(name, input, result) || isTaskTool(name);

  if (taskLike) {
    const summary = result || commandDescription(input) || inputSummary;
    return {
      id: `task-${id}`,
      type: 'task',
      title: taskTitle(name, input),
      source: taskSource(name, input),
      status: taskStatus(name, input, result, resultEvent !== null),
      summary,
      ...(outputPath(summary) ? { outputPath: outputPath(summary) } : {}),
      eventIds: events.map((event) => event.id),
      rawEvents: raws
    };
  }

  return {
    id: `tool-${id}`,
    type: 'tool',
    name,
    status: resultEvent ? (/failed|error/i.test(result) ? 'failed' : 'completed') : 'running',
    inputSummary,
    resultSummary: result,
    eventIds: events.map((event) => event.id),
    rawEvents: raws
  };
}

function makeStandaloneToolResult(event: UiEvent, payload: ObjectPayload): ToolBlock {
  const result = resultSummary(payload);
  return {
    id: `tool-result-${event.id}`,
    type: 'tool',
    name: toolName(payload),
    status: /failed|error/i.test(result) ? 'failed' : 'completed',
    inputSummary: '',
    resultSummary: result,
    eventIds: [event.id],
    rawEvents: [rawEvent(event)]
  };
}

function makeMessageBlock(event: UiEvent, payload: ObjectPayload, role: MessageBlock['role'], text: string): MessageBlock {
  return {
    id: `message-${role}-${event.id}`,
    type: 'message',
    role,
    text,
    eventIds: [event.id],
    rawEvents: [rawEvent(event)]
  };
}

function appendMessage(block: MessageBlock, event: UiEvent, text: string): MessageBlock {
  return {
    ...block,
    text: `${block.text}\n\n${text}`,
    eventIds: [...block.eventIds, event.id],
    rawEvents: [...block.rawEvents, rawEvent(event)]
  };
}

export function buildConversationBlocks(events: UiEvent[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  const pendingTools = new Map<string, PendingTool>();

  for (const [index, event] of events.entries()) {
    const payload = isObject(event.payload) ? event.payload : { value: event.payload };
    const type = payloadType(event, payload);

    if (event.kind === 'error' || type === 'error') {
      blocks.push({
        id: `error-${event.id}`,
        type: 'error',
        message: textContent(payload) ?? summarize(event.payload),
        eventIds: [event.id],
        rawEvents: [rawEvent(event)]
      });
      continue;
    }

    if (event.kind === 'tool' || type === 'tool_use' || type === 'tool_result') {
      if (type === 'tool_use') {
        const id = toolUseId(payload) ?? String(event.id);
        pendingTools.set(id, { event, payload, index: blocks.length });
        blocks.push(makeToolBlock({ event, payload, index: blocks.length }, null, null));
        continue;
      }

      if (type === 'tool_result') {
        const id = resultToolUseId(payload);
        const pending = id ? pendingTools.get(id) : null;
        if (pending) {
          blocks[pending.index] = makeToolBlock(pending, event, payload);
          pendingTools.delete(id as string);
        } else {
          blocks.push(makeStandaloneToolResult(event, payload));
        }
        continue;
      }

      blocks.push(makeToolBlock({ event, payload, index: blocks.length }, null, null));
      continue;
    }

    const text = textContent(payload);
    if (text && (event.kind === 'assistant' || event.kind === 'user' || event.kind === 'system')) {
      const role = event.kind;
      const previous = blocks.at(-1);
      if (previous?.type === 'message' && previous.role === role) {
        blocks[blocks.length - 1] = appendMessage(previous, event, text);
      } else {
        blocks.push(makeMessageBlock(event, payload, role, text));
      }
      continue;
    }

    blocks.push({
      id: `raw-${event.id}`,
      type: 'raw',
      label: event.kind,
      eventIds: [event.id],
      rawEvents: [rawEvent(event)]
    });
  }

  return blocks;
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npm --prefix web test -- conversationBlocks.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts
git commit -m "feat: add conversation block builder"
```

## Task 2: Add block renderer components

**Files:**
- Create: `web/src/RawEventDetails.tsx`
- Create: `web/src/ConversationBlockList.tsx`
- Create: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `web/src/ConversationBlockList.test.tsx`:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ConversationBlockList from './ConversationBlockList';
import type { ConversationBlock } from './conversationBlocks';

const rawEvents = [{ id: 1, kind: 'assistant' as const, payload: { message: 'hello' } }];

describe('ConversationBlockList', () => {
  beforeEach(() => cleanup());

  it('renders message blocks with readable text', () => {
    const blocks: ConversationBlock[] = [
      { id: 'message-assistant-1', type: 'message', role: 'assistant', text: 'hello\n\n```ts\nconst ok = true;\n```', eventIds: [1], rawEvents }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    expect(screen.getByText('Claude')).toBeInTheDocument();
    expect(screen.getByText(/const ok = true/)).toBeInTheDocument();
    expect(screen.getByText('Raw events')).toBeInTheDocument();
  });

  it('renders tool blocks as compact tool activity', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-toolu_1',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        inputSummary: 'file_path: /tmp/a.txt',
        resultSummary: 'file contents',
        eventIds: [1, 2],
        rawEvents
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText(/file_path: \/tmp\/a.txt/)).toBeInTheDocument();
    expect(screen.getByText(/file contents/)).toBeInTheDocument();
  });

  it('renders task blocks as task activity instead of tool use', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'task-toolu_bg',
        type: 'task',
        title: 'Run frontend tests',
        source: 'Bash',
        status: 'running',
        summary: 'Task started in background with ID abc123. Output file: /tmp/test.log',
        outputPath: '/tmp/test.log',
        eventIds: [1, 2],
        rawEvents
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    expect(screen.getByText('Run frontend tests')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('/tmp/test.log')).toBeInTheDocument();
  });

  it('renders error and raw fallback blocks', () => {
    const blocks: ConversationBlock[] = [
      { id: 'error-1', type: 'error', message: 'failed to start', eventIds: [1], rawEvents },
      { id: 'raw-2', type: 'raw', label: 'raw', eventIds: [2], rawEvents: [{ id: 2, kind: 'raw', payload: { unexpected: true } }] }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    expect(screen.getByText('failed to start')).toBeInTheDocument();
    expect(screen.getByText('raw')).toBeInTheDocument();
    expect(screen.getAllByText('Raw events')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: FAIL with an import error like `Failed to resolve import "./ConversationBlockList"`.

- [ ] **Step 3: Implement raw event details**

Create `web/src/RawEventDetails.tsx`:

```tsx
import type { RawEventRef } from './conversationBlocks';

export default function RawEventDetails({ rawEvents }: { rawEvents: RawEventRef[] }) {
  return (
    <details className="raw-event-details">
      <summary>Raw events</summary>
      <pre>{JSON.stringify(rawEvents, null, 2)}</pre>
    </details>
  );
}
```

- [ ] **Step 4: Implement the block list renderer**

Create `web/src/ConversationBlockList.tsx`:

```tsx
import type { ConversationBlock, ErrorBlock, MessageBlock, RawBlock, TaskBlock, ToolBlock } from './conversationBlocks';
import RawEventDetails from './RawEventDetails';

function roleLabel(role: MessageBlock['role']): string {
  if (role === 'assistant') return 'Claude';
  if (role === 'user') return 'You';
  return 'System';
}

function MessageBlockView({ block }: { block: MessageBlock }) {
  return (
    <article className={`conversation-block message-block ${block.role}`}>
      <header className="block-header">
        <span>{roleLabel(block.role)}</span>
      </header>
      <pre className="message-text">{block.text}</pre>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ToolBlockView({ block }: { block: ToolBlock }) {
  return (
    <article className={`conversation-block tool-block ${block.status}`}>
      <header className="block-header">
        <span>{block.name}</span>
        <em>{block.status}</em>
      </header>
      {block.inputSummary && (
        <section className="block-section">
          <strong>Input</strong>
          <pre>{block.inputSummary}</pre>
        </section>
      )}
      {block.resultSummary && (
        <section className="block-section">
          <strong>Result</strong>
          <pre>{block.resultSummary}</pre>
        </section>
      )}
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function TaskBlockView({ block }: { block: TaskBlock }) {
  return (
    <article className={`conversation-block task-block ${block.status}`}>
      <header className="block-header task-header">
        <div>
          <span>{block.title}</span>
          <small>{block.source}</small>
        </div>
        <em>{block.status}</em>
      </header>
      {block.summary && <p>{block.summary}</p>}
      {block.outputPath && (
        <section className="block-section output-path">
          <strong>Output</strong>
          <code>{block.outputPath}</code>
        </section>
      )}
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ErrorBlockView({ block }: { block: ErrorBlock }) {
  return (
    <article className="conversation-block error-block">
      <header className="block-header">
        <span>Error</span>
      </header>
      <pre>{block.message}</pre>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function RawBlockView({ block }: { block: RawBlock }) {
  return (
    <article className="conversation-block raw-block">
      <header className="block-header">
        <span>{block.label}</span>
      </header>
      <RawEventDetails rawEvents={block.rawEvents} />
    </article>
  );
}

function ConversationBlockView({ block }: { block: ConversationBlock }) {
  switch (block.type) {
    case 'message':
      return <MessageBlockView block={block} />;
    case 'tool':
      return <ToolBlockView block={block} />;
    case 'task':
      return <TaskBlockView block={block} />;
    case 'error':
      return <ErrorBlockView block={block} />;
    case 'raw':
      return <RawBlockView block={block} />;
  }
}

export default function ConversationBlockList({ blocks }: { blocks: ConversationBlock[] }) {
  return (
    <div className="conversation-blocks">
      {blocks.map((block) => <ConversationBlockView key={block.id} block={block} />)}
    </div>
  );
}
```

- [ ] **Step 5: Run the component tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add web/src/RawEventDetails.tsx web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx
git commit -m "feat: render conversation blocks"
```

## Task 3: Wire App to block rendering

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Update App test for task-block rendering from WebSocket events**

Modify `web/src/App.test.tsx` by adding this test inside `describe('App', () => { ... })` after the existing `loads sessions and renders active event stream` test:

```tsx
  it('renders background task events as task activity', async () => {
    render(<App />);

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'tool',
      payload: {
        type: 'tool_use',
        id: 'toolu_bg',
        name: 'Bash',
        input: { command: 'npm --prefix web test', run_in_background: true, description: 'Run frontend tests' }
      }
    });
    FakeWebSocket.instances[0].emit({
      id: 2,
      sessionId: 's1',
      time: '2026-06-11T00:00:01Z',
      kind: 'tool',
      payload: {
        type: 'tool_result',
        tool_use_id: 'toolu_bg',
        content: 'Task started in background with ID abc123. Output file: /tmp/test.log'
      }
    });

    expect(await screen.findByText('Run frontend tests')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('/tmp/test.log')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run App tests to verify the new test fails**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because the app still renders raw `EventCard` entries and does not show `/tmp/test.log` as a task output path.

- [ ] **Step 3: Replace per-event rendering with conversation blocks**

Modify the imports at the top of `web/src/App.tsx`:

```tsx
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createSession, eventsUrl, listSessions, restartSession, sendInput, stopSession } from './api';
import ConversationBlockList from './ConversationBlockList';
import { buildConversationBlocks } from './conversationBlocks';
import type { SessionInfo, UiEvent } from './types';
import './App.css';
```

Add this memo after `activeSession`:

```tsx
  const activeEvents = activeId ? (events[activeId] ?? []) : [];
  const activeBlocks = useMemo(() => buildConversationBlocks(activeEvents), [activeEvents]);
```

Replace the current events div in `web/src/App.tsx`:

```tsx
            <div className="events">
              {(events[activeSession.id] ?? []).map((event, index) => (
                <EventCard key={`${event.id}-${index}`} event={event} />
              ))}
            </div>
```

with:

```tsx
            <div className="events">
              <ConversationBlockList blocks={activeBlocks} />
            </div>
```

- [ ] **Step 4: Run App tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat: use conversation block rendering"
```

## Task 4: Replace event-card styling with Claude app-style block hierarchy

**Files:**
- Modify: `web/src/App.css`

- [ ] **Step 1: Add CSS-focused assertions to renderer tests**

Modify `web/src/ConversationBlockList.test.tsx` by adding this test inside `describe('ConversationBlockList', () => { ... })`:

```tsx
  it('uses distinct classes for messages, tools, tasks, and raw details', () => {
    const blocks: ConversationBlock[] = [
      { id: 'message-user-1', type: 'message', role: 'user', text: 'hello', eventIds: [1], rawEvents },
      { id: 'tool-2', type: 'tool', name: 'Read', status: 'running', inputSummary: 'file_path: /tmp/a.txt', resultSummary: '', eventIds: [2], rawEvents },
      { id: 'task-3', type: 'task', title: 'Explore', source: 'Agent', status: 'completed', summary: 'done', eventIds: [3], rawEvents }
    ];

    const { container } = render(<ConversationBlockList blocks={blocks} />);

    expect(container.querySelector('.message-block.user')).not.toBeNull();
    expect(container.querySelector('.tool-block.running')).not.toBeNull();
    expect(container.querySelector('.task-block.completed')).not.toBeNull();
    expect(container.querySelectorAll('.raw-event-details')).toHaveLength(3);
  });
```

- [ ] **Step 2: Run renderer tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: PASS. This confirms the classes exist before changing CSS.

- [ ] **Step 3: Replace event styles in App.css**

In `web/src/App.css`, replace lines 136-192 with:

```css
.events {
  overflow: auto;
  padding: 20px;
}

.conversation-blocks {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.conversation-block {
  border: 1px solid #334155;
  border-radius: 12px;
  background: #111827;
  padding: 12px 14px;
}

.message-block {
  border-color: transparent;
  background: transparent;
  padding: 4px 2px;
}

.message-block.user {
  margin-left: auto;
  max-width: min(760px, 85%);
  border-color: #2563eb;
  background: #1e3a8a;
  padding: 12px 14px;
}

.message-block.assistant {
  max-width: 920px;
}

.block-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.block-header span {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.block-header em,
.task-header small {
  color: #94a3b8;
  font-size: 12px;
  font-style: normal;
}

.task-header > div {
  display: grid;
  gap: 2px;
}

.block-section {
  display: grid;
  gap: 6px;
  margin-top: 10px;
}

.block-section strong {
  color: #cbd5e1;
  font-size: 12px;
}

.conversation-block pre,
.message-text {
  overflow: auto;
  margin: 0;
  white-space: pre-wrap;
}

.tool-block,
.task-block {
  border-color: #475569;
  background: #0f172a;
}

.task-block {
  border-left: 4px solid #8b5cf6;
}

.task-block.running {
  border-left-color: #f59e0b;
}

.task-block.completed {
  border-left-color: #22c55e;
}

.task-block.failed,
.tool-block.failed,
.error-block {
  border-color: #ef4444;
}

.task-block p {
  margin: 0;
  color: #dbeafe;
}

.output-path code {
  overflow-wrap: anywhere;
  color: #bfdbfe;
}

.raw-block {
  opacity: 0.85;
}

.raw-event-details {
  margin-top: 10px;
}

.raw-event-details summary {
  cursor: pointer;
  color: #94a3b8;
  font-size: 12px;
}

.raw-event-details pre {
  margin-top: 8px;
  max-height: 360px;
  color: #cbd5e1;
}
```

- [ ] **Step 4: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add web/src/App.css web/src/ConversationBlockList.test.tsx
git commit -m "style: align output blocks with Claude app hierarchy"
```

## Task 5: Remove old EventCard path

**Files:**
- Delete: `web/src/EventCard.tsx`
- Delete: `web/src/EventCard.test.tsx`

- [ ] **Step 1: Confirm EventCard is no longer referenced**

Run:

```bash
grep -R "EventCard" -n web/src
```

Expected: no output except possibly deleted-file references if running from a tool that shows git state. If `web/src/App.tsx` still imports `EventCard`, return to Task 3 Step 3 and remove that import.

- [ ] **Step 2: Delete obsolete EventCard files**

Run:

```bash
rm web/src/EventCard.tsx web/src/EventCard.test.tsx
```

- [ ] **Step 3: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS with no EventCard test file.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add web/src/EventCard.tsx web/src/EventCard.test.tsx
git commit -m "refactor: remove raw event card renderer"
```

## Task 6: Add AGENTS.md project guidance

**Files:**
- Create: `AGENTS.md`

- [ ] **Step 1: Create AGENTS.md with output UX guidance**

Create `AGENTS.md`:

```markdown
# AGENTS.md

## Output UX guidance

When changing Claude output rendering, prefer Claude Code app behavior where practical. The browser UI should present a readable conversation and task timeline, not expose raw transport details as the primary experience.

- Show assistant/user/system text as readable conversation content.
- Show ordinary tool calls as compact activity with useful input/result summaries.
- Show background Bash work, Agent/subagent work, Workflow runs, and task-list updates as task or subagent activity rather than generic tool use.
- Keep raw event payloads available in collapsed details for debugging and replay.
- Preserve the append-only event log model.
- Keep the default security posture SSH-local and bound to `127.0.0.1` unless a future change explicitly designs otherwise.
```

- [ ] **Step 2: Commit Task 6**

Run:

```bash
git add AGENTS.md
git commit -m "docs: add output UX agent guidance"
```

## Task 7: Final verification

**Files:**
- Verify: all frontend files changed in Tasks 1-6

- [ ] **Step 1: Run all frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS with TypeScript and Vite build success.

- [ ] **Step 3: Inspect current git diff**

Run:

```bash
git diff --stat
```

Expected: diff shows the conversation block implementation, tests, CSS, and `AGENTS.md`; it should not show Rust backend files.

- [ ] **Step 4: Commit final verification fixes if any were needed**

If Step 1 or Step 2 required fixes, commit only those fix files:

```bash
git add web/src/conversationBlocks.ts web/src/ConversationBlockList.tsx web/src/App.tsx web/src/App.css web/src/*.test.tsx web/src/*.test.ts AGENTS.md
git commit -m "fix: complete output block verification"
```

If no fixes were needed, do not create an empty commit.

## Self-review

- Spec coverage: The plan implements frontend block aggregation, message/tool/task/system/error/raw rendering, raw payload preservation, AGENTS.md guidance, tests, and frontend verification. It intentionally leaves Rust protocol changes to the future phase described in the spec.
- Placeholder scan: No TBD/TODO/fill-in steps remain; each code-changing step includes concrete code or exact replacement text.
- Type consistency: `ConversationBlock`, `RawEventRef`, `buildConversationBlocks`, and component prop names are defined in Task 1/2 and used consistently in later tasks.
