# Prettified Output Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Claude Remote Web output as a readable Claude-App-like chat transcript while preserving raw JSON payloads for debugging.

**Architecture:** Keep the backend API and persisted event format unchanged. Add a focused frontend display parser that converts `UiEvent` payloads into message, tool, status, or unknown display models, then update `EventCard` and CSS to render those models as chat bubbles and inline tool/status blocks. Raw payloads remain available through collapsed JSON details.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS.

---

## File Structure

Modify these files under `/data00/home/fangpin.brave/repos/claude-remote-web_pin_pretify_output`:

```text
web/src/eventDisplay.ts          # create display-model parser for existing UiEvent payloads
web/src/eventDisplay.test.ts     # create parser unit tests for Claude stream-json shapes
web/src/EventCard.tsx            # replace raw-first rendering with display-model rendering
web/src/EventCard.test.tsx       # update component rendering coverage
web/src/App.css                  # update event stream styling into chat/tool/status layout
```

No backend files change. No WebSocket, REST, store, launcher, or session lifecycle behavior changes.

Commit steps below are checkpoints for environments where commits are explicitly authorized. If the user has not asked for commits, do not run the `git commit` commands.

---

### Task 1: Add event display parser

**Files:**
- Create: `web/src/eventDisplay.ts`
- Create: `web/src/eventDisplay.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `web/src/eventDisplay.test.ts` with this content:

```ts
import { describe, expect, it } from 'vitest';
import { parseDisplayEvent } from './eventDisplay';
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

  it('extracts user text from simple message fields', () => {
    const display = parseDisplayEvent(event({ message: 'run the tests' }, 'user'));

    expect(display).toMatchObject({ kind: 'message', role: 'user', label: 'user', text: 'run the tests' });
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

  it('extracts error event text into a status block', () => {
    const display = parseDisplayEvent(event({ error: 'failed to start' }, 'error'));

    expect(display).toMatchObject({ kind: 'status', tone: 'error', label: 'error', text: 'failed to start' });
  });

  it('keeps unknown raw payloads available as unknown display events', () => {
    const payload = { unexpected: { nested: true } };
    const display = parseDisplayEvent(event(payload, 'raw'));

    expect(display).toMatchObject({ kind: 'unknown', label: 'raw', raw: payload });
  });
});
```

- [ ] **Step 2: Run parser tests to verify they fail**

Run:

```bash
npm --prefix web test -- web/src/eventDisplay.test.ts
```

Expected: FAIL because `web/src/eventDisplay.ts` does not exist yet.

- [ ] **Step 3: Implement the parser**

Create `web/src/eventDisplay.ts` with this content:

```ts
import type { UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

export type MessageDisplayEvent = {
  kind: 'message';
  role: 'assistant' | 'user';
  label: string;
  text: string;
  raw: unknown;
};

export type ToolDisplayEvent = {
  kind: 'tool';
  name: string;
  status: 'running' | 'complete' | 'error';
  input: string | null;
  output: string | null;
  error: string | null;
  defaultOpen: boolean;
  raw: unknown;
};

export type StatusDisplayEvent = {
  kind: 'status';
  tone: 'system' | 'error' | 'raw';
  label: string;
  text: string | null;
  raw: unknown;
};

export type UnknownDisplayEvent = {
  kind: 'unknown';
  label: string;
  raw: unknown;
};

export type DisplayEvent = MessageDisplayEvent | ToolDisplayEvent | StatusDisplayEvent | UnknownDisplayEvent;

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(payload: ObjectPayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return null;

  const parts = value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isObject(item) && typeof item.text === 'string') return item.text;
      return null;
    })
    .filter((part): part is string => Boolean(part?.trim()));

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function textContent(payload: ObjectPayload): string | null {
  return stringField(payload, ['message', 'text', 'status', 'error', 'line']) ?? textFromContent(payload.content);
}

function summarize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = textFromContent(value);
  if (text) return text;
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function payloadType(payload: ObjectPayload, event: UiEvent): string {
  return typeof payload.type === 'string' ? payload.type : event.kind;
}

function isToolEvent(event: UiEvent, payload: ObjectPayload): boolean {
  const type = payloadType(payload, event);
  return event.kind === 'tool' || type === 'tool_use' || type === 'tool_result';
}

function toolName(payload: ObjectPayload): string {
  return stringField(payload, ['name', 'tool_name', 'toolName']) ?? 'tool';
}

