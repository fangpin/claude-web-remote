# Chat-First Output Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the session conversation view follow Claude-app-like chat-first rendering: user/Claude text is primary, low-value tool/raw noise is hidden, important/failed work is visible, and details stay available through controlled expansion or Inspector surfaces.

**Architecture:** Keep raw event persistence unchanged. Add a focused presentation policy layer in the frontend that classifies semantic activities as hidden, visible, collapsed, or expanded, then have `conversationBlocks.ts` use that policy instead of hard-coded scattered tool-name checks. Keep backend task projection aligned by filtering low-value read-only inspection tools out of `TaskGroups`.

**Tech Stack:** Rust backend task projection tests, React + TypeScript frontend, Vitest + Testing Library, `react-markdown` for safe Markdown rendering.

---

## File Structure

- Create `web/src/presentationPolicy.ts`
  - Owns tool/event presentation decisions.
  - Exports `toolPresentation(name, status, result)` and `shouldProjectTaskTool(toolKind)`.
  - Contains the central rule table for hidden/collapsed/visible/expanded behavior.

- Modify `web/src/conversationBlocks.ts`
  - Uses `presentationPolicy.ts` when converting `UiEvent[]` to `ConversationBlock[]`.
  - Hides completed read-only inspection tools from the main conversation.
  - Keeps failed tools visible and expanded.
  - Preserves message merging and tool_use/tool_result pairing.

- Modify `web/src/ConversationBlockList.tsx`
  - Renders `MessageBlock` text as Markdown.
  - Keeps tool/task detail sections controlled by block display state.

- Modify `web/src/App.css`
  - Styles Markdown message content without making code/output blocks look like transport raw output.

- Modify `crates/server/src/task.rs`
  - Uses the same read-only inspection tool policy concept for task projection.
  - Excludes successful read-only inspection tools from `TaskGroups` by never creating task starts for them.

- Modify tests:
  - `web/src/conversationBlocks.test.ts`
  - `web/src/ConversationBlockList.test.tsx`
  - `web/src/App.test.tsx` if task panel expectations need adjustment
  - `crates/server/src/task.rs` unit tests

---

### Task 1: Add frontend presentation policy module

**Files:**
- Create: `web/src/presentationPolicy.ts`
- Test: `web/src/presentationPolicy.test.ts`

- [ ] **Step 1: Write the failing policy tests**

Create `web/src/presentationPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shouldProjectTaskTool, toolPresentation } from './presentationPolicy';

describe('presentationPolicy', () => {
  it('hides completed read-only inspection tools', () => {
    expect(toolPresentation('Read', 'completed', 'file contents')).toEqual({ visibility: 'hidden', detail: 'hidden' });
    expect(toolPresentation('Glob', 'completed', 'a.ts\nb.ts')).toEqual({ visibility: 'hidden', detail: 'hidden' });
    expect(toolPresentation('Grep', 'completed', 'line 1')).toEqual({ visibility: 'hidden', detail: 'hidden' });
  });

  it('shows failed read-only inspection tools expanded', () => {
    expect(toolPresentation('Read', 'failed', 'Error: missing file')).toEqual({ visibility: 'visible', detail: 'expanded' });
  });

  it('collapses successful bash and file mutation tools', () => {
    expect(toolPresentation('Bash', 'completed', 'tests passed')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Edit', 'completed', 'updated file')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Write', 'completed', 'created file')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('NotebookEdit', 'completed', 'updated notebook')).toEqual({ visibility: 'visible', detail: 'collapsed' });
  });

  it('shows failed tools expanded', () => {
    expect(toolPresentation('Bash', 'failed', 'exit code 1')).toEqual({ visibility: 'visible', detail: 'expanded' });
    expect(toolPresentation('Edit', 'failed', 'stale file')).toEqual({ visibility: 'visible', detail: 'expanded' });
  });

  it('keeps task-like tools visible but collapsed when successful', () => {
    expect(toolPresentation('Agent', 'completed', 'review done')).toEqual({ visibility: 'visible', detail: 'collapsed' });
    expect(toolPresentation('Workflow', 'completed', 'workflow done')).toEqual({ visibility: 'visible', detail: 'collapsed' });
  });

  it('does not project read-only inspection tools into task lists', () => {
    expect(shouldProjectTaskTool('Read')).toBe(false);
    expect(shouldProjectTaskTool('Glob')).toBe(false);
    expect(shouldProjectTaskTool('Grep')).toBe(false);
    expect(shouldProjectTaskTool('Bash')).toBe(true);
    expect(shouldProjectTaskTool('Agent')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix web test -- presentationPolicy
```

