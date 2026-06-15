# Chat-first Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default desktop console-like four-column shell with a Claude-style chat-first shell: sidebar + conversation by default, command palette for advanced destinations, and inspector as an overlay drawer.

**Architecture:** Reuse the existing `CommandPalette` in `web/src/App.tsx` as the B3 command/menu surface, add a sidebar menu trigger, remove the persistent primary rail from `AppShell`, and convert inspector layout from a reserved grid column to a fixed/overlay drawer. Keep existing session state, `view`, archived mode, config view, keyboard shortcuts, and inspector tabs intact.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, CSS grid/fixed overlay styling.

---

## File structure

- Modify `web/src/App.test.tsx` to encode the new UX contract before implementation:
  - default shell has no `Primary navigation` rail,
  - no persistent `CRW`, `Sessions`, `Config`, `Archived`, `Sidebar`, or `Keys` top-level rail buttons,
  - sidebar menu opens command palette,
  - command palette exposes archived/settings/diagnostics/keyboard shortcuts,
  - inspector opens as drawer without changing shell columns.
- Modify `web/src/AppShell.tsx` to remove primary rail markup and narrow props to the chat-first shell responsibilities.
- Modify `web/src/App.tsx` to:
  - wire command palette opening into `SessionSidebar`,
  - add command palette actions for diagnostics and keyboard shortcuts,
  - update focus fallback after sidebar close now that the primary rail is gone,
  - pass the simplified prop set to `AppShell`.
- Modify `web/src/SessionSidebar.tsx` to add a compact menu button in the Claude sidebar header and remove persistent advanced navigation responsibility from the sidebar body.
- Modify `web/src/App.css` to:
  - change `.app-shell` from four columns to sidebar + workspace,
  - delete/neutralize `.primary-rail` layout assumptions,
  - style the sidebar header menu affordance,
  - make `.inspector` a right overlay drawer at desktop widths,
  - preserve single-column mobile behavior.
- Review `README.md` and `CLAUDE.md` after implementation. Only update them if the user-facing behavior or project instructions need documentation changes.

---

### Task 1: Lock the chat-first shell contract in tests

**Files:**
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Replace the existing shell-region test with the failing chat-first contract**

Replace the test starting with:

```tsx
it('renders the Claude-like shell regions with conversation and inspector areas', async () => {
```

with:

