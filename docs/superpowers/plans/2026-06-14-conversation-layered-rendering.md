# Conversation Layered Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the transcript default to a Claude-app-like chat view with compact tool summaries, while preserving raw event/debug visibility through an explicit Debug mode.

**Architecture:** Keep the existing event projection pipeline, but make display mode explicit. `App` owns `displayMode`, `useSessionEvents` rebuilds blocks from cached visible events for that mode, `presentationPolicy` centralizes chat/debug visibility decisions, and `ConversationBlockList` renders the mode switch plus chat/debug variants.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, CSS modules-by-file via imported CSS.

---

## File Structure

- Modify `web/src/presentationPolicy.ts`
  - Add `ConversationDisplayMode`.
  - Make raw event presentation mode-aware.
  - Keep existing chat defaults intact.
- Modify `web/src/presentationPolicy.test.ts`
  - Cover chat/debug raw visibility and failed tool detail behavior.
- Create `web/src/toolSummaries.ts`
  - Shared tool input summarization and transcript summary labels.
  - Avoid future divergence between transcript and activity surfaces.
- Create `web/src/toolSummaries.test.ts`
  - Unit-test representative summary labels.
- Modify `web/src/conversationBlocks.ts`
  - Accept `displayMode` option in `buildConversationBlocks`.
  - Use shared tool summarization helpers.
  - Preserve hidden raw/system/metadata events as raw blocks in debug mode.
- Modify `web/src/conversationBlocks.test.ts`
  - Keep chat expectations stable.
  - Add debug-mode projection assertions.
- Modify `web/src/useSessionEvents.ts`
  - Accept `displayMode` and include it in the `activeBlocks` memo dependency.
- Modify `web/src/App.tsx`
  - Hold `displayMode` state and pass it through.
- Modify `web/src/ConversationWorkspace.tsx`
  - Accept `displayMode` and `onDisplayModeChange`, pass both to `ConversationBlockList`.
- Modify `web/src/ConversationBlockList.tsx`
  - Accept display mode props.
  - Render Chat/Debug switch above blocks.
  - Render compact tool/task summary chips in chat mode.
  - Hide `RawEventDetails` unless debug mode.
- Modify `web/src/ConversationBlockList.test.tsx`
  - Cover switch, collapsed summaries, failed expansion, debug raw details.
- Modify `web/src/ConversationBlockList.css` and `web/src/App.css`
  - Add compact summary tag-group styling and mode switch styling.
- Modify `web/src/activityTimeline.ts` and `web/src/activityTimeline.test.ts`
  - Reuse shared `summarizeToolInput` where it matches existing behavior.
- Review `README.md` and `CLAUDE.md`
  - Update only if the user-facing Chat/Debug transcript mode needs documentation.

Claude API note: this is a UI-only rendering change. Do not change Anthropic API calls, model IDs, streaming request shapes, or Claude CLI launcher behavior.

---

### Task 1: Add display-mode policy and shared tool summaries

**Files:**
- Modify: `web/src/presentationPolicy.ts`
- Modify: `web/src/presentationPolicy.test.ts`
- Create: `web/src/toolSummaries.ts`
- Create: `web/src/toolSummaries.test.ts`

- [ ] **Step 1: Write failing tests for display-mode policy**

Add these tests to `web/src/presentationPolicy.test.ts` inside `describe('presentationPolicy', () => { ... })`:

```ts
it('hides routine raw/system events in chat mode and exposes them in debug mode', () => {
  expect(rawEventPresentation('system', { message: 'session detail' }, 'chat')).toMatchObject({
    visibility: 'hidden',
    severity: 'info'
  });
  expect(rawEventPresentation('system', { message: 'session detail' }, 'debug')).toMatchObject({
    visibility: 'visible',
    severity: 'info',
    label: 'System event'
  });
  expect(rawEventPresentation('raw', { type: 'result', subtype: 'success' }, 'chat')).toMatchObject({
    visibility: 'anchor',
    severity: 'info'
  });
  expect(rawEventPresentation('raw', { type: 'result', subtype: 'success' }, 'debug')).toMatchObject({
    visibility: 'visible',
    severity: 'info',
    label: 'Raw event'
  });
});

it('keeps permission and error raw events visible in chat mode', () => {
  expect(rawEventPresentation('raw', { type: 'permission_request', prompt: 'Allow command?' }, 'chat')).toMatchObject({
    visibility: 'visible',
    severity: 'permission',
    label: 'Permission event'
  });
  expect(rawEventPresentation('raw', { type: 'result', subtype: 'error', error: 'command failed' }, 'chat')).toMatchObject({
    visibility: 'visible',
    severity: 'error',
    label: 'Error event'
  });
});

it('keeps failed tool details expanded in chat and debug modes', () => {
  expect(toolPresentation('Bash', 'failed', 'Command failed with exit code 1', 'chat')).toEqual({
    visibility: 'visible',
    detail: 'expanded'
  });
  expect(toolPresentation('Bash', 'failed', 'Command failed with exit code 1', 'debug')).toEqual({
    visibility: 'visible',
    detail: 'expanded'
  });
});
```

- [ ] **Step 2: Write failing tests for shared tool summaries**