Expected: FAIL because `web/src/presentationPolicy.ts` does not exist.

- [ ] **Step 3: Implement the policy module**

Create `web/src/presentationPolicy.ts`:

```ts
export type ToolStatus = 'running' | 'completed' | 'failed';
export type ToolVisibility = 'hidden' | 'visible';
export type ToolDetail = 'hidden' | 'collapsed' | 'expanded';

export type ToolPresentation = {
  visibility: ToolVisibility;
  detail: ToolDetail;
};

const READ_ONLY_INSPECTION_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const COLLAPSED_SUCCESS_TOOLS = new Set([
  'Bash',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Agent',
  'Workflow'
]);

export function isReadOnlyInspectionTool(name: string): boolean {
  return READ_ONLY_INSPECTION_TOOLS.has(name);
}

export function shouldProjectTaskTool(toolKind: string): boolean {
  return !isReadOnlyInspectionTool(toolKind);
}

export function toolPresentation(name: string, status: ToolStatus, result: string): ToolPresentation {
  if (status === 'failed') return { visibility: 'visible', detail: 'expanded' };
  if (status === 'running') return { visibility: 'visible', detail: 'expanded' };
  if (isReadOnlyInspectionTool(name)) return { visibility: 'hidden', detail: 'hidden' };
  if (COLLAPSED_SUCCESS_TOOLS.has(name)) return { visibility: 'visible', detail: result.trim() ? 'collapsed' : 'hidden' };
  return { visibility: 'visible', detail: result.trim() ? 'collapsed' : 'hidden' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix web test -- presentationPolicy
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/presentationPolicy.ts web/src/presentationPolicy.test.ts
git commit -m "feat: add output presentation policy"
```

---

### Task 2: Route conversation block visibility through policy

**Files:**
- Modify: `web/src/conversationBlocks.ts`
- Test: `web/src/conversationBlocks.test.ts`

- [ ] **Step 1: Write/update failing conversation block tests**

In `web/src/conversationBlocks.test.ts`, ensure these tests exist or replace equivalent older expectations:

```ts
it('hides completed Read Glob and Grep tool blocks', () => {
  const blocks = buildConversationBlocks([
    event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/a.txt' } }),
    event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', content: 'file contents' }),
    event(3, 'tool', { type: 'tool_use', id: 'toolu_glob', name: 'Glob', input: { pattern: '**/*.ts' } }),
    event(4, 'tool', { type: 'tool_result', tool_use_id: 'toolu_glob', content: '/tmp/a.ts\n/tmp/b.ts' }),
    event(5, 'tool', { type: 'tool_use', id: 'toolu_grep', name: 'Grep', input: { pattern: 'TODO' } }),
    event(6, 'tool', { type: 'tool_result', tool_use_id: 'toolu_grep', content: 'line 1\nline 2' })
  ]);

  expect(blocks).toEqual([]);
});

it('shows failed Read tool blocks expanded', () => {
  const blocks = buildConversationBlocks([
    event(1, 'tool', { type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: '/tmp/missing.txt' } }),
    event(2, 'tool', { type: 'tool_result', tool_use_id: 'toolu_read', is_error: true, content: 'file missing' })
  ]);

  expect(blocks).toMatchObject([
    {
      id: 'tool-toolu_read',
      type: 'tool',
      name: 'Read',
      status: 'failed',
      resultSummary: 'file missing',
      resultDisplay: 'visible'
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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm --prefix web test -- conversationBlocks
```

Expected: FAIL if `conversationBlocks.ts` still has local hard-coded policy or does not hide completed read-only tools.

- [ ] **Step 3: Replace local policy with `presentationPolicy`**

In `web/src/conversationBlocks.ts`, import:

```ts
import { isReadOnlyInspectionTool, toolPresentation } from './presentationPolicy';
```

Remove local `isIgnorableTool` and update `toolResultDisplay`:

```ts
function toolResultDisplay(name: string, status: ToolBlock['status'], result: string): ToolBlock['resultDisplay'] {
  const presentation = toolPresentation(name, status, result);
  if (presentation.detail === 'expanded') return 'visible';
  if (presentation.detail === 'collapsed') return 'collapsed';
  return 'hidden';
}
```

In the pending tool-result merge branch, use:

```ts
const block = makeToolBlock(pending.event, pending.payload, item.event, item.payload);
if (block.type === 'tool' && toolPresentation(block.name, block.status, block.resultSummary).visibility === 'hidden') {
  blocks.splice(pending.blockIndex, 1);
  for (const pendingTool of pendingTools.values()) {
    if (pendingTool.blockIndex > pending.blockIndex) pendingTool.blockIndex -= 1;
  }
} else {
  blocks[pending.blockIndex] = block;
}
pendingTools.delete(id);
```