```tsx
it('renders a chat-first shell without persistent console navigation', async () => {
  render(<App />);

  const sidebar = await screen.findByRole('complementary', { name: 'Session navigation' });
  expect(sidebar).toBeInTheDocument();
  expect(within(sidebar).getByRole('heading', { name: 'Claude' })).toBeInTheDocument();
  expect(within(sidebar).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
  expect(within(sidebar).getByRole('button', { name: 'Open app menu' })).toBeInTheDocument();
  expect(screen.getByRole('main', { name: 'Conversation workspace' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();

  expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Chats' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Side' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Keys' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add a failing test for sidebar menu access to advanced destinations**

Add this test after `it('opens the command palette with quick actions', async () => { ... })`:

```tsx
it('opens advanced destinations from the sidebar app menu', async () => {
  render(<App />);

  const sidebar = await screen.findByRole('complementary', { name: 'Session navigation' });
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Open app menu' }));

  const palette = await screen.findByRole('dialog', { name: 'Command palette' });
  expect(palette).toHaveTextContent('Show archived chats');
  expect(palette).toHaveTextContent('Open settings');
  expect(palette).toHaveTextContent('Show diagnostics');
  expect(palette).toHaveTextContent('Show keyboard shortcuts');
});
```

- [ ] **Step 3: Update the shortcut/panel test assertions for no rail fallback**

In `it('toggles panels and cycles sessions with app-level shortcuts', async () => { ... })`, replace:

```tsx
fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
expect(screen.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-pressed', 'false');

fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
expect(screen.getByRole('button', { name: 'Hide sidebar' })).toHaveAttribute('aria-pressed', 'true');
```

with:

```tsx
fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
expect(screen.queryByRole('complementary', { name: 'Session navigation' })).not.toBeVisible();

fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
expect(screen.getByRole('complementary', { name: 'Session navigation' })).toBeVisible();
```

- [ ] **Step 4: Update the Escape popover test to use command palette instead of the removed Keys rail button**

In `it('closes app popovers with Escape and focuses composer after creating a session', async () => { ... })`, replace:

```tsx
fireEvent.click(await screen.findByRole('button', { name: 'Keys' }));
expect(screen.getByLabelText('Keyboard shortcuts')).toBeInTheDocument();
fireEvent.keyDown(window, { key: 'Escape' });
expect(screen.queryByLabelText('Keyboard shortcuts')).not.toBeInTheDocument();
```

with:

```tsx
fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
const palette = await screen.findByRole('dialog', { name: 'Command palette' });
fireEvent.click(within(palette).getByRole('button', { name: /Show keyboard shortcuts/ }));
expect(screen.getByLabelText('Keyboard shortcuts')).toBeInTheDocument();
fireEvent.keyDown(window, { key: 'Escape' });
expect(screen.queryByLabelText('Keyboard shortcuts')).not.toBeInTheDocument();
```

- [ ] **Step 5: Update archived-entry tests to use command palette where they were relying on rail navigation**

For each test that currently contains:

```tsx
fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
```

or:

```tsx
fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
```

replace it with:

```tsx
fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
fireEvent.click(await screen.findByRole('button', { name: /Show archived chats/ }));
```

Keep assertions against the sidebar mode buttons named `Active` and `Archived`; those are still allowed because they are local list filters, not persistent primary rail navigation.

- [ ] **Step 6: Add a shell class assertion for drawer layout**

Add this test after `it('toggles the inspector from the visible edge controls on the first click', async () => { ... })`:

```tsx
it('keeps inspector as an overlay drawer instead of a reserved shell column', async () => {
  render(<App />);

  const shell = document.querySelector('.app-shell');
  expect(shell).not.toBeNull();
  expect(shell).toHaveClass('inspector-closed');
  expect(shell).not.toHaveClass('primary-rail-shell');

  fireEvent.click(await screen.findByRole('button', { name: 'Show inspector' }));

  expect(shell).toHaveClass('inspector-open');
  expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();
});
```

- [ ] **Step 7: Run the targeted test file and verify it fails for the expected reasons**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because `Open app menu` does not exist yet, `Primary navigation` still exists, removed-rail assertions fail, and `Show diagnostics` / `Show keyboard shortcuts` palette actions are not wired yet.

---

### Task 2: Remove the persistent primary rail from AppShell

**Files:**
- Modify: `web/src/AppShell.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Simplify `AppShell` props and remove rail JSX**

Replace the contents of `web/src/AppShell.tsx` with:

```tsx
import type { CSSProperties, ReactNode } from 'react';

export type SessionListMode = 'active' | 'archived';
export type AppView = 'sessions' | 'config';

export const runtimeStatusLabels = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting for you',
  ended: 'Ended',
  exited: 'Ended',
  stopped: 'Stopped',
  failed: 'Failed'
};

type Props = {
  view: AppView;
  isInspectorOpen: boolean;
  isSidebarOpen: boolean;
  sidebar: ReactNode;
  workspace: ReactNode;
  inspector: ReactNode;
  inspectorWidth: number;
};

export default function AppShell({
  view,
  isInspectorOpen,
  isSidebarOpen,
  sidebar,
  workspace,
  inspector,
  inspectorWidth
}: Props) {
  const shellStyle = { '--inspector-width': `${inspectorWidth}px` } as CSSProperties;

  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'} ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`} style={shellStyle}>
      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
    </div>
  );
}
```

- [ ] **Step 2: Remove deleted AppShell props from `App.tsx`**

In the `<AppShell ... />` call, delete these props:

```tsx
listMode={sessionState.listMode}
isShortcutHelpOpen={isShortcutHelpOpen}
attentionState={attentionState}
attentionLabel={attentionLabel}
onSetShortcutHelpOpen={setIsShortcutHelpOpen}
onShowActiveSessions={showActiveSessions}
onShowArchivedSessions={showArchivedSessions}
onToggleSidebar={toggleSidebar}
```

Keep these props:

```tsx
view={view}
isInspectorOpen={isInspectorOpen}
inspectorWidth={inspectorWidth}
isSidebarOpen={isSidebarOpen}
sidebar={...}
workspace={...}
inspector={...}
```

- [ ] **Step 3: Update focus fallback after closing the sidebar**

Replace `focusFallbackAfterSidebarClose` in `web/src/App.tsx` with:

```tsx
function focusFallbackAfterSidebarClose() {
  requestAnimationFrame(() => {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement) || !activeElement.closest('.session-sidebar')) return;
    if (isComposerSession) {
      focusComposer(false);
      return;
    }
    document.querySelector<HTMLElement>('.conversation-workspace, .config-workspace')?.focus();
  });
}
```

- [ ] **Step 4: Make workspaces focusable for fallback focus**

In `web/src/ConversationWorkspace.tsx`, add `tabIndex={-1}` to the top-level `<main className=... aria-label="Conversation workspace">` element. The result should look like:

```tsx
<main className={workspaceClassName} aria-label="Conversation workspace" tabIndex={-1}>
```

In `web/src/ConfigView.tsx`, add `tabIndex={-1}` to the top-level config workspace container if it renders the `config-workspace` class. The result should look like:

```tsx
<main className="workspace config-workspace" aria-label="Configuration" tabIndex={-1}>
```

If `ConfigView` does not own the `config-workspace` wrapper, add the `tabIndex={-1}` where `ConversationWorkspace` renders the config workspace.

- [ ] **Step 5: Run the targeted tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: some tests still fail because sidebar menu and new command actions are not implemented yet, but TypeScript/React render errors from `AppShell` prop changes should be gone.

- [ ] **Step 6: Commit**

```bash
git add web/src/AppShell.tsx web/src/App.tsx web/src/ConversationWorkspace.tsx web/src/ConfigView.tsx web/src/App.test.tsx
git commit -m "Remove persistent primary rail"
```

---

### Task 3: Add the sidebar app menu trigger and command actions

**Files:**
- Modify: `web/src/SessionSidebar.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