function parseTool(payload: ObjectPayload): ToolDisplayEvent {
  const type = typeof payload.type === 'string' ? payload.type : null;
  const error = stringField(payload, ['error']);
  const output = summarize(payload.result) ?? summarize(payload.output) ?? summarize(payload.content);
  const status = error ? 'error' : type === 'tool_use' && !output ? 'running' : 'complete';

  return {
    kind: 'tool',
    name: toolName(payload),
    status,
    input: summarize(payload.input),
    output,
    error,
    defaultOpen: status === 'running',
    raw: payload
  };
}

function parseMessage(event: UiEvent, payload: ObjectPayload): MessageDisplayEvent | null {
  if (event.kind !== 'assistant' && event.kind !== 'user') return null;
  const text = textContent(payload);
  if (!text) return null;

  return {
    kind: 'message',
    role: event.kind,
    label: event.kind,
    text,
    raw: event.payload
  };
}

function parseStatus(event: UiEvent, payload: ObjectPayload): StatusDisplayEvent | null {
  if (event.kind !== 'system' && event.kind !== 'error' && event.kind !== 'raw') return null;
  const text = textContent(payload);
  if (!text && event.kind === 'raw') return null;

  return {
    kind: 'status',
    tone: event.kind,
    label: event.kind,
    text,
    raw: event.payload
  };
}

export function parseDisplayEvent(event: UiEvent): DisplayEvent {
  const payload = isObject(event.payload) ? event.payload : { value: event.payload };

  if (isToolEvent(event, payload)) return parseTool(payload);

  const message = parseMessage(event, payload);
  if (message) return message;

  const status = parseStatus(event, payload);
  if (status) return status;

  return {
    kind: 'unknown',
    label: event.kind,
    raw: event.payload
  };
}

export function formatRawPayload(raw: unknown): string {
  return JSON.stringify(raw, null, 2);
}
```

- [ ] **Step 4: Run parser tests to verify they pass**

Run:

```bash
npm --prefix web test -- web/src/eventDisplay.test.ts
```

Expected: PASS for all `parseDisplayEvent` tests.

- [ ] **Step 5: Commit parser checkpoint when commits are authorized**

Run only if the user explicitly authorized commits:

```bash
git add web/src/eventDisplay.ts web/src/eventDisplay.test.ts
git commit -m "feat: parse events for readable display"
```

---

### Task 2: Render display models in EventCard

**Files:**
- Modify: `web/src/EventCard.tsx`
- Modify: `web/src/EventCard.test.tsx`

- [ ] **Step 1: Replace EventCard tests with display-focused tests**

Replace `web/src/EventCard.test.tsx` with this content:

```tsx
import { cleanup, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import EventCard from './EventCard';
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

describe('EventCard', () => {
  beforeEach(() => cleanup());

  it('renders assistant content arrays as chat text', () => {
    render(<EventCard event={event({ content: [{ type: 'text', text: 'hello assistant' }] }, 'assistant')} />);

    expect(screen.getByText('assistant')).toBeInTheDocument();
    expect(screen.getByText('hello assistant')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
  });

  it('renders user messages as chat text', () => {
    render(<EventCard event={event({ message: 'please inspect this' }, 'user')} />);

    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('please inspect this')).toBeInTheDocument();
  });

  it('renders running tool calls expanded with input', () => {
    const { container } = render(<EventCard event={event({ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }, 'tool')} />);

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText(/git status/)).toBeInTheDocument();
    expect(container.querySelector('.event-tool-details')?.hasAttribute('open')).toBe(true);
  });

  it('renders completed tool results collapsed with output available', () => {
    const { container } = render(<EventCard event={event({ type: 'tool_result', name: 'Bash', result: 'done' }, 'tool')} />);

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('complete')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
    expect(container.querySelector('.event-tool-details')?.hasAttribute('open')).toBe(false);
  });

  it('renders error events as status blocks', () => {
    render(<EventCard event={event({ error: 'failed to start' }, 'error')} />);

    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('failed to start')).toBeInTheDocument();
  });

  it('renders unknown payloads with collapsed raw json', () => {
    const { container } = render(<EventCard event={event({ unexpected: { nested: true } }, 'raw')} />);

    expect(screen.getByText('raw')).toBeInTheDocument();
    expect(screen.getByText('JSON payload')).toBeInTheDocument();
    expect(screen.getByText(/unexpected/)).toBeInTheDocument();
    expect(container.querySelector('.event-json')?.hasAttribute('open')).toBe(false);
  });
});
```

- [ ] **Step 2: Run EventCard tests to verify they fail**

Run:

```bash
npm --prefix web test -- web/src/EventCard.test.tsx
```

Expected: FAIL because the current component does not render Claude `content` arrays as chat text and does not expose `.event-tool-details` behavior.

- [ ] **Step 3: Replace EventCard implementation**

Replace `web/src/EventCard.tsx` with this content:

```tsx
import { formatRawPayload, parseDisplayEvent } from './eventDisplay';
import type { UiEvent } from './types';