For standalone results, use:

```ts
const block = makeStandaloneToolResult(item.event, item.payload);
if (toolPresentation(block.name, block.status, block.resultSummary).visibility === 'visible') blocks.push(block);
```

If `isReadOnlyInspectionTool` is imported but not used after this change, remove that import and keep only `toolPresentation`.

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npm --prefix web test -- conversationBlocks
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts
git commit -m "feat: apply chat-first tool rendering policy"
```

---

### Task 3: Render Claude messages as Markdown

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/ConversationBlockList.tsx`
- Modify: `web/src/App.css`
- Test: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Write failing Markdown render test**

In `web/src/ConversationBlockList.test.tsx`, replace the existing assistant message test with:

```tsx
it('renders assistant messages as Markdown', () => {
  const blocks: ConversationBlock[] = [
    {
      id: 'message-1',
      type: 'message',
      role: 'assistant',
      text: '## Summary\n\n- Read `api.rs`\n\n```ts\nconst answer = 42;\n```',
      eventIds: [1],
      rawEvents: [rawEvent(1, { message: 'Here is a snippet' })]
    }
  ];

  render(<ConversationBlockList blocks={blocks} />);

  const article = screen.getByRole('article');
  expect(article).toHaveClass('conversation-block', 'message-block', 'assistant');
  expect(within(article).getByText('Claude').closest('header')).toHaveClass('block-header');
  expect(within(article).getByRole('heading', { name: 'Summary', level: 2 })).toBeInTheDocument();
  expect(within(article).getByRole('listitem')).toHaveTextContent('Read api.rs');
  expect(within(article).getByText('api.rs')).toHaveClass('inline-code');
  expect(within(article).getByText(/const answer = 42/).closest('code')).not.toBeNull();
  expect(within(article).getByText('Raw events')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
npm --prefix web test -- ConversationBlockList
```

Expected: FAIL because Markdown is still rendered as literal text in a `<pre>`.

- [ ] **Step 3: Install Markdown renderer**

Run:

```bash
npm --prefix web install react-markdown
```

Expected: `web/package.json` and `web/package-lock.json` include `react-markdown`.

- [ ] **Step 4: Update `ConversationBlockList.tsx`**

At the top of `web/src/ConversationBlockList.tsx`, add:

```tsx
import ReactMarkdown from 'react-markdown';
```

Replace the message body rendering with:

```tsx
<div className="message-text">
  <ReactMarkdown
    components={{
      code({ className, children, ...props }) {
        return (
          <code className={className ?? 'inline-code'} {...props}>
            {children}
          </code>
        );
      }
    }}
  >
    {block.text}
  </ReactMarkdown>
</div>
```

- [ ] **Step 5: Update Markdown CSS**

In `web/src/App.css`, keep `.message-text` as the readable message container and add:

```css
.message-text > *:first-child {
  margin-top: 0;
}

.message-text > *:last-child {
  margin-bottom: 0;
}

.message-text code {
  border-radius: 5px;
  background: #f2f3f4;
  padding: 2px 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.message-text pre code {
  display: block;
  overflow: auto;
  padding: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run test to verify pass**

Run:

```bash
npm --prefix web test -- ConversationBlockList
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx web/src/App.css
git commit -m "feat: render assistant messages as markdown"
```

---

### Task 4: Align backend task projection with chat-first rules

**Files:**
- Modify: `crates/server/src/task.rs`

- [ ] **Step 1: Write failing backend task projection test**

In `crates/server/src/task.rs`, inside `#[cfg(test)] mod tests`, add:

```rust
#[test]
fn read_only_inspection_tools_do_not_create_tasks() {
    let session_id = Uuid::new_v4();
    let meta = meta(session_id, SessionStatus::Running);
    let events = vec![
        event(
            1,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_use",
                "id": "toolu_read",
                "name": "Read",
                "input": { "file_path": "/repo/demo/src/main.rs" }
            }),
        ),
        event(
            2,
            session_id,
            EventKind::Tool,
            json!({
                "type": "tool_result",
                "tool_use_id": "toolu_read",
                "content": "file contents"
            }),
        ),
    ];

    let tasks = project_session_tasks(&meta, &events);

    assert_eq!(tasks.background.len(), 0);
    assert_eq!(tasks.finished.len(), 0);
}
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cargo test --manifest-path Cargo.toml task::tests::read_only_inspection_tools_do_not_create_tasks
```

Expected: FAIL with `finished.len()` or `background.len()` showing a task was created for `Read`.