Create `web/src/toolSummaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { summarizeToolInput, transcriptToolSummaryLabel } from './toolSummaries';

describe('toolSummaries', () => {
  it('summarizes representative tool inputs', () => {
    expect(summarizeToolInput('Read', { file_path: '/repo/web/src/App.tsx', offset: 10, limit: 20 })).toBe('/repo/web/src/App.tsx (offset 10, limit 20)');
    expect(summarizeToolInput('Bash', { command: 'npm --prefix web test', description: 'Run frontend tests' })).toBe('Run frontend tests · $ npm --prefix web test');
    expect(summarizeToolInput('Edit', { file_path: 'web/src/App.tsx', old_string: 'old', new_string: 'new' })).toBe('web/src/App.tsx · replace "old" -> "new"');
  });

  it('creates compact transcript labels from tool category and status', () => {
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Read', status: 'completed', inputSummary: '/repo/a.ts', resultSummary: 'hidden' })).toBe('Read /repo/a.ts');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Edit', status: 'completed', inputSummary: 'web/src/App.tsx · replace "old" -> "new"', resultSummary: 'updated' })).toBe('Edited web/src/App.tsx');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'completed', inputSummary: 'Run tests · $ npm test', resultSummary: 'passed' })).toBe('Ran npm test');
    expect(transcriptToolSummaryLabel({ type: 'tool', name: 'Bash', status: 'failed', inputSummary: '$ npm test', resultSummary: 'Command failed' })).toBe('Failed npm test');
    expect(transcriptToolSummaryLabel({ type: 'task', title: 'Explore rendering', source: 'Explore subagent', status: 'completed', summary: 'Completed.' })).toBe('Explore rendering');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm --prefix web test -- presentationPolicy.test.ts toolSummaries.test.ts
```

Expected: FAIL because `rawEventPresentation` and `toolPresentation` do not accept display mode yet, and `toolSummaries.ts` does not exist.

- [ ] **Step 4: Implement display mode types and mode-aware raw policy**

In `web/src/presentationPolicy.ts`, update the top types and signatures:

```ts
export type ConversationDisplayMode = 'chat' | 'debug';
export type ToolStatus = 'running' | 'completed' | 'failed';
export type ToolVisibility = 'hidden' | 'visible';
export type ToolDetail = 'hidden' | 'collapsed' | 'expanded';
export type ActivityVisibility = 'hidden' | 'anchor' | 'compact' | 'visible';
export type RawSeverity = 'info' | 'warning' | 'error' | 'permission';
```

Replace `rawEventPresentation` with:

```ts
export function rawEventPresentation(kind: string, payload: unknown, displayMode: ConversationDisplayMode = 'chat'): RawEventPresentation {
  if (displayMode === 'debug') {
    if (isPermissionOrRiskPayload(payload)) return { visibility: 'visible', severity: 'permission', label: 'Permission event' };
    if (isErrorLikeRawPayload(payload)) return { visibility: 'visible', severity: 'error', label: 'Error event' };
    if (kind === 'system') return { visibility: 'visible', severity: 'info', label: 'System event' };
    return { visibility: 'visible', severity: 'info', label: 'Raw event' };
  }

  if (isPermissionOrRiskPayload(payload)) return { visibility: 'visible', severity: 'permission', label: 'Permission event' };
  if (isErrorLikeRawPayload(payload)) return { visibility: 'visible', severity: 'error', label: 'Error event' };
  if (isSuccessfulMetadataPayload(payload)) return { visibility: 'anchor', severity: 'info' };
  if (isObject(payload) && payload.type === 'user') return { visibility: 'anchor', severity: 'info' };
  if (kind === 'system') return { visibility: 'hidden', severity: 'info' };
  return { visibility: 'visible', severity: 'warning', label: 'Unknown event' };
}
```

Update `toolPresentation` signature while preserving current behavior:

```ts
export function toolPresentation(name: string, status: ToolStatus, result: string, _displayMode: ConversationDisplayMode = 'chat'): ToolPresentation {
  if (status === 'failed') return { visibility: 'visible', detail: 'expanded' };
  if (status === 'running') return { visibility: 'visible', detail: 'expanded' };
  if (isReadOnlyInspectionTool(name)) return { visibility: 'hidden', detail: 'hidden' };
  return { visibility: 'visible', detail: result.trim() ? 'collapsed' : 'hidden' };
}
```

- [ ] **Step 5: Implement shared tool summary helpers**

Create `web/src/toolSummaries.ts`:

```ts
type ObjectPayload = Record<string, unknown>;

export type TranscriptSummaryTarget =
  | { type: 'tool'; name: string; status: 'running' | 'completed' | 'failed'; inputSummary: string; resultSummary: string }
  | { type: 'task'; title: string; source: string; status: 'pending' | 'running' | 'completed' | 'failed'; summary: string };

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

function compactText(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(' ');
}

function shortText(text: string, maxLength = 160): string {
  const compact = compactText(text);
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(summarize).filter(Boolean).join('\n');
  if (isObject(value)) {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${typeof entry === 'string' ? entry : JSON.stringify(entry)}`)
      .join(', ');
  }
  return String(value);
}