- [ ] **Step 1: Add the menu callback prop to `SessionSidebar`**

In `web/src/SessionSidebar.tsx`, add this field to `type Props`:

```tsx
onOpenCommandPalette: () => void;
```

Then include it in the destructuring parameter list:

```tsx
onOpenCommandPalette,
```

- [ ] **Step 2: Replace the sidebar header button layout**

Replace the current header block:

```tsx
<div className="sidebar-header">
  <div>
    <h1>Claude</h1>
    <p>Chats and remote work</p>
  </div>
  <button type="button" className="primary-action" title="Start a new chat" onClick={onNewChat}>
    New chat
  </button>
</div>
```

with:

```tsx
<div className="sidebar-header">
  <div className="sidebar-title-row">
    <div>
      <h1>Claude</h1>
      <p>Chats and remote work</p>
    </div>
    <button type="button" className="sidebar-menu-button" aria-label="Open app menu" title="Open app menu (⌘/Ctrl+P)" onClick={onOpenCommandPalette}>
      ⋯
    </button>
  </div>
  <button type="button" className="primary-action sidebar-new-chat" title="Start a new chat" onClick={onNewChat}>
    New chat
  </button>
</div>
```

- [ ] **Step 3: Pass the menu callback from `App.tsx`**

In the `SessionSidebar` JSX inside `web/src/App.tsx`, add:

```tsx
onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
```

- [ ] **Step 4: Add global command actions for diagnostics and keyboard shortcuts**

In `commandPaletteActions` in `web/src/App.tsx`, replace the archived/settings/inspector tail of the array with this exact block:

```tsx
{ id: 'active-sessions', title: 'Show active chats', hint: 'Return to active conversations', kind: 'Command', run: showActiveSessions },
{ id: 'archived-sessions', title: 'Show archived chats', hint: 'Browse archived conversations', kind: 'Command', run: showArchivedSessions },
{ id: 'settings', title: 'Open settings', hint: 'View app and runtime configuration', kind: 'Command', run: () => setView('config') },
{
  id: 'diagnostics',
  title: 'Show diagnostics',
  hint: 'Open runtime and session diagnostics in the inspector drawer',
  kind: 'Command',
  run: () => {
    setView('sessions');
    setIsInspectorOpen(true);
    setInspectorTab('diagnostics');
  }
},
{
  id: 'keyboard-shortcuts',
  title: 'Show keyboard shortcuts',
  hint: 'Review app-level shortcuts',
  kind: 'Command',
  run: () => setIsShortcutHelpOpen(true)
},
{ id: 'toggle-sidebar', title: isSidebarOpen ? 'Hide sidebar' : 'Show sidebar', hint: 'Toggle project and chat navigation', kind: 'Command', shortcut: '⌘B', run: toggleSidebar },
{ id: 'toggle-inspector', title: isInspectorOpen ? 'Hide inspector' : 'Show inspector', hint: 'Toggle activity, tasks, plan, and diagnostics', kind: 'Command', shortcut: '⌘I', run: () => setIsInspectorOpen((open) => !open) }
```

- [ ] **Step 5: Ensure keyboard shortcuts help renders outside the removed rail**

Add this JSX near the existing `{isCommandPaletteOpen && ...}` render at the bottom of `App.tsx`, before the command palette:

```tsx
{isShortcutHelpOpen && (
  <section id="keyboard-shortcuts-help" className="shortcut-help-popover app-shortcut-help-popover" aria-label="Keyboard shortcuts">
    <h2>Keyboard shortcuts</h2>
    <dl>
      <div><dt>⌘/Ctrl P</dt><dd>Open command palette</dd></div>
      <div><dt>⌘/Ctrl N</dt><dd>New chat</dd></div>
      <div><dt>⌘/Ctrl K</dt><dd>Focus composer</dd></div>
      <div><dt>/</dt><dd>Focus composer</dd></div>
      <div><dt>⌘/Ctrl B</dt><dd>Toggle sidebar</dd></div>
      <div><dt>⌘/Ctrl I</dt><dd>Toggle inspector</dd></div>
      <div><dt>⌥ Up/Down</dt><dd>Switch sessions</dd></div>
      <div><dt>Esc</dt><dd>Close popovers</dd></div>
    </dl>
  </section>
)}
```

- [ ] **Step 6: Run targeted tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: shell/menu tests pass or now fail only on CSS-class/drawer assertions. Existing archived/config/diagnostics tests should still pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/SessionSidebar.tsx web/src/App.tsx web/src/App.test.tsx
git commit -m "Move advanced navigation into command menu"
```

---

### Task 4: Convert layout CSS to chat-first shell and inspector drawer

**Files:**
- Modify: `web/src/App.css`

- [ ] **Step 1: Replace the base `.app-shell` grid rules**

Replace the base rules from `.app-shell` through `.app-shell.sidebar-closed.inspector-closed` with:

```css
.app-shell {
  position: relative;
  display: grid;
  grid-template-columns: minmax(260px, 312px) minmax(0, 1fr);
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  color: var(--text);
  background: var(--app-bg);
}

.app-shell.sidebar-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.app-shell.inspector-open,
.app-shell.inspector-closed,
.app-shell.sidebar-closed.inspector-open,
.app-shell.sidebar-closed.inspector-closed {
  grid-template-columns: minmax(260px, 312px) minmax(0, 1fr);
}