- [ ] **Step 3: Implement backend task filter**

In `crates/server/src/task.rs`, after `scoped_task_id`, add:

```rust
fn is_ignorable_tool_kind(tool_kind: &str) -> bool {
    matches!(tool_kind, "Read" | "Glob" | "Grep")
}
```

In `task_start_from_block`, after `tool_kind` is computed, add:

```rust
if is_ignorable_tool_kind(&tool_kind) {
    return None;
}
```

- [ ] **Step 4: Run targeted backend tests**

Run:

```bash
cargo test --manifest-path Cargo.toml task::tests
```

Expected: PASS, with all task tests passing.

- [ ] **Step 5: Commit**

```bash
git add crates/server/src/task.rs
git commit -m "feat: hide read-only tools from task projection"
```

---

### Task 5: Verify chat-first App behavior

**Files:**
- Modify: `web/src/App.test.tsx` if existing expectations still count raw/system cards or read-only tools.

- [ ] **Step 1: Update App-level expectations**

Ensure the existing raw/system test expects only the meaningful error block raw details, not standalone raw/system raw cards:

```tsx
expect(await screen.findByText('visible error event')).toBeInTheDocument();
expect(screen.queryByText('raw event should stay hidden')).not.toBeInTheDocument();
expect(screen.queryByText('system event should stay hidden')).not.toBeInTheDocument();
expect(screen.getAllByText('Raw events')).toHaveLength(1);
```

If task API fixtures include finished `Read` tasks, remove those fixtures or assert they are not rendered:

```tsx
expect(within(sessionPanel).queryByText(/Read:/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run App tests**

Run:

```bash
npm --prefix web test -- App
```

Expected: PASS.

- [ ] **Step 3: Commit if changed**

```bash
git add web/src/App.test.tsx
git commit -m "test: align app output rendering expectations"
```

Skip this commit if `App.test.tsx` did not change.

---

### Task 6: Full verification and docs review

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS, all frontend test files pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS, Vite build completes successfully.

- [ ] **Step 3: Run Rust formatting check**

Run:

```bash
cargo fmt --manifest-path Cargo.toml -- --check
```

Expected: PASS with no output.

- [ ] **Step 4: Run targeted backend task tests**

Run:

```bash
cargo test --manifest-path Cargo.toml task::tests
```

Expected: PASS, all task tests pass.

- [ ] **Step 5: Run full backend test suite**

Run:

```bash
cargo test --manifest-path Cargo.toml
```

Expected: Ideally PASS. If it fails in existing `session::*` or `worktree::*` tests unrelated to task projection, record exact failing test names and do not claim full backend suite passes.

- [ ] **Step 6: Run script and whitespace checks**

Run:

```bash
scripts/test-start-server.sh && git diff --check
```

Expected: PASS.

- [ ] **Step 7: Review README and CLAUDE**

Read `README.md` and `CLAUDE.md`. Do not update them unless the user-facing setup, commands, or documented architecture changed. This rendering policy is internal UI behavior, so expected result is no docs change.

- [ ] **Step 8: Final summary**

Report:

```text
Implemented chat-first output rendering policy:
- completed Read/Glob/Grep hidden from main conversation and task list
- failed tools remain visible
- successful long-output tools default collapsed
- Claude text renders as Markdown

Verification:
- npm --prefix web test: PASS
- npm --prefix web run build: PASS
- cargo fmt --manifest-path Cargo.toml -- --check: PASS
- cargo test --manifest-path Cargo.toml task::tests: PASS
- scripts/test-start-server.sh && git diff --check: PASS
- cargo test --manifest-path Cargo.toml: [PASS or list unrelated failures]

Docs: README.md/CLAUDE.md reviewed; [updated/not needed].
```

---

## Self-Review

**Spec coverage:**
- Chat-first main conversation: Tasks 1-3.
- Hidden read-only tools: Tasks 1-2 and Task 4.
- Collapsed successful tools and expanded failures: Tasks 1-2.
- Markdown Claude output: Task 3.
- Raw/system noise hidden: covered by existing `conversationBlocks.ts` policy and Task 5 App expectations.
- Task list alignment: Task 4.
- Verification and docs review: Task 6.

**Placeholder scan:** No TBD/TODO placeholders remain. Each task includes exact file paths, test code, implementation snippets, commands, expected outcomes, and commit commands.

**Type consistency:** `ToolStatus`, `ToolPresentation`, `visibility`, and `detail` are defined in Task 1 and used consistently in Task 2. Backend `is_ignorable_tool_kind` intentionally mirrors frontend `isReadOnlyInspectionTool` without cross-language coupling.