function JsonDetails({ raw }: { raw: unknown }) {
  return (
    <details className="event-json">
      <summary>JSON payload</summary>
      <pre>{formatRawPayload(raw)}</pre>
    </details>
  );
}

function TextBlock({ children }: { children: string }) {
  return <div className="event-text">{children}</div>;
}

export default function EventCard({ event }: { event: UiEvent }) {
  const display = parseDisplayEvent(event);

  if (display.kind === 'message') {
    return (
      <article className={`event event-message ${display.role}`}>
        <header className="event-header">
          <span>{display.label}</span>
        </header>
        <TextBlock>{display.text}</TextBlock>
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  if (display.kind === 'tool') {
    return (
      <article className={`event event-tool ${display.status}`}>
        <header className="event-header">
          <span>tool</span>
          <strong>{display.name}</strong>
          <em>{display.status}</em>
        </header>
        <details className="event-tool-details" open={display.defaultOpen}>
          <summary>Details</summary>
          {display.input && (
            <section className="event-section">
              <strong>Input</strong>
              <pre>{display.input}</pre>
            </section>
          )}
          {display.output && (
            <section className="event-section">
              <strong>Output</strong>
              <pre>{display.output}</pre>
            </section>
          )}
          {display.error && (
            <section className="event-section">
              <strong>Error</strong>
              <pre>{display.error}</pre>
            </section>
          )}
        </details>
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  if (display.kind === 'status') {
    return (
      <article className={`event event-status ${display.tone}`}>
        <header className="event-header">
          <span>{display.label}</span>
        </header>
        {display.text && <TextBlock>{display.text}</TextBlock>}
        <JsonDetails raw={display.raw} />
      </article>
    );
  }

  return (
    <article className="event event-status raw">
      <header className="event-header">
        <span>{display.label}</span>
      </header>
      <JsonDetails raw={display.raw} />
    </article>
  );
}
```

- [ ] **Step 4: Run EventCard tests to verify they pass**

Run:

```bash
npm --prefix web test -- web/src/EventCard.test.tsx
```

Expected: PASS for all `EventCard` tests.

- [ ] **Step 5: Run parser and component tests together**

Run:

```bash
npm --prefix web test -- web/src/eventDisplay.test.ts web/src/EventCard.test.tsx
```

Expected: PASS for parser and component tests.

- [ ] **Step 6: Commit rendering checkpoint when commits are authorized**

Run only if the user explicitly authorized commits:

```bash
git add web/src/EventCard.tsx web/src/EventCard.test.tsx web/src/eventDisplay.ts web/src/eventDisplay.test.ts
git commit -m "feat: render events as readable chat output"
```

---

### Task 3: Style the event stream as chat, tool, and status blocks

**Files:**
- Modify: `web/src/App.css`

- [ ] **Step 1: Replace event CSS with chat-oriented styling**

In `web/src/App.css`, replace the block from `.events {` through `.event.error { ... }` with this content:

```css
.events {
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  padding: 20px;
}

.event {
  max-width: min(860px, 100%);
  border: 1px solid #334155;
  border-radius: 14px;
  background: #111827;
  padding: 12px;
}

.event-message.assistant,
.event-tool,
.event-status {
  align-self: flex-start;
}

.event-message.user {
  align-self: flex-end;
  border-color: #2563eb;
  background: #1d4ed8;
}

.event-message.assistant {
  border-color: #334155;
  background: #111827;
}

.event-tool {
  width: min(760px, 100%);
  border-style: dashed;
  background: #0f172a;
}

.event-tool.running {
  border-color: #60a5fa;
}

.event-tool.error,
.event-status.error {
  border-color: #ef4444;
}

.event-status {
  width: min(720px, 100%);
  background: #0f172a;
}

.event-status.raw {
  opacity: 0.9;
}

.event-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.event-header span {
  color: #93c5fd;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.event-header strong {
  color: #e5e7eb;
  font-size: 13px;
}

.event-header em {
  color: #94a3b8;
  font-size: 12px;
  font-style: normal;
}

.event-text {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.event-section {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.event-section strong {
  color: #cbd5e1;
  font-size: 12px;
}

.event pre {
  overflow: auto;
  margin: 0;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.8);
  padding: 10px;
  white-space: pre-wrap;
}

.event-tool-details,
.event-json {
  margin-top: 8px;
}

.event-tool-details summary,
.event-json summary {
  cursor: pointer;
  color: #cbd5e1;
  font-size: 12px;
}

.event-json pre {
  margin-top: 8px;
  color: #cbd5e1;
  font-size: 12px;
}
```

- [ ] **Step 2: Run EventCard tests after CSS changes**

Run:

```bash
npm --prefix web test -- web/src/EventCard.test.tsx
```

Expected: PASS. The CSS selectors used by tests, including `.event-tool-details` and `.event-json`, still exist.

- [ ] **Step 3: Commit styling checkpoint when commits are authorized**

Run only if the user explicitly authorized commits:

```bash
git add web/src/App.css
git commit -m "style: present events as chat transcript"
```

---

### Task 4: Run full frontend verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
npm --prefix web test
```

Expected: PASS for all frontend tests, including `App.test.tsx`, `EventCard.test.tsx`, and `eventDisplay.test.ts`.

- [ ] **Step 2: Run the frontend production build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS with TypeScript compile and Vite build completing successfully.

- [ ] **Step 3: Commit verification cleanup when commits are authorized**

If verification required small fixes, commit those fixes only after tests and build pass. Run only if the user explicitly authorized commits:

```bash
git status --short
git add web/src/eventDisplay.ts web/src/eventDisplay.test.ts web/src/EventCard.tsx web/src/EventCard.test.tsx web/src/App.css
git commit -m "test: verify prettified event rendering"
```

If there were no additional source changes since the previous checkpoint, skip this commit.

---

### Task 5: Manual UI verification

**Files:**
- No source edits expected unless manual verification reveals a rendering bug.

- [ ] **Step 1: Build frontend assets**

Run:

```bash
npm --prefix web run build
```

Expected: PASS and `web/dist` exists.

- [ ] **Step 2: Start the daemon on a test port**

Run:

```bash
cat > /tmp/claude-remote-web-rendering-test.toml <<'EOF'
bind = "127.0.0.1:8789"
data_dir = "/tmp/claude-remote-web-rendering-test"
launcher = ["claude"]
web_dir = "/data00/home/fangpin.brave/repos/claude-remote-web_pin_pretify_output/web/dist"
default_permission_mode = "acceptEdits"
EOF
scripts/start-server.sh --config /tmp/claude-remote-web-rendering-test.toml --skip-web-build
```

Expected: server starts and listens on `127.0.0.1:8789`.

- [ ] **Step 3: Open the UI and inspect output rendering**

Open:

```text
http://127.0.0.1:8789
```

Create or open a session and inspect representative events. Expected visual behavior:

- Assistant/user messages appear as readable chat bubbles.
- Tool calls appear as inline tool blocks.
- Running tool calls are expanded.
- Completed tool results are collapsed.
- System/error/raw events are compact.
- `JSON payload` details are closed by default and still contain the full raw payload.

- [ ] **Step 4: Stop the daemon**

Stop the foreground `scripts/start-server.sh` process with Ctrl-C in the terminal running it.

Expected: daemon exits and port `8789` is no longer serving the app.

- [ ] **Step 5: Report manual verification result**

If browser verification was completed, report the observed result. If browser verification was not possible in the execution environment, report that explicitly and include the automated test/build results instead.

---

## Self-Review

Spec coverage:

- Assistant/user chat bubbles: Task 1 parser tests and Task 2 component rendering.
- Claude `content` arrays: Task 1 and Task 2 include content-array tests and implementation.
- Tool blocks with running-expanded and complete-collapsed behavior: Task 1 parser tests and Task 2 component tests.
- System/error/raw compact fallback: Task 1 parser tests and Task 2 component tests.
- Raw JSON preserved and collapsed by default: Task 2 component implementation and tests.
- Frontend-only change with backend schema unchanged: File Structure lists no backend edits.
- Styling without full app shell redesign: Task 3 changes only event-area CSS.
- Verification commands: Task 4 runs `npm --prefix web test` and `npm --prefix web run build`; Task 5 covers manual UI verification.

Placeholder scan: no placeholder sections remain, and every code-changing step includes exact code or exact CSS.

Type consistency: `DisplayEvent`, `parseDisplayEvent`, and `formatRawPayload` are defined in Task 1 and imported with the same names in Task 2. CSS selectors used by tests are defined in Task 3.