function numberField(payload: ObjectPayload, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function valueSummary(value: unknown, maxLength = 120): string | null {
  if (typeof value === 'string' && value.trim()) return shortText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (isObject(value)) return shortText(JSON.stringify(value), maxLength);
  return shortText(String(value), maxLength);
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function lineCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

function outputMeasure(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return 'no output';
  const lines = lineCount(trimmed);
  const chars = trimmed.length;
  return lines > 1 ? `${countLabel(lines, 'line')}, ${countLabel(chars, 'char')}` : countLabel(chars, 'char');
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (!isObject(input)) return summarize(input);

  if (name === 'Bash') {
    const command = stringField(input, ['command']);
    const description = stringField(input, ['description']);
    const background = input.run_in_background === true ? ' (background)' : '';
    if (!command) return summarize(input);
    return `${description ? `${shortText(description, 72)} · ` : ''}$ ${shortText(command, 180)}${background}`;
  }

  if (name === 'Read') {
    const path = stringField(input, ['file_path', 'path']);
    const offset = numberField(input, ['offset']);
    const limit = numberField(input, ['limit']);
    const range = [offset !== null ? `offset ${offset}` : null, limit !== null ? `limit ${limit}` : null]
      .filter(Boolean)
      .join(', ');
    return path ? `${path}${range ? ` (${range})` : ''}` : summarize(input);
  }

  if (name === 'Glob') {
    const pattern = stringField(input, ['pattern']);
    const path = stringField(input, ['path', 'base_path']);
    if (pattern && path) return `${pattern} in ${path}`;
    return pattern ?? path ?? summarize(input);
  }

  if (name === 'Grep') {
    const pattern = stringField(input, ['pattern']);
    const path = stringField(input, ['path']);
    const glob = stringField(input, ['glob']);
    const outputMode = stringField(input, ['output_mode', 'outputMode']);
    const parts = [
      pattern ? `"${shortText(pattern, 80)}"` : null,
      path ? `in ${path}` : null,
      glob ? `glob ${glob}` : null,
      outputMode
    ].filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(' · ') : summarize(input);
  }

  if (name === 'Edit') {
    const path = stringField(input, ['file_path', 'path']);
    const oldString = stringField(input, ['old_string', 'oldString']);
    const newString = stringField(input, ['new_string', 'newString']);
    const replacement = oldString || newString ? `replace "${shortText(oldString ?? '', 48)}" -> "${shortText(newString ?? '', 48)}"` : null;
    return [path, replacement, input.replace_all === true ? 'replace all' : null]
      .filter((part): part is string => Boolean(part))
      .join(' · ') || summarize(input);
  }

  if (name === 'MultiEdit') {
    const path = stringField(input, ['file_path', 'path']);
    const edits = Array.isArray(input.edits) ? countLabel(input.edits.length, 'edit') : null;
    return [path, edits].filter((part): part is string => Boolean(part)).join(' · ') || summarize(input);
  }

  if (name === 'Write') {
    const path = stringField(input, ['file_path', 'path']);
    const content = typeof input.content === 'string' ? `write ${outputMeasure(input.content)}` : null;
    return [path, content].filter((part): part is string => Boolean(part)).join(' · ') || summarize(input);
  }

  const preferredKeys = ['file_path', 'path', 'url', 'pattern', 'query', 'command', 'name', 'id'];
  const preferred = preferredKeys
    .map((key) => {
      const value = valueSummary(input[key]);
      return value ? `${key}: ${value}` : null;
    })
    .filter((part): part is string => part !== null);
  if (preferred.length > 0) return preferred.slice(0, 3).join(' · ');

  return Object.entries(input)
    .filter(([key]) => !['content', 'prompt', 'message'].includes(key))
    .map(([key, value]) => {
      const summary = valueSummary(value);
      return summary ? `${key}: ${summary}` : null;
    })
    .filter((part): part is string => part !== null)
    .slice(0, 3)
    .join(' · ') || summarize(input);
}

function firstPath(summary: string): string | null {
  const first = summary.split(' · ')[0]?.trim();
  return first && /(?:^\/|^~\/|^\.{1,2}\/|^[\w@.-]+\/)/.test(first) ? first : null;
}

function commandFromInputSummary(inputSummary: string): string | null {
  const match = inputSummary.match(/\$\s+(.+)$/);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').trim();
}

function conciseCommand(command: string): string {
  return command.replace(/^npm\s+--prefix\s+\S+\s+/, 'npm ').replace(/^cargo\s+/, 'cargo ').trim();
}

export function transcriptToolSummaryLabel(target: TranscriptSummaryTarget): string {
  if (target.type === 'task') {
    if (target.status === 'failed') return `Failed ${target.title}`;
    return target.title;
  }

  const failed = target.status === 'failed';
  const path = firstPath(target.inputSummary);
  if (target.name === 'Read') return failed ? `Failed reading ${path ?? 'file'}` : `Read ${path ?? 'file'}`;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(target.name)) return failed ? `Failed editing ${path ?? 'file'}` : `Edited ${path ?? 'file'}`;

  if (target.name === 'Bash') {
    const command = commandFromInputSummary(target.inputSummary);
    if (command) return `${failed ? 'Failed' : 'Ran'} ${conciseCommand(command)}`;
    return failed ? 'Failed command' : 'Ran command';
  }

  if (target.name === 'Glob') return failed ? 'Failed file search' : 'Searched files';
  if (target.name === 'Grep') return failed ? 'Failed text search' : 'Searched text';
  if (/permission|review/i.test(target.name)) return failed ? 'Failed review' : 'Reviewed changes';
  return failed ? `Failed ${target.name}` : target.name;
}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm --prefix web test -- presentationPolicy.test.ts toolSummaries.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add web/src/presentationPolicy.ts web/src/presentationPolicy.test.ts web/src/toolSummaries.ts web/src/toolSummaries.test.ts
git commit -m "$(cat <<'EOF'
Add transcript display policy helpers
EOF
)"
```

---

### Task 2: Make block projection display-mode aware

**Files:**
- Modify: `web/src/conversationBlocks.ts`
- Modify: `web/src/conversationBlocks.test.ts`
- Modify: `web/src/activityTimeline.ts`
- Modify: `web/src/activityTimeline.test.ts`

- [ ] **Step 1: Write failing projection tests for debug mode**

Add these tests to `web/src/conversationBlocks.test.ts`:

```ts
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
```

- [ ] **Step 2: Write failing activity timeline test for shared summarizer parity**

Add this test to `web/src/activityTimeline.test.ts`:

```ts
it('uses the shared tool input summary shape for transcript parity', () => {
  const activities = buildActivityTimeline([
    event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/repo/a.ts', offset: 1, limit: 2 } }),
    event(2, 'tool', { type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'web/src/App.tsx', old_string: 'old', new_string: 'new' } })
  ], [1, 2]);

  expect(activities.find((activity) => activity.id === 'activity-toolu_read')).toMatchObject({
    summary: '/repo/a.ts (offset 1, limit 2)'
  });
  expect(activities.find((activity) => activity.id === 'activity-toolu_edit')).toMatchObject({
    summary: 'web/src/App.tsx · replace "old" -> "new"'
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm --prefix web test -- conversationBlocks.test.ts activityTimeline.test.ts
```

Expected: FAIL because `buildConversationBlocks` does not accept options and `activityTimeline.ts` still has a local summarizer.

- [ ] **Step 4: Import shared summarizer in `conversationBlocks.ts`**

At the top of `web/src/conversationBlocks.ts`, add:

```ts
import { summarizeToolInput } from './toolSummaries';
```

Delete the local `summarizeToolInput` function from `conversationBlocks.ts`. Keep these local helpers only if still used by other local functions: `summarize`, `shortText`, `numberField`, `valueSummary`, `countLabel`, `lineCount`, and `outputMeasure`. After deleting, remove any local helper that TypeScript reports as unused.

- [ ] **Step 5: Add display mode options to projection**

In `web/src/conversationBlocks.ts`, import the display mode type:

```ts
import {
  rawEventPresentation,
  taskToolPresentation,
  toolActivityPresentation,
  toolPresentation,
  toolResultSemantics,
  type ConversationDisplayMode,
  type RawSeverity,
  type ToolResultKind
} from './presentationPolicy';
```

Add this type near the other internal types:

```ts
type BuildConversationBlocksOptions = {
  displayMode?: ConversationDisplayMode;
};
```

Change `normalizedItems` signature:

```ts
function normalizedItems(event: UiEvent, displayMode: ConversationDisplayMode): NormalizedItem[] | null {
```

Inside `normalizedItems`, replace calls to `rawEventPresentation(event.kind, event.payload)` with:

```ts
const presentation = rawEventPresentation(event.kind, event.payload, displayMode);
```

Replace the system-event skip:

```ts
if (event.kind === 'system') {
  if (displayMode === 'debug') return [{ type: 'raw', event, label: rawEventPresentation(event.kind, event.payload, displayMode).label, severity: rawEventPresentation(event.kind, event.payload, displayMode).severity }];
  return [];
}
```

Change the exported function signature and local mode:

```ts
export function buildConversationBlocks(events: UiEvent[], options: BuildConversationBlocksOptions = {}): ConversationBlock[] {
  const displayMode = options.displayMode ?? 'chat';
```

Inside `appendItems`, replace fallback presentation with:

```ts
const presentation = rawEventPresentation(fallbackEvent.kind, fallbackEvent.payload, displayMode);
```

At the bottom of the event loop, call:

```ts
appendItems(normalizedItems(event, displayMode), event);
```

- [ ] **Step 6: Import shared summarizer in `activityTimeline.ts`**

At the top of `web/src/activityTimeline.ts`, add:

```ts
import { summarizeToolInput } from './toolSummaries';
```

Delete the local `summarizeToolInput` function and remove local helpers that become unused. Keep `shortText`, `summarize`, `stringField`, and `valueSummary` only if TypeScript still needs them.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npm --prefix web test -- conversationBlocks.test.ts activityTimeline.test.ts toolSummaries.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts web/src/activityTimeline.ts web/src/activityTimeline.test.ts web/src/toolSummaries.ts web/src/toolSummaries.test.ts
git commit -m "$(cat <<'EOF'
Project conversation blocks by display mode
EOF
)"
```

---

### Task 3: Wire display mode through App and session events

**Files:**
- Modify: `web/src/useSessionEvents.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/ConversationWorkspace.tsx`
- Modify: `web/src/ConversationBlockList.tsx`
- Modify: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Write failing component test for the mode switch contract**

Add this test near the top of `web/src/ConversationBlockList.test.tsx` after the existing Markdown test:

```tsx
it('renders a Chat Debug mode switch and calls back when changed', () => {
  const onDisplayModeChange = vi.fn();
  const blocks: ConversationBlock[] = [
    {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      text: 'Hello',
      eventIds: [1],
      rawEvents: [rawEvent(1, { message: 'Hello' })]
    }
  ];

  render(<ConversationBlockList blocks={blocks} displayMode="chat" onDisplayModeChange={onDisplayModeChange} />);

  expect(screen.getByRole('button', { name: 'Chat view' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Debug view' })).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(screen.getByRole('button', { name: 'Debug view' }));

  expect(onDisplayModeChange).toHaveBeenCalledWith('debug');
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: FAIL because `ConversationBlockList` does not accept `displayMode` or render the switch.

- [ ] **Step 3: Update `useSessionEvents.ts` options and projection memo**

In `web/src/useSessionEvents.ts`, import the display mode type:

```ts
import type { ConversationDisplayMode } from './presentationPolicy';
```

Add to `UseSessionEventsOptions`:

```ts
  displayMode: ConversationDisplayMode;
```

Destructure the option:

```ts
  displayMode,
```

Change `activeBlocks` memo:

```ts
  const activeBlocks = useMemo(
    () => buildConversationBlocks(visibleEvents, { displayMode }),
    [displayMode, visibleEvents]
  );
```

- [ ] **Step 4: Add display mode state in `App.tsx`**

In `web/src/App.tsx`, import the type:

```ts
import type { ConversationDisplayMode } from './presentationPolicy';
```

Add state after inspector tab state:

```ts
  const [conversationDisplayMode, setConversationDisplayMode] = useState<ConversationDisplayMode>('chat');
```

Pass it into `useSessionEvents`:

```ts
    displayMode: conversationDisplayMode,
```

Pass it into `ConversationWorkspace`:

```tsx
          conversationDisplayMode={conversationDisplayMode}
          onConversationDisplayModeChange={setConversationDisplayMode}
```

- [ ] **Step 5: Pass mode through `ConversationWorkspace.tsx`**

In `web/src/ConversationWorkspace.tsx`, import the type:

```ts
import type { ConversationDisplayMode } from './presentationPolicy';
```

Add to `Props`:

```ts
  conversationDisplayMode: ConversationDisplayMode;
  onConversationDisplayModeChange: (mode: ConversationDisplayMode) => void;
```

Destructure the props:

```ts
  conversationDisplayMode,
  onConversationDisplayModeChange,
```

Update the `ConversationBlockList` call:

```tsx
              <ConversationBlockList
                blocks={activeBlocks}
                displayMode={conversationDisplayMode}
                onDisplayModeChange={onConversationDisplayModeChange}
              />
```

- [ ] **Step 6: Add mode switch props and UI to `ConversationBlockList.tsx`**

In `web/src/ConversationBlockList.tsx`, import the type:

```ts
import type { ConversationDisplayMode } from './presentationPolicy';
```

Add props type near helpers:

```ts
type ConversationBlockListProps = {
  blocks: ConversationBlock[];
  displayMode: ConversationDisplayMode;
  onDisplayModeChange: (mode: ConversationDisplayMode) => void;
};
```

Add this component before `ConversationBlockView`:

```tsx
function ConversationDisplayModeSwitch({
  displayMode,
  onDisplayModeChange
}: {
  displayMode: ConversationDisplayMode;
  onDisplayModeChange: (mode: ConversationDisplayMode) => void;
}) {
  return (
    <div className="conversation-display-mode" aria-label="Conversation display mode">
      <button
        type="button"
        className={displayMode === 'chat' ? 'selected' : undefined}
        aria-pressed={displayMode === 'chat'}
        aria-label="Chat view"
        onClick={() => onDisplayModeChange('chat')}
      >
        Chat
      </button>
      <button
        type="button"
        className={displayMode === 'debug' ? 'selected' : undefined}
        aria-pressed={displayMode === 'debug'}
        aria-label="Debug view"
        onClick={() => onDisplayModeChange('debug')}
      >
        Debug
      </button>
    </div>
  );
}
```

Replace the default export signature:

```tsx
export default function ConversationBlockList({ blocks, displayMode, onDisplayModeChange }: ConversationBlockListProps) {
  return (
    <div className="conversation-blocks">
      <ConversationDisplayModeSwitch displayMode={displayMode} onDisplayModeChange={onDisplayModeChange} />
      {blocks.map((block) => (
        <ConversationBlockView key={block.id} block={block} displayMode={displayMode} />
      ))}
    </div>
  );
}
```

Update `ConversationBlockView` signature and calls so `displayMode` is available:

```tsx
function ConversationBlockView({ block, displayMode }: { block: ConversationBlock; displayMode: ConversationDisplayMode }) {
  if (block.type === 'anchor') return <span id={blockElementId(block)} className="conversation-anchor" aria-hidden="true" />;
  if (block.type === 'message') return <MessageBlockView block={block} displayMode={displayMode} />;
  if (block.type === 'tool') return <ToolBlockView block={block} displayMode={displayMode} />;
  if (block.type === 'task') return <TaskBlockView block={block} displayMode={displayMode} />;
  if (block.type === 'error') return <ErrorBlockView block={block} displayMode={displayMode} />;
  return <RawBlockView block={block} displayMode={displayMode} />;
}
```

For this task, update each child component signature to accept `displayMode` and leave rendering unchanged except for prop plumbing. The next task changes the visual behavior.

- [ ] **Step 7: Update existing tests to pass required props**

In `web/src/ConversationBlockList.test.tsx`, add helper:

```tsx
function renderConversation(blocks: ConversationBlock[], displayMode: 'chat' | 'debug' = 'chat') {
  return render(<ConversationBlockList blocks={blocks} displayMode={displayMode} onDisplayModeChange={vi.fn()} />);
}
```

Replace existing calls of:

```tsx
render(<ConversationBlockList blocks={blocks} />);
```

with:

```tsx
renderConversation(blocks);
```

Where a test needs `container`, use:

```tsx
const { container } = renderConversation(blocks);
```

- [ ] **Step 8: Run targeted tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add web/src/useSessionEvents.ts web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx
git commit -m "$(cat <<'EOF'
Wire transcript display mode through UI
EOF
)"
```

---

### Task 4: Render compact chat summaries and debug-only raw details

**Files:**
- Modify: `web/src/ConversationBlockList.tsx`
- Modify: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Write failing tests for chat summary rendering and debug raw details**

Add these tests to `web/src/ConversationBlockList.test.tsx`:

```tsx
it('renders completed tools as compact collapsed summaries in chat mode', () => {
  const blocks: ConversationBlock[] = [
    {
      id: 'tool-bash',
      type: 'tool',
      name: 'Bash',
      status: 'completed',
      inputSummary: '$ npm test',
      resultSummary: 'long stdout',
      resultKind: 'text',
      resultDisplay: 'collapsed',
      resultLabel: 'Result collapsed (11 chars)',
      eventIds: [12, 13],
      rawEvents: [rawEvent(12, { name: 'Bash' }), rawEvent(13, { content: 'long stdout' })]
    }
  ];

  renderConversation(blocks, 'chat');

  const summary = screen.getByText('▸ Ran npm test');
  expect(summary.closest('summary')).toHaveClass('tool-summary-chip');
  const details = summary.closest('details');
  expect(details).toHaveClass('tool-summary-details');
  expect(details).not.toHaveAttribute('open');
  expect(screen.queryByText('Raw events')).not.toBeInTheDocument();
});

it('automatically opens failed tool summaries with key stderr in chat mode', () => {
  const blocks: ConversationBlock[] = [
    {
      id: 'tool-fail',
      type: 'tool',
      name: 'Bash',
      status: 'failed',
      inputSummary: '$ npm test',
      resultSummary: 'stderr: expected true to be false\nCommand failed with exit code 1',
      resultKind: 'text',
      resultDisplay: 'visible',
      resultLabel: 'Failed result shown (60 chars)',
      eventIds: [14, 15],
      rawEvents: [rawEvent(14, { name: 'Bash' }), rawEvent(15, { content: 'stderr: expected true to be false' })]
    }
  ];

  renderConversation(blocks, 'chat');

  const summary = screen.getByText('▾ Failed npm test');
  const details = summary.closest('details');
  expect(details).toHaveAttribute('open');
  expect(screen.getByText(/expected true to be false/)).toBeInTheDocument();
  expect(screen.queryByText('Raw events')).not.toBeInTheDocument();
});

it('shows raw details for messages, tools, tasks, errors, and raw blocks in debug mode', () => {
  const blocks: ConversationBlock[] = [
    { id: 'message-raw', type: 'message', role: 'assistant', text: 'hello', eventIds: [1], rawEvents: [rawEvent(1, { messageNested: { ok: true } })] },
    { id: 'tool-raw', type: 'tool', name: 'Bash', status: 'completed', inputSummary: '$ echo ok', resultSummary: 'ok', resultKind: 'text', resultDisplay: 'collapsed', resultLabel: 'Result collapsed (2 chars)', eventIds: [2], rawEvents: [rawEvent(2, { toolNested: { ok: true } })] },
    { id: 'task-raw', type: 'task', title: 'Run tests', source: 'Bash', status: 'completed', summary: 'Completed.', eventIds: [3], rawEvents: [rawEvent(3, { taskNested: { ok: true } })] },
    { id: 'error-raw', type: 'error', message: 'Boom', eventIds: [4], rawEvents: [rawEvent(4, { errorNested: { message: 'Boom' } })] },
    { id: 'fallback-raw', type: 'raw', label: 'Raw event', severity: 'info', eventIds: [5], rawEvents: [rawEvent(5, { rawNested: { preserved: true } })] }
  ];

  renderConversation(blocks, 'debug');

  expect(screen.getAllByText('Raw events')).toHaveLength(5);
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: FAIL because chat mode still renders full tool cards and debug raw details are not shown for all block types.

- [ ] **Step 3: Import transcript summary label helper**

In `web/src/ConversationBlockList.tsx`, add:

```ts
import { transcriptToolSummaryLabel } from './toolSummaries';
```

- [ ] **Step 4: Add debug raw details helper**

Add this helper after `CopyButton`:

```tsx
function DebugRawDetails({ rawEvents, displayMode }: { rawEvents: ConversationBlock['rawEvents']; displayMode: ConversationDisplayMode }) {
  if (displayMode !== 'debug') return null;
  return <RawEventDetails rawEvents={rawEvents} />;
}
```

Update `MessageBlockView`:

```tsx
function MessageBlockView({ block, displayMode }: { block: MessageBlock; displayMode: ConversationDisplayMode }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block message-block ${block.role}`}>
      <header className="block-header message-header">
        <span className="message-author">
          <span className="message-avatar" aria-hidden="true">{block.role === 'assistant' ? 'C' : block.role === 'user' ? 'Y' : 'S'}</span>
          <span>{roleLabel(block.role)}</span>
        </span>
      </header>
      <MessageMarkdown text={block.text} />
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </article>
  );
}
```

Update `ErrorBlockView` and `RawBlockView` so `RawEventDetails` only appears through `DebugRawDetails`:

```tsx
function ErrorBlockView({ block, displayMode }: { block: ErrorBlock; displayMode: ConversationDisplayMode }) {
  return (
    <article id={blockElementId(block)} className="conversation-block error-block">
      <header className="block-header">
        <span>Error</span>
      </header>
      <p>{block.message}</p>
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </article>
  );
}

function RawBlockView({ block, displayMode }: { block: RawBlock; displayMode: ConversationDisplayMode }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block raw-block ${block.severity ?? 'info'}`}>
      <header className="block-header">
        <span>{block.label}</span>
      </header>
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </article>
  );
}
```

- [ ] **Step 5: Add compact tool summary renderer**

Add these helpers before `ToolBlockView`:

```tsx
function summaryCaret(isOpenByDefault: boolean): string {
  return isOpenByDefault ? '▾' : '▸';
}

function ToolSummaryDetails({ block, displayMode }: { block: ToolBlock; displayMode: ConversationDisplayMode }) {
  const hasVisibleResult = block.resultSummary.trim() && block.resultDisplay !== 'hidden';
  const defaultOpen = block.status === 'failed' || block.status === 'running';
  const label = transcriptToolSummaryLabel({
    type: 'tool',
    name: block.name,
    status: block.status,
    inputSummary: block.inputSummary,
    resultSummary: block.resultSummary
  });

  if (displayMode === 'debug') return <ToolBlockCard block={block} displayMode={displayMode} />;

  return (
    <details id={blockElementId(block)} className={`tool-summary-details ${block.status} result-${block.resultKind}`} open={defaultOpen}>
      <summary className="tool-summary-chip">
        <span>{summaryCaret(defaultOpen)} {label}</span>
        <span className={`tool-status tool-status-${block.status}`}>
          <span className="tool-status-dot" aria-hidden="true" />
          {block.status}
        </span>
      </summary>
      <div className="tool-summary-body">
        {block.inputSummary.trim() && <p className="tool-input-summary">{block.inputSummary}</p>}
        {block.resultLabel && <p className="tool-result-label">{block.resultLabel}</p>}
        {hasVisibleResult && (
          <section className="block-section tool-result visible-result tool-result-detail">
            <h4>{toolResultTitle(block)}</h4>
            <ToolResultContent block={block} />
          </section>
        )}
      </div>
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </details>
  );
}
```

Rename the existing `ToolBlockView` implementation to `ToolBlockCard` and add debug raw details inside the returned article after collapsed result rendering:

```tsx
function ToolBlockCard({ block, displayMode }: { block: ToolBlock; displayMode: ConversationDisplayMode }) {
  const hasVisibleResult = block.resultSummary.trim() && block.resultDisplay !== 'hidden';
  const showInlineResult = hasVisibleResult && block.resultDisplay === 'visible';
  const showCollapsedResult = hasVisibleResult && block.resultDisplay === 'collapsed';

  return (
    <article id={blockElementId(block)} className={`conversation-block tool-block ${block.status} result-${block.resultKind}${block.density === 'compact' ? ' compact' : ''}`}>
      <header className="block-header tool-activity-header">
        <span className="tool-name">{block.name}</span>
        <span className={`tool-status tool-status-${block.status}`}>
          <span className="tool-status-dot" aria-hidden="true" />
          {block.status}
        </span>
      </header>
      <div className="tool-activity-body">
        {block.inputSummary.trim() && <p className="tool-input-summary">{block.inputSummary}</p>}
        {block.resultLabel && <p className="tool-result-label">{block.resultLabel}</p>}
      </div>
      {showInlineResult && (
        <section className="block-section tool-result visible-result tool-result-detail">
          <h4>{toolResultTitle(block)}</h4>
          <ToolResultContent block={block} />
        </section>
      )}
      {showCollapsedResult && (
        <details className="block-section tool-result collapsed-result tool-details">
          <summary>{block.resultLabel || 'Details'}</summary>
          <section className="tool-result-detail">
            <h4>{toolResultTitle(block)}</h4>
            <ToolResultContent block={block} />
          </section>
        </details>
      )}
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </article>
  );
}

function ToolBlockView({ block, displayMode }: { block: ToolBlock; displayMode: ConversationDisplayMode }) {
  return <ToolSummaryDetails block={block} displayMode={displayMode} />;
}
```

- [ ] **Step 6: Add compact task summary renderer**

Replace `TaskBlockView` with a chat/debug split:

```tsx
function TaskBlockCard({ block, displayMode }: { block: TaskBlock; displayMode: ConversationDisplayMode }) {
  return (
    <article id={blockElementId(block)} className={`conversation-block task-block ${block.status}${block.density === 'compact' ? ' compact' : ''}`}>
      <header className="block-header task-header">
        <span className="task-title-row">
          <span className="task-status-dot" aria-hidden="true" />
          <span className="task-title">{block.title}</span>
        </span>
        <span className="task-meta-row">
          <span className="task-source">{block.source}</span>
          <span className="task-status">{block.status}</span>
        </span>
      </header>
      <p className="task-summary">{block.summary}</p>
      {block.completionSummary && (
        <section className="task-result">
          <h4>Completed</h4>
          <p>{block.completionSummary}</p>
        </section>
      )}
      {block.failureSummary && (
        <section className="task-result task-failure">
          <h4>Failed</h4>
          <p>{block.failureSummary}</p>
        </section>
      )}
      {block.detail && (
        <details className="block-section task-detail">
          <summary>Details</summary>
          <pre>{block.detail}</pre>
        </details>
      )}
      {block.outputPath && (
        <section className="block-section output-path">
          <h4>Output</h4>
          <code>{block.outputPath}</code>
        </section>
      )}
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </article>
  );
}

function TaskBlockView({ block, displayMode }: { block: TaskBlock; displayMode: ConversationDisplayMode }) {
  if (displayMode === 'debug') return <TaskBlockCard block={block} displayMode={displayMode} />;
  const defaultOpen = block.status === 'failed' || block.status === 'running';
  const label = transcriptToolSummaryLabel({
    type: 'task',
    title: block.title,
    source: block.source,
    status: block.status,
    summary: block.summary
  });

  return (
    <details id={blockElementId(block)} className={`task-summary-details ${block.status}`} open={defaultOpen}>
      <summary className="tool-summary-chip task-summary-chip">
        <span>{summaryCaret(defaultOpen)} {label}</span>
        <span className="task-status">{block.status}</span>
      </summary>
      <div className="tool-summary-body">
        <p className="task-summary">{block.summary}</p>
        {block.completionSummary && <p>{block.completionSummary}</p>}
        {block.failureSummary && <p className="task-failure-text">{block.failureSummary}</p>}
        {block.detail && <pre>{block.detail}</pre>}
        {block.outputPath && <code>{block.outputPath}</code>}
      </div>
      <DebugRawDetails rawEvents={block.rawEvents} displayMode={displayMode} />
    </details>
  );
}
```

- [ ] **Step 7: Run targeted tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: PASS. If tests fail because the old tests expect article wrappers for chat-mode tool/task blocks, update those tests to render debug mode for full-card assertions and keep chat-mode assertions for the compact summary behavior.

- [ ] **Step 8: Commit Task 4**

```bash
git add web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx
git commit -m "$(cat <<'EOF'
Render chat transcript summaries
EOF
)"
```

---

### Task 5: Style compact transcript mode

**Files:**
- Modify: `web/src/ConversationBlockList.css`
- Modify: `web/src/App.css`
- Modify: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Write CSS alignment test**

Extend the existing `keeps App.css selectors aligned with rendered conversation block DOM` test in `web/src/ConversationBlockList.test.tsx` with:

```ts
expect(css).toMatch(/\.conversation-display-mode\b/);
```

Also add a CSS file check helper for `ConversationBlockList.css`:

```ts
const blockListCss = () => readFileSync(new URL('./ConversationBlockList.css', import.meta.url), 'utf8');
```

Add this test:

```ts
it('keeps ConversationBlockList.css aligned with compact summary DOM', () => {
  const css = blockListCss();

  expect(css).toMatch(/\.tool-summary-details\b/);
  expect(css).toMatch(/\.tool-summary-chip\b/);
  expect(css).toMatch(/\.tool-summary-body\b/);
});
```

- [ ] **Step 2: Run component tests to verify they fail**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: FAIL because CSS selectors are not present.

- [ ] **Step 3: Add mode switch styles to `App.css`**

Add near `.conversation-content` in `web/src/App.css`:

```css
.conversation-display-mode {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin: 0 0 14px;
}

.conversation-display-mode button {
  border-color: transparent;
  border-radius: 999px;
  color: var(--muted);
  background: transparent;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 680;
}

.conversation-display-mode button.selected {
  border-color: var(--border);
  color: var(--text-soft);
  background: rgb(255 253 250 / 0.78);
}
```

- [ ] **Step 4: Add compact summary styles to `ConversationBlockList.css`**

Add near the top of `web/src/ConversationBlockList.css`:

```css
.tool-summary-details,
.task-summary-details {
  max-width: 1180px;
  min-width: 0;
  color: var(--text-soft);
}

.tool-summary-details[open],
.task-summary-details[open] {
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgb(255 253 250 / 0.74);
  padding: 8px 10px 10px;
}

.tool-summary-details.failed,
.task-summary-details.failed {
  border-left: 3px solid var(--danger);
}

.tool-summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  background: rgb(255 253 250 / 0.78);
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.3;
  cursor: pointer;
  list-style: none;
}

.tool-summary-chip::-webkit-details-marker {
  display: none;
}

.tool-summary-chip:hover {
  border-color: var(--border-strong);
  color: var(--text-soft);
  background: var(--surface);
}

.tool-summary-chip > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-summary-body {
  display: grid;
  gap: 7px;
  margin-top: 8px;
}

.task-failure-text {
  color: var(--danger);
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add web/src/ConversationBlockList.css web/src/App.css web/src/ConversationBlockList.test.tsx
git commit -m "$(cat <<'EOF'
Style compact transcript summaries
EOF
)"
```

---

### Task 6: Full verification, manual UI check, and docs review

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Modify only if the visible Chat/Debug mode needs user-facing documentation.

- [ ] **Step 1: Run full frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 3: Start the app for manual verification**

Use the project launcher through the preview server if configured, or start the daemon with the documented command:

```bash
scripts/start-server.sh
```

Expected: server starts and serves the app without frontend runtime errors.

- [ ] **Step 4: Manually verify chat/debug behavior in the browser**

Open the app in a browser and verify:

1. Default transcript mode is Chat.
2. User and assistant messages remain prominent.
3. Completed tool/task activity appears as compact summary chips.
4. Clicking a summary expands details and clicking again collapses it.
5. A failed tool is open by default and shows key stderr/error text.
6. Raw JSON is not visible in Chat mode.
7. Switching to Debug shows raw details for message, tool, task, error, and raw blocks.
8. ActivityPanel and InspectorPanel still show activity and diagnostics.
9. Long sessions are not visually dominated by raw event cards in Chat mode.

- [ ] **Step 5: Check browser console**

Expected: no new React errors, no accessibility warnings caused by invalid nested interactive controls, and no uncaught exceptions when switching modes or expanding summaries.

- [ ] **Step 6: Review README and CLAUDE docs**

Read `README.md` and `CLAUDE.md`. If no docs are needed, do not edit them and record in the final summary: `README.md and CLAUDE.md reviewed; no updates needed.`

If docs are needed, add a concise user-facing note to the most appropriate file. Use this exact wording unless a nearby section requires small style edits:

```md
The transcript defaults to Chat mode, which keeps Claude's answers prominent and collapses tool activity into compact summaries. Use Debug mode at the top of the transcript when you need raw event payloads or low-level diagnostics.
```

- [ ] **Step 7: Run status and diff review**

Run:

```bash
git status --short && git diff -- README.md CLAUDE.md web/src
```

Expected: only intended frontend files and optional docs changes are modified.

- [ ] **Step 8: Commit Task 6**

If no docs changed:

```bash
git add web/src/presentationPolicy.ts web/src/presentationPolicy.test.ts web/src/toolSummaries.ts web/src/toolSummaries.test.ts web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts web/src/activityTimeline.ts web/src/activityTimeline.test.ts web/src/useSessionEvents.ts web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx web/src/ConversationBlockList.css web/src/App.css
git commit -m "$(cat <<'EOF'
Verify layered transcript rendering
EOF
)"
```

If docs changed, include them explicitly:

```bash
git add README.md CLAUDE.md web/src/presentationPolicy.ts web/src/presentationPolicy.test.ts web/src/toolSummaries.ts web/src/toolSummaries.test.ts web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts web/src/activityTimeline.ts web/src/activityTimeline.test.ts web/src/useSessionEvents.ts web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx web/src/ConversationBlockList.css web/src/App.css
git commit -m "$(cat <<'EOF'
Verify layered transcript rendering
EOF
)"
```

If all implementation changes were already committed in previous tasks and docs did not change, skip creating an empty commit.

---

## Self-Review Notes

Spec coverage:

- Chat/debug display mode: Task 1, Task 2, Task 3.
- Compact collapsed tool summaries: Task 4 and Task 5.
- Failed tool key stderr/error default expansion: Task 1 and Task 4.
- Raw/debug details hidden unless debug: Task 2 and Task 4.
- ActivityPanel/Inspector capability preservation: Task 2 shared summary parity and Task 6 manual verification.
- README/CLAUDE review: Task 6.

No placeholder sections remain. Type names used consistently: `ConversationDisplayMode`, `displayMode`, `conversationDisplayMode`, `onConversationDisplayModeChange`, `summarizeToolInput`, and `transcriptToolSummaryLabel`.
