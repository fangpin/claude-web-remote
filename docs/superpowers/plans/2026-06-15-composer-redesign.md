# Composer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the session composer so its default state feels like the Claude app input box while preserving slash commands, attachments, prompt history, context details, send, and real stop behavior.

**Architecture:** Keep the existing composer state model and reorganize presentation locally. Pass the existing real session stop handler from `useSessions` through `App.tsx` and `ConversationWorkspace.tsx` into `Composer.tsx`, then make the composer’s single primary action switch between Send and Stop. Update tests around the public app behavior rather than introducing a new component test harness.

**Tech Stack:** React, TypeScript, Vite, Vitest, React Testing Library, CSS in `web/src/App.css`.

---

## File structure

- Modify `web/src/App.tsx`
  - Pass `sessionState.onStop(false)` to `ConversationWorkspace` as `onStopSession`.
- Modify `web/src/ConversationWorkspace.tsx`
  - Add `onStopSession` prop and forward it to `Composer`.
- Modify `web/src/Composer.tsx`
  - Replace separate permission/target/details chips with an information-only Project chip.
  - Remove default-visible History button.
  - Show contextual hints only while focused and empty.
  - Make the primary button render Send or Stop based on `isAwaitingClaude`.
  - Keep existing attachment and autocomplete behavior.
- Modify `web/src/App.css`
  - Rework composer layout, Project chip popover, contextual hints, lighter attachment chips, and subtle Stop primary button.
- Modify `web/src/App.test.tsx`
  - Update composer context expectations.
  - Add coverage for contextual hints and primary Stop behavior.
  - Keep existing send/history/attachment expectations passing.
- Review `README.md` and `CLAUDE.md`
  - Only edit if the implementation changes documented user-facing behavior.

Do not create new files for the composer. Do not commit unless the user explicitly authorizes a commit.

---

### Task 1: Add failing behavior tests for the redesigned composer

**Files:**
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Replace the old compact context test with Project chip expectations**

Find the existing test named:

```ts
it('shows compact composer context with details for full session metadata', async () => {
```

Replace the full test with:

```ts
it('shows a lightweight Project composer context with full session metadata in the popover', async () => {
  render(<App />);

  const context = await screen.findByLabelText('Composer context');
  expect(context).toHaveTextContent('Waiting for you');
  expect(context).toHaveTextContent('Project: one');
  expect(context).not.toHaveTextContent('Permission: acceptEdits');
  expect(context).not.toHaveTextContent('Target: one');
  expect(context).not.toHaveTextContent('Details');

  fireEvent.click(within(context).getByRole('button', { name: /Show project context/ }));
  expect(within(context).getByText('Project')).toBeInTheDocument();
  expect(within(context).getByText('/repo/one')).toBeInTheDocument();
  expect(within(context).getByText('Permission')).toBeInTheDocument();
  expect(within(context).getByText('acceptEdits')).toBeInTheDocument();
  expect(within(context).getByText('Status')).toBeInTheDocument();

  fireEvent.click(sessionButton('Worktree Repo'));

  const worktreeContext = await screen.findByLabelText('Composer context');
  expect(worktreeContext).toHaveTextContent('Project: one');
  expect(worktreeContext).toHaveTextContent('worktree');
  expect(worktreeContext).not.toHaveTextContent('Target: one · worktree');

  fireEvent.click(within(worktreeContext).getByRole('button', { name: /Show project context/ }));
  expect(within(worktreeContext).getByText('Branch')).toBeInTheDocument();
  expect(within(worktreeContext).getByText('pin/abc123')).toBeInTheDocument();
  expect(within(worktreeContext).getByText('Source')).toBeInTheDocument();
  expect(within(worktreeContext).getByText('/repo/one')).toBeInTheDocument();
  expect(within(worktreeContext).getByText('Worktree')).toBeInTheDocument();
  expect(within(worktreeContext).getAllByText('/repo/one/.claude/worktrees/abc123').length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Add a contextual hints test after the Project context test**

Add this test below the Project context test:

```ts
it('only shows composer shortcut hints while focused and empty', async () => {
  render(<App />);

  const messageInput = await screen.findByLabelText('Message');
  expect(screen.queryByLabelText('Composer shortcuts')).not.toBeInTheDocument();

  fireEvent.focus(messageInput);
  expect(screen.getByLabelText('Composer shortcuts')).toHaveTextContent('Enter send');
  expect(screen.getByLabelText('Composer shortcuts')).toHaveTextContent('/ commands');
  expect(screen.getByLabelText('Composer shortcuts')).toHaveTextContent('↑ history');

  fireEvent.change(messageInput, { target: { value: 'hello' } });
  expect(screen.queryByLabelText('Composer shortcuts')).not.toBeInTheDocument();

  fireEvent.change(messageInput, { target: { value: '' } });
  expect(screen.getByLabelText('Composer shortcuts')).toBeInTheDocument();

  fireEvent.blur(messageInput);
  expect(screen.queryByLabelText('Composer shortcuts')).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Replace the old end-session-not-in-composer test with primary Stop behavior**

Find the existing test named:

```ts
it('keeps end session in the sidebar actions instead of the composer', async () => {
```

Replace the full test with:

```ts
it('switches the composer primary action to Stop while Claude is working', async () => {
  render(<App />);

  await screen.findByLabelText('Message');
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();

  await act(async () => {
    emitEvent('s1', {
      id: 501,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'raw',
      payload: { type: 'assistant' }
    });
  });

  const stopButton = await screen.findByRole('button', { name: 'Stop' });
  expect(stopButton).toHaveClass('composer-stop-button');
  fireEvent.click(stopButton);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/stop', expect.objectContaining({ method: 'POST' })));
});
```

- [ ] **Step 4: Run the targeted test and confirm it fails for the expected reasons**

Run:

```bash
npm --prefix web test -- App.test.tsx --runInBand
```

Expected: FAIL because the old composer still renders `Permission:`, `Target:`, default-visible hints, and no composer Stop button.

---

### Task 2: Pass the real stop handler into Composer

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/ConversationWorkspace.tsx`
- Modify: `web/src/Composer.tsx`

- [ ] **Step 1: Add the `onStopSession` prop to `ConversationWorkspace`**

In `web/src/ConversationWorkspace.tsx`, add this prop to `type Props` near `onSend`:

```ts
  onStopSession: () => void;
```

Add it to the destructured function arguments near `onSend`:

```ts
  onSend,
  onStopSession,
  onSetActiveSuggestionIndex,
```

Forward it to `<Composer />` near `onSend={onSend}`:

```tsx
            onSend={onSend}
            onStopSession={onStopSession}
            onSetActiveSuggestionIndex={onSetActiveSuggestionIndex}
```

- [ ] **Step 2: Pass the existing real stop callback from `App.tsx`**

In `web/src/App.tsx`, add this prop to `<ConversationWorkspace />` near `onSend={composerState.onSend}`:

```tsx
          onSend={composerState.onSend}
          onStopSession={() => {
            void sessionState.onStop(false);
          }}
          onSetActiveSuggestionIndex={composerState.setActiveSuggestionIndex}
```

This uses the existing `useSessions.onStop(false)` implementation, which calls `stopSession(sessionId)` and updates the selected session to stopped.

- [ ] **Step 3: Add the prop to `Composer.tsx`**

In `web/src/Composer.tsx`, add this to `type Props` near `onSend`:

```ts
  onStopSession: () => void;
```

Add it to the component destructuring near `onSend`:

```ts
  onSend,
  onStopSession,
  onSetActiveSuggestionIndex,
```

- [ ] **Step 4: Run TypeScript build and confirm the new prop is wired**

Run:

```bash
npm --prefix web run build
```

Expected before Task 3 is complete: build may still fail if `onStopSession` is unused under strict lint/build rules, or tests still fail. It should not fail with a missing prop type once all three files are changed.

---

### Task 3: Redesign Composer markup and local UI state

**Files:**
- Modify: `web/src/Composer.tsx`

- [ ] **Step 1: Import `useId` and add local focus/context state**

Change the import from:

```ts
import { useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
```

to:

```ts
import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
```

Inside `Composer`, after existing `useState` declarations, add:

```ts
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [isMessageFocused, setIsMessageFocused] = useState(false);
  const projectContextId = useId();
```

- [ ] **Step 2: Replace target-label helpers with Project helpers**

Replace `composerTargetLabel` and `composerTargetTitle` with:

```ts
function composerProjectLabel(session: SessionInfo): string {
  return `Project: ${basename(session.worktree?.sourceCwd ?? session.cwd)}`;
}

function composerProjectTitle(session: SessionInfo): string {
  const path = session.worktree?.sourceCwd ?? session.cwd;
  return session.worktree ? `${path} (worktree)` : path;
}
```

Replace `composerContextDetails` with:

```ts
function composerContextDetails(session: SessionInfo, statusLabel: string): ComposerContextDetail[] {
  return [
    { label: 'Project', value: session.worktree?.sourceCwd ?? session.cwd },
    ...(session.worktree
      ? [
          { label: 'Worktree', value: session.worktree.worktreeCwd },
          { label: 'Branch', value: session.worktree.branch }
        ]
      : [{ label: 'Workspace', value: session.cwd }]),
    { label: 'Permission', value: session.permissionMode },
    { label: 'Status', value: statusLabel }
  ];
}
```

- [ ] **Step 3: Update derived values**

Replace:

```ts
  const contextDetails = composerContextDetails(activeSession);
```

with:

```ts
  const contextDetails = composerContextDetails(activeSession, statusLabel);
  const showHints = isMessageFocused && message.trim().length === 0;
  const primaryActionIsStop = isAwaitingClaude && !isSending;
```

- [ ] **Step 4: Replace the top context markup**

Replace the current `<div className="composer-context" ...>` block with:

```tsx
      <div className="composer-context" aria-label="Composer context">
        <span className="composer-status-pill">
          <span aria-hidden="true" className="composer-status-dot" />
          {statusLabel}
        </span>
      </div>
```

- [ ] **Step 5: Add textarea focus and blur handling**

On the message `<textarea>`, add `onFocus` and `onBlur` handlers below `onSelect`:

```tsx
          onFocus={() => setIsMessageFocused(true)}
          onBlur={() => setIsMessageFocused(false)}
```

Keep the existing `onChange`, `onSelect`, and `onKeyDown` handlers unchanged.

- [ ] **Step 6: Make hints contextual**

Replace the always-rendered hints block with:

```tsx
      {showHints && (
        <div className="composer-hints" aria-label="Composer shortcuts">
          <span>Enter send</span>
          <span>Shift Enter newline</span>
          <span>/ commands</span>
          <span>↑ history</span>
        </div>
      )}
```

- [ ] **Step 7: Remove the visible History button from default actions**

Delete the `<div className="composer-history-menu"> ... </div>` block from `.composer-actions`.

Keep the `historyMenuOpen` state and `onUsePrompt` prop only if TypeScript still needs them for future secondary affordance. If TypeScript reports unused variables after deleting the block, remove:

```ts
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
```

and remove `promptHistory` and `onUsePrompt` from destructuring only after also deleting them from `Props` and all callers. Prefer the smaller change: remove unused local state and leave `promptHistory`/`onUsePrompt` props only if they remain used elsewhere in the file. If they are unused in `Composer.tsx`, remove them from `Props`, destructuring, and caller prop lists in `ConversationWorkspace.tsx`.

- [ ] **Step 8: Add the Project chip in the bottom action rail**

Inside `.composer-actions > div`, after the attachment menu and before the primary button, add:

```tsx
          <div className="composer-project-menu">
            <button
              className="composer-project-button"
              type="button"
              disabled={!isComposerSession}
              aria-expanded={contextMenuOpen}
              aria-controls={contextMenuOpen ? projectContextId : undefined}
              aria-label="Show project context"
              title={composerProjectTitle(activeSession)}
              onClick={() => setContextMenuOpen((open) => !open)}
            >
              <span>{composerProjectLabel(activeSession)}</span>
              {activeSession.worktree && <small>worktree</small>}
            </button>
            {contextMenuOpen && (
              <dl id={projectContextId} className="composer-project-popover">
                {contextDetails.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd title={item.value}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
```

- [ ] **Step 9: Make the primary button switch between Send and Stop**

Replace the existing `<button className="send-button" ...>` block with:

```tsx
          <button
            className={primaryActionIsStop ? 'send-button composer-stop-button' : 'send-button'}
            type={primaryActionIsStop ? 'button' : 'submit'}
            disabled={primaryActionIsStop ? !isComposerSession : !canSend}
            aria-label={primaryActionIsStop ? 'Stop' : isSending ? 'Sending message' : 'Send'}
            aria-describedby="composer-send-status"
            title={primaryActionIsStop ? 'Stop Claude' : isSending ? 'Sending message' : isAwaitingClaude ? 'Claude is working' : 'Send message'}
            onClick={primaryActionIsStop ? onStopSession : undefined}
          >
            <span className="sr-only">{primaryActionIsStop ? 'Stop' : isSending ? 'Sending message' : 'Send'}</span>
            {primaryActionIsStop ? (
              <span aria-hidden="true" className="composer-stop-icon" />
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
                <path d="M8 2.25 13.25 7.5l-.9.9L8.63 4.68V14H7.37V4.68L3.65 8.4l-.9-.9L8 2.25Z" />
              </svg>
            )}
          </button>
```

- [ ] **Step 10: Run targeted tests and confirm markup failures now moved to styling/text only**

Run:

```bash
npm --prefix web test -- App.test.tsx --runInBand
```

Expected: the new composer behavior tests should pass or be close. Remaining failures should be due to removed History button assumptions or text queries elsewhere, not missing stop wiring.

---

### Task 4: Update composer CSS for the lighter layout

**Files:**
- Modify: `web/src/App.css`

- [ ] **Step 1: Tighten the composer surface**

Replace the `.composer` rule with:

```css
.composer {
  display: grid;
  gap: 8px;
  width: min(calc(100% - 48px), 980px);
  margin: 0 auto 18px;
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  background: var(--surface);
  padding: 10px 12px 11px;
  box-shadow: var(--shadow-soft);
}
```

Keep the existing `.composer:focus-within` rule.

- [ ] **Step 2: Simplify context row styling**

Replace `.composer-context` with:

```css
.composer-context {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 22px;
}
```

Keep `.composer-status-pill` and `.composer-status-dot`, but make the pill quieter by replacing `.composer-status-pill` with:

```css
.composer-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--muted);
  background: transparent;
  padding: 1px 2px;
  font-size: 11px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 3: Remove or leave unused old context menu CSS safely**

Search within `web/src/App.css` for these selectors:

```css
.composer-context-menu
.composer-context-menu summary
.composer-context-menu dl
.composer-context-menu dt
.composer-context-menu dd
```

Delete those composer-specific old context menu rules. Do not delete `.session-context-popover` or `.worktree-path-popover` rules, which are used in the header/worktree panels.

- [ ] **Step 4: Add Project chip styles near composer action styles**

Add after `.composer-attachment-menu`:

```css
.composer-project-menu {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
}

.composer-project-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: min(260px, 36vw);
  min-height: 34px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 0 11px;
  font-size: 12px;
}

.composer-project-button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-project-button small {
  flex: 0 0 auto;
  color: var(--muted-soft);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.composer-project-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 10px);
  z-index: 12;
  display: grid;
  gap: 8px;
  width: min(420px, calc(100vw - 32px));
  margin: 0;
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  background: var(--surface);
  padding: 12px;
  box-shadow: var(--shadow-popover);
}

.composer-project-popover > div {
  display: grid;
  grid-template-columns: 90px minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
}

.composer-project-popover dt {
  color: var(--muted);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.composer-project-popover dd {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Make hints less prominent**

Replace `.composer-hints` and `.composer-hints span` with:

```css
.composer-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
  color: var(--muted-soft);
  font-size: 11px;
}

.composer-hints span {
  border: 0;
  border-radius: 999px;
  background: transparent;
  padding: 0;
}

.composer-hints span + span::before {
  content: '·';
  margin-right: 5px;
  color: var(--muted-soft);
}
```

- [ ] **Step 6: Adjust action rail and button spacing**

Keep `.composer-actions`, but replace `.composer-actions > div` with:

```css
.composer-actions > div {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
}
```

Replace `.composer-attachment-menu, .composer-history-menu` with:

```css
.composer-attachment-menu {
  position: relative;
  flex: 0 0 auto;
}
```

Replace `.composer-attach-button, .composer-history-button` with:

```css
.composer-attach-button {
  display: grid;
  place-items: center;
  width: 34px;
  min-width: 34px;
  height: 34px;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-2);
  padding: 0;
}
```

Delete the now-unused `.composer-history-button` and `.prompt-history-popover` CSS rules if Task 3 removed the History menu markup.

- [ ] **Step 7: Add the Stop icon style**

Replace the existing `.composer-stop-button` rules with:

```css
.composer-stop-button,
.composer-stop-button:hover {
  border-color: #e2b8ae;
  color: var(--danger);
  background: #fff8f6;
  box-shadow: none;
}

.composer-stop-icon {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: currentColor;
}
```

- [ ] **Step 8: Run targeted test**

Run:

```bash
npm --prefix web test -- App.test.tsx --runInBand
```

Expected: PASS for the updated composer tests. If unrelated App tests fail because they query removed composer history UI, update those expectations to use keyboard history recall instead of a visible History button.

---

### Task 5: Preserve history, autocomplete, and attachment behavior with regression tests

**Files:**
- Modify: `web/src/App.test.tsx` only if existing tests do not already cover the behavior

- [ ] **Step 1: Check for existing coverage**

Search:

```bash
grep -n "history\|ArrowUp\|Add path\|pasted text\|autocomplete\|Command palette" web/src/App.test.tsx
```

Expected: existing tests should cover at least send, autocomplete, and context attachment behavior. If they do not cover keyboard prompt history after removing the visible History button, add Step 2.

- [ ] **Step 2: Add keyboard history regression coverage if missing**

Add this test near other composer tests only if no equivalent exists:

```ts
it('recalls prompt history from the keyboard without a visible history button', async () => {
  render(<App />);

  const messageInput = await screen.findByLabelText('Message');
  fireEvent.change(messageInput, { target: { value: 'first prompt' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
  await waitFor(() => expect(messageInput).toHaveValue(''));

  fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
  expect(messageInput).toHaveValue(expect.stringContaining('first prompt'));
  expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument();
});
```

If this test is flaky because send completion is asynchronous in the current harness, replace it with a focused existing history test update rather than adding a duplicate.

- [ ] **Step 3: Run frontend unit tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

---

### Task 6: Browser verification of the real UI

**Files:**
- Create or modify only `.claude/launch.json` if the preview server needs a launch configuration.
- No app source changes unless verification reveals a bug.

- [ ] **Step 1: Ensure dependencies exist**

Run if `web/node_modules` is missing:

```bash
npm --prefix web install
```

Expected: dependencies are installed successfully. Skip this if `web/node_modules` already exists.

- [ ] **Step 2: Start the app through the preview tool**

If `.claude/launch.json` does not already have a usable web config, create or update it with a Vite dev server entry for the web app:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "web", "run", "dev", "--", "--host", "127.0.0.1"],
      "port": 5173
    }
  ]
}
```

Then start it with the preview tool using server name `web`.

Expected: the app loads in the browser preview without console errors.

- [ ] **Step 3: Verify default composer state visually and structurally**

In the browser:

1. Open an active session.
2. Confirm the composer default state shows a small status pill, textarea, `+`, `Project: <repo>`, and Send.
3. Confirm it does not show `Permission:`, `Target:`, `Details`, or a visible `History` button.
4. Inspect the composer height and ensure it is visibly lower than the old multi-chip/multi-hint layout.

Expected: the composer reads as a message input first.

- [ ] **Step 4: Verify interactions**

In the browser:

1. Focus the empty composer and confirm hints appear.
2. Type text and confirm hints hide.
3. Type `/` and confirm autocomplete appears and can complete a command.
4. Use `+` to add a repo path and remove it.
5. Use `+` to paste text, preview it, and remove it.
6. Send a message and confirm the pending/working UI updates.
7. While Claude is working, confirm the primary button is Stop and calls the real stop behavior.
8. Use `ArrowUp` to recall prompt history after a sent prompt.

Expected: all preserved capabilities still work.

- [ ] **Step 5: Check browser console and network**

Use preview console/network tools.

Expected: no new console errors; Stop uses `POST /api/sessions/{id}/stop`; Send uses `POST /api/sessions/{id}/input`.

---

### Task 7: Final checks and docs review

**Files:**
- Modify: `README.md` only if behavior documentation must change.
- Modify: `CLAUDE.md` only if project instructions or documented capabilities must change.

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

- [ ] **Step 3: Review docs for required updates**

Read `README.md` and `CLAUDE.md` sections that mention composer/input/session controls.

Expected: likely no changes needed because this is a UI redesign preserving existing capabilities. If the implementation adds a new user-visible stop behavior in the composer that docs already describe only in sidebar terms, update the docs with a short factual sentence.

- [ ] **Step 4: Check git diff**

Run:

```bash
git status --short
git diff -- web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/Composer.tsx web/src/App.css web/src/App.test.tsx docs/superpowers/specs/2026-06-15-composer-design.md docs/superpowers/plans/2026-06-15-composer-redesign.md README.md CLAUDE.md
```

Expected: diff only includes the composer redesign, approved spec/plan docs, and any necessary docs update.

- [ ] **Step 5: Report verification evidence**

Final response should include:

- Files changed.
- Frontend test result.
- Frontend build result.
- Browser manual verification result.
- Whether `README.md` or `CLAUDE.md` needed changes.
- No claim of completion unless all verification above passed.

---

## Self-review

- Spec coverage: layout, Project chip, stop/send behavior, history, hints, attachment menu, autocomplete, state boundaries, accessibility, manual verification, frontend checks, and docs review are all covered by tasks.
- Placeholder scan: no `TBD`, `TODO`, or unspecified future implementation steps remain. The only conditional step is explicitly bounded: add history regression coverage only if existing tests lack it.
- Type consistency: `onStopSession` is named consistently across `App.tsx`, `ConversationWorkspace.tsx`, and `Composer.tsx`; Project chip helpers and CSS selectors use `composer-project-*` consistently.
- Scope check: plan is focused on the composer redesign and does not add unimplemented menu actions or unrelated refactors.