.app-shell.sidebar-closed.inspector-open,
.app-shell.sidebar-closed.inspector-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}
```

- [ ] **Step 2: Delete primary rail styling**

Remove the base CSS blocks for:

```css
.primary-rail
.rail-brand
.rail-brand.attention-working
.rail-brand.attention-review
.rail-attention-dot,
.rail-button-dot
.rail-attention-dot
.rail-brand.attention-working .rail-attention-dot
.rail-button-dot
.rail-button-dot.review
.primary-rail button
.primary-rail button.active,
.primary-rail button[aria-pressed='true'],
.primary-rail button:hover
.shortcut-help
```

Keep `.shortcut-help-popover` and its descendants because the keyboard help popover is still used outside the rail.

- [ ] **Step 3: Add fixed positioning for the keyboard shortcuts popover**

Add this near the `.shortcut-help-popover` rule:

```css
.app-shortcut-help-popover {
  position: fixed;
  top: 18px;
  right: 18px;
  z-index: 90;
}
```

- [ ] **Step 4: Style the sidebar menu header**

Add these rules near `.sidebar-header`:

```css
.sidebar-title-row {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.sidebar-menu-button {
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  border-color: transparent;
  border-radius: 999px;
  color: var(--muted);
  background: rgb(255 253 250 / 0.58);
  padding: 0;
  font-size: 18px;
  line-height: 1;
}

.sidebar-menu-button:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.sidebar-new-chat {
  width: 100%;
  justify-content: center;
}
```

- [ ] **Step 5: Replace desktop inspector layout with overlay drawer rules**

Replace the `.inspector` base rule with:

```css
.inspector {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  width: min(var(--inspector-width, 360px), calc(100vw - 80px));
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--panel-bg);
  box-shadow: var(--shadow-popover);
}
```

Replace the closed inspector rule:

```css
.app-shell.inspector-closed .inspector {
  overflow: hidden;
  pointer-events: none;
}
```

with:

```css
.app-shell.inspector-closed .inspector {
  width: 0;
  overflow: hidden;
  border-left: 0;
  background: transparent;
  box-shadow: none;
  pointer-events: none;
}
```

- [ ] **Step 6: Simplify the max-width 1100 media layout**

Inside `@media (max-width: 1100px)`, replace the `.app-shell, .app-shell.inspector-closed` grid rule with:

```css
.app-shell,
.app-shell.inspector-open,
.app-shell.inspector-closed {
  grid-template-columns: minmax(220px, 284px) minmax(0, 1fr);
  grid-template-rows: 1fr;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}

.app-shell.sidebar-closed,
.app-shell.sidebar-closed.inspector-open,
.app-shell.sidebar-closed.inspector-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}
```

Delete any remaining `64px`, `56px`, or `72px` rail-column values in this media block.

- [ ] **Step 7: Simplify the max-width 760 mobile layout**

Inside `@media (max-width: 760px)`, replace rail-related selectors:

```css
.primary-rail,
.session-sidebar,
.workspace,
.inspector {
  grid-column: auto;
}

.primary-rail { ... }
.primary-rail button { ... }
.rail-brand { ... }
```

with:

```css
.session-sidebar,
.workspace,
.inspector {
  grid-column: 1 / -1;
}
```

Ensure the mobile `.app-shell` rule remains one column:

```css
.app-shell,
.app-shell.inspector-open,
.app-shell.inspector-closed,
.app-shell.sidebar-closed,
.app-shell.sidebar-closed.inspector-open,
.app-shell.sidebar-closed.inspector-closed {
  grid-template-columns: minmax(0, 1fr);
}
```

- [ ] **Step 8: Remove duplicate later rail override blocks**

Near the later visual-theme section of `App.css`, delete duplicate override blocks for:

```css
.app-shell
.app-shell.sidebar-closed
.app-shell.inspector-closed
.app-shell.sidebar-closed.inspector-closed
.primary-rail
.rail-brand
.primary-rail button
.primary-rail button.active,
.primary-rail button[aria-pressed='true'],
.primary-rail button:hover
```

Then re-add only the chat-first themed shell overrides:

```css
.app-shell {
  grid-template-columns: minmax(260px, 312px) minmax(0, 1fr);
  background: transparent;
}

.app-shell.sidebar-closed {
  grid-template-columns: 0 minmax(0, 1fr);
}
```

- [ ] **Step 9: Run targeted tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: App tests pass. If a test fails because a CSS selector no longer exists, update the assertion only if the user-visible behavior still matches the spec.

- [ ] **Step 10: Commit**

```bash
git add web/src/App.css web/src/App.test.tsx
git commit -m "Make inspector an overlay drawer"
```

---

### Task 5: Verify full frontend behavior and docs impact

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Modify only if needed: `README.md`, `CLAUDE.md`

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 2: Run the frontend production build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS, including TypeScript compilation and Vite build.

- [ ] **Step 3: Start the app for manual UI verification**

Use the project launch configuration if present. If no preview configuration exists, create `.claude/launch.json` with a single web dev server entry:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "web-dev",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "web", "run", "dev", "--", "--host", "127.0.0.1"],
      "port": 5173
    }
  ]
}
```

