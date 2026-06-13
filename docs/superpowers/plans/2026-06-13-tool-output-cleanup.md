# Tool Output Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tool output less noisy by hiding Read/Glob/Grep results from the main card and collapsing other tool results by default.

**Architecture:** Add presentation metadata to `ToolBlock` in `conversationBlocks.ts`, computed from tool name/status while preserving full raw events. Update `ConversationBlockList.tsx` to render hidden/collapsed/visible result modes and update CSS/tests around the new compact display.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing conversation block model and CSS.

---

## File Structure

- Modify `web/src/conversationBlocks.ts`
  - Owns conversion from raw UI events to display blocks.
  - Extend `ToolBlock` with `resultDisplay: 'hidden' | 'collapsed' | 'visible'`.
  - Add helper deciding result display from tool name and result/status.
  - Keep `resultSummary` and `rawEvents` populated even when hidden.

- Modify `web/src/conversationBlocks.test.ts`
  - Owns block-shaping tests.
  - Add/adjust expectations for hidden Read/Glob/Grep result display and collapsed Bash result display.

- Modify `web/src/ConversationBlockList.tsx`
  - Owns rendering of message/tool/task/error/raw blocks.
  - Hide result section for `resultDisplay: 'hidden'`.
  - Render collapsed `<details>` for `resultDisplay: 'collapsed'`.
  - Keep visible result behavior when `resultDisplay: 'visible'`.

- Modify `web/src/ConversationBlockList.test.tsx`
  - Owns rendered DOM tests for block components and App.css selector alignment.
  - Add tests that Read result is not visible in main tool card and Bash result is behind a closed disclosure.

- Modify `web/src/App.css`
  - Update details/result styles only if needed.

---

### Task 1: Add block model tests for tool result display policy

**Files:**
- Modify: `web/src/conversationBlocks.test.ts`
- Test: `web/src/conversationBlocks.test.ts`

- [ ] **Step 1: Update ordinary Read tool expectation to include hidden result display**

In the existing test `pairs nested Claude tool_use and tool_result content blocks`, add `resultDisplay: 'hidden'` to the expected block:

```ts
{
  id: 'tool-toolu_1',
  type: 'tool',
  name: 'Read',
  status: 'completed',
  inputSummary: 'file_path: /tmp/a.txt',
  resultSummary: 'contents',
  resultDisplay: 'hidden',
  eventIds: [1, 2],
  rawEvents: [
    { id: 1, kind: 'assistant', payload: assistantPayload },
    { id: 2, kind: 'user', payload: userPayload }
  ]
}
```

- [ ] **Step 2: Add Bash collapsed-result test**

Add this test after `pairs tool_use and tool_result events with the same tool_use_id`:

```ts
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
      inputSummary: 'command: npm test',
      resultSummary: 'large stdout',
      resultDisplay: 'collapsed'
    });
  });
```

- [ ] **Step 3: Add Glob/Grep hidden-result test**

Add this test after the Bash collapsed test:

```ts
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
      { id: 'tool-toolu_read', type: 'tool', name: 'Read', resultDisplay: 'hidden', resultSummary: 'file contents' },
      { id: 'tool-toolu_glob', type: 'tool', name: 'Glob', resultDisplay: 'hidden', resultSummary: '/tmp/a.ts\n/tmp/b.ts' },
      { id: 'tool-toolu_grep', type: 'tool', name: 'Grep', resultDisplay: 'hidden', resultSummary: 'line 1\nline 2' }
    ]);
  });
```

- [ ] **Step 4: Run block tests and verify they fail**

Run:

```bash
npm --prefix web test -- conversationBlocks
```

Expected: FAIL because `ToolBlock` does not yet include `resultDisplay`.

---

### Task 2: Implement result display policy in block model

**Files:**
- Modify: `web/src/conversationBlocks.ts`
- Modify: `web/src/conversationBlocks.test.ts` existing expectations as needed
- Test: `web/src/conversationBlocks.test.ts`

- [ ] **Step 1: Extend `ToolBlock` type**

In `web/src/conversationBlocks.ts`, add `resultDisplay` to `ToolBlock`:

```ts
export type ToolBlock = {
  id: string;
  type: 'tool';
  name: string;
  status: 'running' | 'completed' | 'failed';
  inputSummary: string;
  resultSummary: string;
  resultDisplay: 'hidden' | 'collapsed' | 'visible';
  eventIds: number[];
  rawEvents: RawEventRef[];
};
```

- [ ] **Step 2: Add helper for result display**

Below `hasFailedResult`, add:

```ts
function toolResultDisplay(name: string, status: ToolBlock['status'], result: string): ToolBlock['resultDisplay'] {
  if (!result.trim()) return 'visible';
  if (['Read', 'Glob', 'Grep'].includes(name)) return 'hidden';
  if (status === 'failed') return 'visible';
  return 'collapsed';
}
```

- [ ] **Step 3: Use helper in `makeToolBlock`**

In the ordinary tool return object, compute status first:

```ts
  const status: ToolBlock['status'] = resultEvent ? (hasFailedResult(resultPayload, result) ? 'failed' : 'completed') : 'running';
```

Then set:

```ts
status,
resultDisplay: toolResultDisplay(name, status, result),
```

- [ ] **Step 4: Use helper in `makeStandaloneToolResult`**

In `makeStandaloneToolResult`, compute status first:

```ts
const status: ToolBlock['status'] = hasFailedResult(payload, result) ? 'failed' : 'completed';
```

Then set:

```ts
status,
resultDisplay: toolResultDisplay(toolName(payload), status, result),
```

- [ ] **Step 5: Update existing test expected objects**

Any `toEqual` expected `ToolBlock` objects in `web/src/conversationBlocks.test.ts` must include `resultDisplay`.

Examples:

```ts
resultDisplay: 'collapsed'
```

for ordinary completed Bash/tool results with output, and:

```ts
resultDisplay: 'visible'
```

for running tools with empty result or failed tools where result should remain visible.

- [ ] **Step 6: Run block tests**

Run:

```bash
npm --prefix web test -- conversationBlocks
```

Expected: PASS.

---

### Task 3: Add rendered DOM tests for hidden and collapsed result output

**Files:**
- Modify: `web/src/ConversationBlockList.test.tsx`
- Test: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Update test fixture types**

Any `ToolBlock` object literals in `web/src/ConversationBlockList.test.tsx` must include `resultDisplay`.

Use:

```ts
resultDisplay: 'collapsed'
```

for completed tool output that should be collapsed, and:

```ts
resultDisplay: 'visible'
```

for running tools with no result.

- [ ] **Step 2: Add Read hidden-result render test**

Add this test after `renders tool activity with compact input and result sections`:

```tsx
  it('hides Read tool result output from the main card while keeping raw details', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-read',
        type: 'tool',
        name: 'Read',
        status: 'completed',
        inputSummary: 'file_path: /tmp/a.txt',
        resultSummary: 'secret file contents',
        resultDisplay: 'hidden',
        eventIds: [10, 11],
        rawEvents: [rawEvent(10, { name: 'Read' }), rawEvent(11, { content: 'secret file contents' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    expect(within(article).getByText('Read')).toBeInTheDocument();
    expect(within(article).getByText('file_path: /tmp/a.txt')).toBeInTheDocument();
    expect(within(article).queryByText('Result')).not.toBeInTheDocument();
    expect(within(article).queryByText('secret file contents')).not.toBeInTheDocument();
    expect(within(article).getByText('Raw events')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Add Bash collapsed-result render test**

Add this test after the Read hidden-result test:

```tsx
  it('collapses Bash tool result output by default', () => {
    const blocks: ConversationBlock[] = [
      {
        id: 'tool-bash',
        type: 'tool',
        name: 'Bash',
        status: 'completed',
        inputSummary: 'command: npm test',
        resultSummary: 'long stdout',
        resultDisplay: 'collapsed',
        eventIds: [12, 13],
        rawEvents: [rawEvent(12, { name: 'Bash' }), rawEvent(13, { content: 'long stdout' })]
      }
    ];

    render(<ConversationBlockList blocks={blocks} />);

    const article = screen.getByRole('article');
    const details = within(article).getByText('Result').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(article).queryByText('long stdout')).not.toBeInTheDocument();
  });
```

- [ ] **Step 4: Run render tests and verify they fail**

Run:

```bash
npm --prefix web test -- ConversationBlockList
```

Expected: FAIL because `ToolBlockView` still renders result output visibly.

---

### Task 4: Implement hidden/collapsed result rendering

**Files:**
- Modify: `web/src/ConversationBlockList.tsx`
- Modify: `web/src/App.css` if details styling needs adjustment
- Test: `web/src/ConversationBlockList.test.tsx`

- [ ] **Step 1: Update `ToolBlockView` result rendering**

In `web/src/ConversationBlockList.tsx`, replace the existing result section:

```tsx
{block.resultSummary.trim() && (
  <section className="block-section">
    <h4>Result</h4>
    <pre>{block.resultSummary}</pre>
  </section>
)}
```

with:

```tsx
{block.resultSummary.trim() && block.resultDisplay === 'visible' && (
  <section className="block-section">
    <h4>Result</h4>
    <pre>{block.resultSummary}</pre>
  </section>
)}
{block.resultSummary.trim() && block.resultDisplay === 'collapsed' && (
  <details className="block-section collapsed-result">
    <summary>Result</summary>
    <pre>{block.resultSummary}</pre>
  </details>
)}
```

Do not render a Result section for `resultDisplay === 'hidden'`.

- [ ] **Step 2: Add CSS for collapsed result summaries**

In `web/src/App.css`, near `.block-section`, add:

```css
.collapsed-result summary {
  cursor: pointer;
  color: #d16643;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}
```

- [ ] **Step 3: Run render tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList
```

Expected: PASS.

---

### Task 5: Final verification and docs review

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Verify frontend

- [ ] **Step 1: Run frontend tests**

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

- [ ] **Step 3: Review docs impact**

Check whether README.md or CLAUDE.md mention detailed tool output rendering. If they do not, leave them unchanged. If they do, update wording to say tool results are compact by default and raw events remain available.

- [ ] **Step 4: Review final diff**

Run:

```bash
git diff -- web/src/conversationBlocks.ts web/src/conversationBlocks.test.ts web/src/ConversationBlockList.tsx web/src/ConversationBlockList.test.tsx web/src/App.css README.md CLAUDE.md
```

Expected: diff is limited to tool-result display metadata, tests, rendering, CSS, and any necessary docs.

---

## Self-Review

- Spec coverage: The plan covers hidden Read/Glob/Grep results, collapsed Bash and ordinary tool results, raw event preservation, task block preservation, tests, build, and docs review.
- Placeholder scan: No placeholders remain; exact snippets and commands are included.
- Type consistency: `resultDisplay` is consistently defined as `'hidden' | 'collapsed' | 'visible'` on `ToolBlock` and consumed in `ToolBlockView`.