Then start it with the preview server named `web-dev`.

Expected: the Vite app loads in browser preview.

- [ ] **Step 4: Manually verify desktop default layout**

In the browser preview at desktop width:

1. Confirm the first visual is left chat sidebar plus current conversation.
2. Confirm no persistent primary rail is visible.
3. Confirm there are no persistent top-level text buttons named `CRW`, `Sessions`, `Config`, `Archive`, `Sidebar`, or `Keys`.
4. Confirm `New chat`, session search, and recent chat list are visible in the sidebar.

Expected: all four checks pass.

- [ ] **Step 5: Manually verify command/menu destinations**

In the browser preview:

1. Click the sidebar `Open app menu` button.
2. Confirm the command palette opens.
3. Select `Show archived chats`; confirm archived list mode opens.
4. Reopen the palette and select `Open settings`; confirm configuration view opens.
5. Reopen the palette and select `Show diagnostics`; confirm the inspector drawer opens on the diagnostics tab.
6. Reopen the palette and select `Show keyboard shortcuts`; confirm keyboard shortcuts help opens and Escape closes it.

Expected: all destinations remain reachable without a persistent rail.

- [ ] **Step 6: Manually verify inspector drawer behavior**

In the browser preview:

1. With inspector closed, confirm the conversation content and composer are centered in the workspace.
2. Click `Show inspector`.
3. Confirm the inspector overlays from the right instead of reserving a permanent shell column.
4. Click `Hide inspector` or press Escape.
5. Confirm the inspector disappears and the conversation remains centered.

Expected: opening/closing inspector does not leave an empty right grid column.

- [ ] **Step 7: Manually verify mobile/narrow behavior**

Resize the preview to mobile width and verify:

1. The layout is single-column.
2. The primary rail is still absent.
3. Sidebar, workspace, command palette, and inspector do not create side-by-side cramped columns.
4. Composer remains usable.

Expected: mobile remains chat-first and usable.

- [ ] **Step 8: Review README and CLAUDE guidance**

Check whether `README.md` describes the old persistent rail or console-style default layout. Check whether `CLAUDE.md` needs a project instruction update.

If neither file mentions the old chrome, make no docs change and note this in the final summary. If README describes the old default UI, update only that sentence or short section.

- [ ] **Step 9: Commit docs if changed**

If README or CLAUDE changed, run:

```bash
git add README.md CLAUDE.md
git commit -m "Document chat-first shell"
```

If neither changed, do not create a commit.

---

### Task 6: Final verification and branch cleanup

**Files:**
- Review: current git status and final diff

- [ ] **Step 1: Run final frontend checks**

Run:

```bash
npm --prefix web test && npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status --short && git diff --stat HEAD~3..HEAD
```

Expected: committed changes include frontend shell tests, AppShell/App/SessionSidebar/CSS updates, and optional docs only. `.superpowers/` remains uncommitted.

- [ ] **Step 3: Confirm no visual companion files are staged**

Run:

```bash
git status --short
```

Expected: `.superpowers/` may be untracked, but it is not staged. Do not commit `.superpowers/`.

- [ ] **Step 4: Final summary**

Report:

- files changed,
- tests/build run and results,
- manual browser checks performed,
- README.md/CLAUDE.md review result,
- note that `.superpowers/` was left uncommitted if still present.

---

## Self-review

- Spec coverage: default two-column shell is covered by Tasks 1, 2, and 4; command/menu advanced destinations by Tasks 1 and 3; inspector drawer by Tasks 1 and 4; responsive behavior by Tasks 4 and 5; accessibility and shortcut preservation by Tasks 1, 2, 3, and existing inspector tab tests; README/CLAUDE review by Task 5.
- Placeholder scan: no placeholder red flags are present. Each code-changing step includes concrete code or exact replacement instructions.
- Type consistency: `onOpenCommandPalette`, `SessionListMode`, `AppView`, `isInspectorOpen`, `isSidebarOpen`, and command action fields match existing TypeScript naming and earlier plan steps.
