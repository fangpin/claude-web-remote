# Claude App Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the frontend's visible shell so Claude Remote Web feels like the native Claude app: left chat history, centered conversation, far-right contextual inspector, no persistent rail, and a coherent warm visual system.

**Architecture:** Keep `App.tsx` as the state and API orchestration root while changing where existing state is rendered. Replace the four-column rail/sidebar/workspace/inspector shell with a strict Claude app layout, move selected-session actions into sidebar row overflow menus, simplify the conversation header, and restyle the visible frontend through shared CSS tokens in `web/src/App.css`.

**Tech Stack:** React, TypeScript, Vite, Vitest, Playwright visual tests, CSS custom properties.

---

## File structure and responsibilities

- Modify `web/src/AppShell.tsx`: remove the persistent primary rail; render only sidebar, workspace, inspector, and keyboard shortcut popover/menu affordances in the Claude app shell layout.
- Modify `web/src/App.tsx`: stop passing selected-session action UI into a sidebar management block; pass session action data into `SessionSidebar`; keep command palette and keyboard shortcuts wired to existing state.
- Modify `web/src/useSessions.ts`: add explicit by-session-id action methods so row overflow actions operate on the row's session, not accidentally on the active session.
- Modify `web/src/SessionSidebar.tsx`: add a row-level overflow menu for session actions, rename/copy/worktree diff affordances where needed, pin and group controls, and remove the separate selected-session action section.
- Modify `web/src/ConversationWorkspace.tsx`: remove session-management actions from the conversation header; keep only minimal title/status/sidebar/activity affordances and render blocking chat state calmly.
- Modify `web/src/App.css`: introduce Claude shell tokens and restyle shell, sidebar, workspace, composer, transcript blocks, inspector, empty/loading/error states, and responsive rules.
- Modify `web/e2e/visual.spec.ts`: update layout assertions for no rail and add checks for session row overflow actions and far-right inspector behavior.
- Review `README.md` and `CLAUDE.md`: update only if the visual redesign changes documented user-facing behavior or project instructions.

---

### Task 1: Remove the persistent rail from the app shell

**Files:**
- Modify: `web/src/AppShell.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Update the visual test to assert that there is no primary rail**

Replace the rail lookup and assertion in `web/e2e/visual.spec.ts` inside `test('Claude-like UI stays readable across key viewports', ...)`:

```ts
  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const inspector = page.getByRole('complementary', { name: 'Session inspector' });
  const composer = page.getByRole('form', { name: 'Message composer' });
  const events = page.locator('.events');

  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  await boxFor(sidebar, 'session sidebar');
  await boxFor(workspace, 'conversation workspace');
```

Expected outcome: the test fails because `AppShell` still renders `<nav className="primary-rail" aria-label="Primary navigation">`.

- [ ] **Step 2: Run the focused visual test and verify it fails**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "Claude-like UI stays readable across key viewports"
```

Expected: FAIL with an assertion that primary navigation count is `1`, not `0`.

- [ ] **Step 3: Remove rail props from `AppShell`**

In `web/src/AppShell.tsx`, replace the `Props` type with:

```ts
type Props = {
  view: AppView;
  isInspectorOpen: boolean;
  isShortcutHelpOpen: boolean;
  isSidebarOpen: boolean;
  sidebar: ReactNode;
  workspace: ReactNode;
  inspector: ReactNode;
  inspectorWidth: number;
  onSetShortcutHelpOpen: (isOpen: boolean) => void;
};
```

Replace the function signature with:

```ts
export default function AppShell({
  view,
  isInspectorOpen,
  isShortcutHelpOpen,
  isSidebarOpen,
  sidebar,
  workspace,
  inspector,
  inspectorWidth,
  onSetShortcutHelpOpen
}: Props) {
```

- [ ] **Step 4: Remove the rail markup from `AppShell`**

In `web/src/AppShell.tsx`, replace the `return` body with:

```tsx
  return (
    <div className={`app-shell view-${view} ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'} ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`} style={shellStyle}>
      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
      {isShortcutHelpOpen && (
        <section id="keyboard-shortcuts-help" className="shortcut-help-popover" aria-label="Keyboard shortcuts">
          <h2>Keyboard shortcuts</h2>
          <dl>
            <div><dt>⌘/Ctrl P</dt><dd>Open command palette</dd></div>
            <div><dt>⌘/Ctrl N</dt><dd>New chat</dd></div>
            <div><dt>⌘/Ctrl K</dt><dd>Focus composer</dd></div>
            <div><dt>/</dt><dd>Focus composer</dd></div>
            <div><dt>⌘/Ctrl B</dt><dd>Toggle sidebar</dd></div>
            <div><dt>⌘/Ctrl I</dt><dd>Toggle Activity</dd></div>
            <div><dt>⌥ Up/Down</dt><dd>Switch sessions</dd></div>
            <div><dt>Esc</dt><dd>Close popovers</dd></div>
          </dl>
          <button type="button" onClick={() => onSetShortcutHelpOpen(false)}>Close</button>
        </section>
      )}
    </div>
  );
```

- [ ] **Step 5: Remove obsolete `AppShell` props at the call site**

In `web/src/App.tsx`, update the `<AppShell ...>` call to remove these props:

```tsx
listMode={sessionState.listMode}
attentionState={attentionState}
attentionLabel={attentionLabel}
onShowActiveSessions={showActiveSessions}
onShowArchivedSessions={showArchivedSessions}
onToggleSidebar={toggleSidebar}
```

Keep these props:

```tsx
view={view}
isInspectorOpen={isInspectorOpen}
isShortcutHelpOpen={isShortcutHelpOpen}
isSidebarOpen={isSidebarOpen}
sidebar={sidebar}
workspace={workspace}
inspector={inspector}
inspectorWidth={inspectorWidth}
onSetShortcutHelpOpen={setIsShortcutHelpOpen}
```

- [ ] **Step 6: Update focus fallback after sidebar close**

In `web/src/App.tsx`, replace the final fallback in `focusFallbackAfterSidebarClose()`:

```ts
document.querySelector<HTMLButtonElement>('.primary-rail button')?.focus();
```

with:

```ts
document.querySelector<HTMLElement>('.workspace')?.focus();
```

- [ ] **Step 7: Run TypeScript/build feedback for the changed shell**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. If TypeScript reports unused `runtimeStatusLabels`, `attentionState`, or `attentionLabel`, remove those exports/variables only if no other imports use them.

- [ ] **Step 8: Commit**

Run:

```bash
git add web/src/AppShell.tsx web/src/App.tsx web/e2e/visual.spec.ts
git commit -m "Remove persistent app rail"
```

---

### Task 2: Convert selected-session actions into session row overflow menus

**Files:**
- Modify: `web/src/useSessions.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/SessionSidebar.tsx`
- Modify: `web/src/ConversationWorkspace.tsx`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Add visual test coverage for row overflow actions**

Add this test after the viewport readability test in `web/e2e/visual.spec.ts`:

```ts
test('session actions live in the session row overflow menu', async ({ page }) => {
  const row = page.locator('.session-row', { hasText: 'Visual Regression Session' }).first();
  await expect(page.getByRole('main', { name: 'Conversation workspace' }).getByRole('button', { name: 'More session actions' })).toHaveCount(0);
  await row.getByRole('button', { name: 'More session actions' }).click();
  await expect(row.getByRole('menu', { name: 'Session actions' })).toBeVisible();
  await expect(row.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(row.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
});
```

Expected outcome: FAIL because row overflow menus do not exist and the conversation header still owns the more-actions menu.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "session actions live"
```

Expected: FAIL with no row button named `More session actions`.

- [ ] **Step 3: Add by-session-id action methods to `useSessions.ts`**

In `web/src/useSessions.ts`, add these functions after `onRename`:

```ts
  async function onStopSession(sessionId: string, removeWorktree = false) {
    setError(null);
    try {
      if (removeWorktree) {
        await stopAndRemoveWorktree(sessionId);
      } else {
        await stopSession(sessionId);
      }
      setSessions((current) => current.map((session) => {
        if (session.id !== sessionId) return session;
        if (removeWorktree && session.worktree) {
          if (session.id === activeId) {
            setActiveWorktreeStatus(null);
            setActiveWorktreeStatusError(null);
          }
          return { ...session, cwd: session.worktree.sourceCwd, status: 'stopped', runtimeStatus: 'stopped', worktree: null };
        }
        return { ...session, status: 'stopped', runtimeStatus: 'stopped' };
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
      if (sessionId === activeId && !removeWorktree) void refreshActiveWorktreeStatus();
    }
  }

  async function onRestartSession(sessionId: string) {
    setError(null);
    try {
      const restarted = await restartSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? restarted : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
    }
  }

  async function onResumeSession(sessionId: string) {
    setError(null);
    try {
      const resumed = await resumeSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? resumed : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
    }
  }

  async function onArchiveSession(sessionId: string) {
    if (!confirm('Archive this session? It will be hidden from active sessions while keeping local data.')) return;
    setError(null);
    try {
      await archiveSession(sessionId);
      removeSessionFromCurrentList(sessionId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onUnarchiveSession(sessionId: string) {
    setError(null);
    try {
      await unarchiveSession(sessionId);
      removeSessionFromCurrentList(sessionId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDeleteSession(sessionId: string) {
    if (!confirm('Delete this archived session and its local event logs? This cannot be undone.')) return;
    setError(null);
    try {
      await deleteSession(sessionId);
      removeSessionFromCurrentList(sessionId);
      callbacksRef.current.onDeleteSessionEvents?.(sessionId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
```

Then add these methods to the returned object near the existing active-session methods:

```ts
    onArchiveSession,
    onDeleteSession,
    onRestartSession,
    onResumeSession,
    onStopSession,
    onUnarchiveSession,
```

- [ ] **Step 4: Define row action types in `SessionSidebar.tsx`**

In `web/src/SessionSidebar.tsx`, add these types below the existing `Props` type:

```ts
export type SessionRowAction = {
  id: string;
  label: string;
  title?: string;
  disabled?: boolean;
  variant?: 'primary' | 'danger';
  onClick: () => void;
};

export type SessionRowActionProvider = (session: SessionInfo) => SessionRowAction[];
```

Change `Props` by replacing:

```ts
  sessionActions: ReactNode;
```

with:

```ts
  getSessionActions: SessionRowActionProvider;
```

- [ ] **Step 5: Add overflow menu props to `SessionListItemProps`**

In `web/src/SessionSidebar.tsx`, add these fields to `SessionListItemProps`:

```ts
  getSessionActions: SessionRowActionProvider;
  onCopySessionId: (sessionId: string) => void;
  onRenameSession: (session: SessionInfo) => void;
```

- [ ] **Step 6: Implement `SessionActionMenu` in `SessionSidebar.tsx`**

Add this component above `SessionListItem`:

```tsx
function SessionActionMenu({
  session,
  actions,
  isPinned,
  onCopySessionId,
  onRenameSession,
  onTogglePinned
}: {
  session: SessionInfo;
  actions: SessionRowAction[];
  isPinned: boolean;
  onCopySessionId: (sessionId: string) => void;
  onRenameSession: (session: SessionInfo) => void;
  onTogglePinned: (sessionId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const sessionTitle = session.name || pathBasename(projectPathForSession(session));

  function choose(action: () => void) {
    setIsOpen(false);
    action();
  }

  return (
    <div className="session-action-menu">
      <button
        type="button"
        className="session-action-menu-button"
        aria-label="More session actions"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title={`More actions for ${sessionTitle}`}
        onClick={() => setIsOpen((open) => !open)}
      >
        ⋯
      </button>
      {isOpen && (
        <div className="session-action-menu-popover" role="menu" aria-label="Session actions">
          <button type="button" role="menuitem" onClick={() => choose(() => onRenameSession(session))}>Rename</button>
          <button type="button" role="menuitem" onClick={() => choose(() => onCopySessionId(session.id))}>Copy session ID</button>
          <button type="button" role="menuitem" onClick={() => choose(() => onTogglePinned(session.id))}>{isPinned ? 'Unpin' : 'Pin'}</button>
          {actions.map((action) => (
            <button
              key={`${session.id}:${action.id}`}
              type="button"
              role="menuitem"
              className={action.variant === 'primary' ? 'primary-action' : action.variant === 'danger' ? 'danger' : undefined}
              disabled={action.disabled}
              title={action.title}
              onClick={() => choose(action.onClick)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Render the overflow menu from each session row**

In `SessionListItem`, compute actions:

```ts
  const rowActions = getSessionActions(session);
```

Then replace the existing standalone pin button with:

```tsx
      <SessionActionMenu
        session={session}
        actions={rowActions}
        isPinned={isPinned}
        onCopySessionId={onCopySessionId}
        onRenameSession={onRenameSession}
        onTogglePinned={onTogglePinned}
      />
```

Keep the `select.session-move-select` for now so group move remains directly accessible during this task.

- [ ] **Step 8: Pass action menu props through `SessionSidebar`**

In the `SessionSidebar` function props destructuring, replace `sessionActions` with:

```ts
  getSessionActions,
```

Add these handlers before `return`:

```ts
  async function copySessionId(sessionId: string) {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(sessionId);
  }

  function renameSessionFromRow(session: SessionInfo) {
    const name = window.prompt('Rename chat', session.name || pathBasename(projectPathForSession(session)));
    if (name === null) return;
    onRenameSession(session.id, name.trim() || null);
  }
```

Add `onRenameSession` to `Props`:

```ts
  onRenameSession: (sessionId: string, name: string | null) => void;
```

and include it in the `SessionSidebar` prop destructuring.

Then remove the selected-session management block:

```tsx
      {sessionActions && (
        <section className="session-management-actions" aria-label="Selected session actions">
          <span className="state-kicker">Selected chat</span>
          {sessionActions}
        </section>
      )}
```

When rendering `SessionListItem`, pass:

```tsx
getSessionActions={getSessionActions}
onCopySessionId={copySessionId}
onRenameSession={renameSessionFromRow}
```

- [ ] **Step 9: Move rename behavior out of `ConversationWorkspace` header**

In `web/src/ConversationWorkspace.tsx`, stop passing session action UI through the header by removing this block from `.conversation-header-actions`:

```tsx
              {headerPrimaryAction && <HeaderActionButton action={headerPrimaryAction} />}
              <button type="button" onClick={onOpenActivity}>Activity</button>
              <SessionMoreMenu
                session={activeSession}
                actions={headerMenuActions}
                onRename={() => startRename(activeSession)}
                onCopySessionId={() => copySessionId(activeSession.id)}
                onOpenWorktreeDiff={activeSession.worktree ? () => openHeaderWorktreeDiff(activeSession.id) : null}
                copyStatus={copyStatus}
              />
```

Replace it with:

```tsx
              <button type="button" onClick={onOpenActivity}>Activity</button>
```

This keeps the right inspector discoverable while removing session management from the conversation header.

- [ ] **Step 10: Expose row action providers from `App.tsx`**

In `web/src/App.tsx`, import the row action type:

```ts
import SessionSidebar, { type SessionRowAction } from './SessionSidebar';
```

Create this helper near `buildHeaderActions()`:

```ts
  function getSessionActions(session: SessionInfo): SessionRowAction[] {
    if (session.deletedAt || sessionState.listMode === 'archived') {
      return [
        { id: 'unarchive', label: 'Unarchive', title: 'Restore this archived chat', onClick: () => void sessionState.onUnarchiveSession(session.id) },
        { id: 'delete', label: 'Delete', variant: 'danger', title: 'Delete archived metadata and event log', onClick: () => void sessionState.onDeleteSession(session.id) }
      ];
    }

    if (session.status === 'running' || session.status === 'starting' || session.runtimeStatus === 'running' || session.runtimeStatus === 'starting') {
      return [
        { id: 'stop', label: session.worktree ? 'Stop only' : 'End session', onClick: () => void sessionState.onStopSession(session.id, false) },
        ...(session.status === 'running' || session.runtimeStatus === 'running'
          ? [{ id: 'restart', label: 'Restart', title: 'Resume with the persisted Claude session id when available', onClick: () => void sessionState.onRestartSession(session.id) } satisfies SessionRowAction]
          : []),
        { id: 'archive', label: 'Archive', variant: 'danger', title: 'Stop if needed and archive this chat', onClick: () => void sessionState.onArchiveSession(session.id) }
      ];
    }

    return [
      { id: 'continue', label: getContinueActionLabel(session), variant: 'primary', title: 'Resume with the persisted Claude session id when available', onClick: () => void sessionState.onResumeSession(session.id) },
      { id: 'archive', label: 'Archive', variant: 'danger', title: 'Archive this chat', onClick: () => void sessionState.onArchiveSession(session.id) }
    ];
  }
```

This helper must use by-id methods from `useSessions`, not `onStop`, `onRestart`, `onArchive`, `onUnarchive`, or `onDelete`, because those existing methods operate on the active session.

- [ ] **Step 11: Wire `SessionSidebar` to the row action provider**

In `web/src/App.tsx`, update the `SessionSidebar` JSX to remove:

```tsx
sessionActions={renderActions()}
```

and add:

```tsx
getSessionActions={getSessionActions}
onRenameSession={sessionState.onRename}
```

- [ ] **Step 12: Run TypeScript/build feedback**

Run:

```bash
npm --prefix web run build
```

Expected: PASS. If TypeScript reports unused `ReactNode` in `SessionSidebar.tsx`, remove it from the import. If it reports unused `HeaderActionButton`, `SessionMoreMenu`, `copyStatus`, or header diff helpers in `ConversationWorkspace.tsx`, delete those definitions only after confirming nothing else references them in the file.

- [ ] **Step 13: Run the row-action test**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "session actions live"
```

Expected: PASS.

- [ ] **Step 14: Commit**

Run:

```bash
git add web/src/useSessions.ts web/src/App.tsx web/src/SessionSidebar.tsx web/src/ConversationWorkspace.tsx web/e2e/visual.spec.ts
git commit -m "Move session actions into sidebar rows"
```

---

### Task 3: Introduce Claude shell CSS tokens and restyle the app shell

**Files:**
- Modify: `web/src/App.css`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Add token assertions to the visual test**

Add this test after `test.beforeEach` in `web/e2e/visual.spec.ts`:

```ts
test('Claude shell tokens are applied to the document', async ({ page }) => {
  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      canvas: styles.getPropertyValue('--claude-canvas').trim(),
      surface: styles.getPropertyValue('--claude-surface').trim(),
      radiusLg: styles.getPropertyValue('--claude-radius-lg').trim(),
      shadowComposer: styles.getPropertyValue('--claude-shadow-composer').trim()
    };
  });

  expect(tokens.canvas).toBe('#f7f3ec');
  expect(tokens.surface).toBe('#fffaf3');
  expect(tokens.radiusLg).toBe('22px');
  expect(tokens.shadowComposer).toContain('rgba');
});
```

Expected outcome: FAIL because these tokens do not exist.

- [ ] **Step 2: Run the focused token test and verify it fails**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "Claude shell tokens"
```

Expected: FAIL with empty token values.

- [ ] **Step 3: Add the visual system tokens**

At the top of `web/src/App.css`, inside the existing `:root` block or by adding a new one before app layout rules, add:

```css
:root {
  --claude-canvas: #f7f3ec;
  --claude-canvas-strong: #f1eadf;
  --claude-surface: #fffaf3;
  --claude-surface-muted: #f4ede3;
  --claude-surface-raised: #fffdf8;
  --claude-border: #e3d8c8;
  --claude-border-strong: #d3c3af;
  --claude-text: #2f2a24;
  --claude-text-muted: #756b5f;
  --claude-text-subtle: #9a8f82;
  --claude-attention: #b86f2d;
  --claude-danger: #a64536;
  --claude-focus: #8b6f47;
  --claude-radius-sm: 10px;
  --claude-radius-md: 16px;
  --claude-radius-lg: 22px;
  --claude-radius-xl: 28px;
  --claude-shell-gap: 12px;
  --claude-chat-width: 820px;
  --claude-shadow-soft: 0 12px 40px rgba(64, 45, 25, 0.08);
  --claude-shadow-composer: 0 18px 60px rgba(64, 45, 25, 0.12);
}
```

If the file already has overlapping color variables, keep them and add these variables rather than renaming everything in this task.

- [ ] **Step 4: Replace the shell grid CSS**

In `web/src/App.css`, replace the current `.app-shell` grid rules that define four columns including the rail with:

```css
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(248px, 300px) minmax(0, 1fr) var(--inspector-width);
  background: var(--claude-canvas);
  color: var(--claude-text);
  column-gap: var(--claude-shell-gap);
  padding: var(--claude-shell-gap);
  overflow: hidden;
}

.app-shell.sidebar-closed {
  grid-template-columns: 0 minmax(0, 1fr) var(--inspector-width);
}

.app-shell.inspector-closed {
  grid-template-columns: minmax(248px, 300px) minmax(0, 1fr) 76px;
}

.app-shell.sidebar-closed.inspector-closed {
  grid-template-columns: 0 minmax(0, 1fr) 76px;
}
```

- [ ] **Step 5: Hide obsolete rail styles without deleting unrelated shortcut styles**

In `web/src/App.css`, replace `.primary-rail` rules with:

```css
.primary-rail {
  display: none;
}
```

Keep `.shortcut-help-popover` styles because shortcut help still renders without the rail.

- [ ] **Step 6: Restyle sidebar/workspace/inspector surfaces to use tokens**

Add these overrides after the shell/sidebar/workspace/inspector base sections in `web/src/App.css`:

```css
.session-sidebar,
.workspace,
.inspector {
  background: var(--claude-surface);
  border: 1px solid var(--claude-border);
  border-radius: var(--claude-radius-xl);
  box-shadow: var(--claude-shadow-soft);
  min-width: 0;
}

.session-sidebar {
  overflow: hidden;
}

.workspace.conversation-workspace {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--claude-surface-raised), var(--claude-surface));
}

.inspector {
  background: var(--claude-surface-muted);
}

.app-shell.sidebar-closed .session-sidebar {
  visibility: hidden;
  pointer-events: none;
}
```

- [ ] **Step 7: Run token and build checks**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "Claude shell tokens"
npm --prefix web run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add web/src/App.css web/e2e/visual.spec.ts
git commit -m "Add Claude shell visual tokens"
```

---

### Task 4: Simplify conversation header and chat canvas

**Files:**
- Modify: `web/src/ConversationWorkspace.tsx`
- Modify: `web/src/App.css`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Add a test that conversation header is not a management toolbar**

Add this test after the row overflow test in `web/e2e/visual.spec.ts`:

```ts
test('conversation header stays minimal', async ({ page }) => {
  const header = page.locator('.conversation-header');
  await expect(header).toBeVisible();
  await expect(header.getByRole('button', { name: 'More session actions' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  await expect(header.getByRole('button', { name: 'Restart' })).toHaveCount(0);
  await expect(header.getByText('permission mode')).toHaveCount(0);
});
```

Expected outcome: initially FAIL if header still exposes session more menu or metadata popover content in default state.

- [ ] **Step 2: Run the focused test and verify it fails or captures current behavior**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "conversation header stays minimal"
```

Expected: FAIL until header management controls are removed; if it passes after Task 2, keep it as regression coverage.

- [ ] **Step 3: Remove title click-to-rename from the conversation header**

In `web/src/ConversationWorkspace.tsx`, replace `EditableSessionTitle` usage in the header:

```tsx
                <EditableSessionTitle
                  session={activeSession}
                  isRenaming={renamingSessionId === activeSession.id}
                  value={renameValue}
                  onValueChange={setRenameValue}
                  onStartRename={() => startRename(activeSession)}
                  onFinishRename={() => finishRename(activeSession)}
                  onCancelRename={cancelRename}
                />
```

with:

```tsx
                <h2 className="conversation-title">{activeSession.name || shortWorkspaceName(activeSession)}</h2>
```

- [ ] **Step 4: Remove default context popover from the header**

In `web/src/ConversationWorkspace.tsx`, remove this block from the header:

```tsx
              <SessionContextPopover
                session={activeSession}
                status={activeWorktreeStatus}
                listMode={listMode}
              />
```

Keep `SessionAttentionSummary` so important runtime state remains visible.

- [ ] **Step 5: Remove now-unused header helpers**

In `web/src/ConversationWorkspace.tsx`, delete these now-unused definitions and state because session rename/context actions have moved out of the conversation header:

```ts
function EditableSessionTitle(...) { ... }
function SessionContextPopover(...) { ... }
const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState('');
function startRename(session: SessionInfo) { ... }
function finishRename(session: SessionInfo) { ... }
function cancelRename() { ... }
```

Do not delete `SessionAttentionSummary`; it remains in the minimal header for important runtime state.

- [ ] **Step 6: Add chat canvas CSS**

In `web/src/App.css`, add or update these rules:

```css
.conversation-header {
  min-height: 56px;
  padding: 14px 22px;
  border-bottom: 1px solid color-mix(in srgb, var(--claude-border) 70%, transparent);
  background: color-mix(in srgb, var(--claude-surface-raised) 86%, transparent);
}

.conversation-title-group {
  min-width: 0;
}

.conversation-title-row {
  gap: 10px;
}

.conversation-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  color: var(--claude-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.events {
  background: transparent;
}

.conversation-content {
  width: min(100%, var(--claude-chat-width));
  margin: 0 auto;
  padding: 28px 18px 24px;
}
```

- [ ] **Step 7: Run header and build checks**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "conversation header stays minimal"
npm --prefix web run build
```

Expected: both PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add web/src/ConversationWorkspace.tsx web/src/App.css web/e2e/visual.spec.ts
git commit -m "Simplify conversation header"
```

---

### Task 5: Restyle composer, transcript blocks, and empty/error states

**Files:**
- Modify: `web/src/App.css`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Add style assertions for composer and transcript surfaces**

Add this test in `web/e2e/visual.spec.ts` after the minimal header test:

```ts
test('composer and transcript use Claude visual surfaces', async ({ page }) => {
  const styles = await page.evaluate(() => {
    const composer = document.querySelector('.composer');
    const assistant = document.querySelector('.message-block.assistant');
    const tool = document.querySelector('.tool-block');
    if (!composer || !assistant || !tool) throw new Error('Missing visual elements');
    const composerStyles = getComputedStyle(composer);
    const assistantStyles = getComputedStyle(assistant);
    const toolStyles = getComputedStyle(tool);
    return {
      composerRadius: composerStyles.borderRadius,
      composerShadow: composerStyles.boxShadow,
      assistantColor: assistantStyles.color,
      toolRadius: toolStyles.borderRadius
    };
  });

  expect(styles.composerRadius).toContain('22px');
  expect(styles.composerShadow).toContain('rgba');
  expect(styles.assistantColor).toBe('rgb(47, 42, 36)');
  expect(styles.toolRadius).toContain('16px');
});
```

Expected outcome: FAIL until CSS uses the new tokens.

- [ ] **Step 2: Run the focused style test and verify it fails**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "composer and transcript"
```

Expected: FAIL on radius, shadow, or text color.

- [ ] **Step 3: Restyle composer with Claude app input surface**

In `web/src/App.css`, update composer-related rules or add overrides after existing composer styles:

```css
.composer {
  width: min(100% - 36px, var(--claude-chat-width));
  margin: 0 auto 18px;
  border: 1px solid var(--claude-border);
  border-radius: var(--claude-radius-lg);
  background: var(--claude-surface-raised);
  box-shadow: var(--claude-shadow-composer);
  padding: 12px;
}

.composer textarea,
.composer-input textarea {
  color: var(--claude-text);
  background: transparent;
}

.composer-context,
.context-attachment-chip,
.autocomplete {
  border-color: var(--claude-border);
  background: var(--claude-surface-muted);
  color: var(--claude-text-muted);
}

.send-button {
  border-radius: 999px;
}
```

Use the exact existing textarea selector `.composer-input textarea`; do not add any new JSX or change composer behavior.

- [ ] **Step 4: Restyle transcript block hierarchy**

In `web/src/App.css`, update or add overrides:

```css
.conversation-blocks,
.message-block,
.tool-block,
.task-block,
.raw-block,
.error-block {
  color: var(--claude-text);
}

.message-block {
  margin-block: 18px;
}

.message-block.assistant {
  background: transparent;
}

.message-block.user {
  background: var(--claude-surface-muted);
  border: 1px solid var(--claude-border);
  border-radius: var(--claude-radius-lg);
}

.tool-block,
.task-block,
.raw-block,
.error-block,
.permission-action-card,
.event-limit-note,
.connection-state,
.api-error {
  border: 1px solid var(--claude-border);
  border-radius: var(--claude-radius-md);
  background: var(--claude-surface-muted);
  box-shadow: none;
}

.tool-block.failed,
.error-block,
.api-error {
  border-color: color-mix(in srgb, var(--claude-danger) 35%, var(--claude-border));
}

.markdown-body pre,
.code-frame,
.diff-frame {
  border-radius: var(--claude-radius-md);
  border-color: var(--claude-border);
}
```

- [ ] **Step 5: Restyle empty/loading/error surfaces**

In `web/src/App.css`, update or add overrides:

```css
.empty-state,
.conversation-empty,
.session-empty {
  color: var(--claude-text);
  background: transparent;
}

.conversation-empty,
.empty-state {
  max-width: 620px;
  margin: auto;
  text-align: center;
}

.empty-prompts button,
.session-empty button,
.api-error button,
.connection-state button {
  border: 1px solid var(--claude-border);
  border-radius: 999px;
  background: var(--claude-surface-raised);
  color: var(--claude-text);
}
```

- [ ] **Step 6: Run focused style and build checks**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "composer and transcript"
npm --prefix web run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add web/src/App.css web/e2e/visual.spec.ts
git commit -m "Restyle chat surfaces"
```

---

### Task 6: Align the far-right inspector with Claude app context panels

**Files:**
- Modify: `web/src/InspectorPanel.tsx`
- Modify: `web/src/App.css`
- Test: `web/e2e/visual.spec.ts`

- [ ] **Step 1: Add far-right inspector layout assertions**

Add this test after the composer/transcript style test in `web/e2e/visual.spec.ts`:

```ts
test('inspector stays as the far-right contextual panel on desktop', async ({ page }) => {
  test.skip(test.info().project.use.viewport!.width <= 1100, 'desktop-only inspector layout assertion');
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const inspector = page.getByRole('complementary', { name: 'Session inspector' });
  const workspaceBox = await boxFor(workspace, 'workspace');
  const inspectorBox = await boxFor(inspector, 'inspector');
  expect(inspectorBox.x, 'inspector should sit to the right of workspace').toBeGreaterThan(workspaceBox.x + workspaceBox.width - 2);
  await expect(inspector.getByRole('tab', { name: 'Plan' })).toBeVisible();
  await expect(inspector.getByRole('tab', { name: 'Session tasks' })).toBeVisible();
});
```

Expected outcome: this may pass structurally before restyling; keep it as regression coverage.

- [ ] **Step 2: Run the focused inspector test**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "far-right contextual"
```

Expected: PASS or FAIL with a concrete layout mismatch to fix in CSS.

- [ ] **Step 3: Rename inspector header copy if it still reads like activity-only chrome**

In `web/src/InspectorPanel.tsx`, keep `aria-label="Session inspector"`, but make visible copy context-oriented. If the header currently says `Activity`, change it to:

```tsx
<h2>Context</h2>
```

Keep tab labels for Activity, Preview, Session tasks, Plan, All tasks, and Diagnostics so existing tests and accessibility remain clear.

- [ ] **Step 4: Restyle inspector as a quiet far-right panel**

In `web/src/App.css`, update or add inspector overrides:

```css
.inspector {
  align-self: stretch;
  overflow: hidden;
}

.inspector-header {
  padding: 14px 16px;
  border-bottom: 1px solid var(--claude-border);
}

.inspector-header h2,
.inspector-title {
  color: var(--claude-text);
  font-size: 14px;
  font-weight: 650;
}

.inspector-tabs {
  padding: 8px;
  gap: 4px;
  background: transparent;
}

.inspector-tabs button {
  border-radius: 999px;
  color: var(--claude-text-muted);
}

.inspector-tabs button[aria-selected='true'],
.inspector-tabs button.active {
  background: var(--claude-surface-raised);
  color: var(--claude-text);
  box-shadow: inset 0 0 0 1px var(--claude-border);
}

.inspector-panel,
.activity-list,
.task-list,
.diagnostics-panel {
  background: transparent;
}

.inspector-card,
.activity-item,
.task-item,
.diagnostic-card,
.plan-card {
  border: 1px solid var(--claude-border);
  border-radius: var(--claude-radius-md);
  background: var(--claude-surface-raised);
}
```

Use these existing inspector content classes only: `.activity-card`, `.task-card`, `.diagnostic-block`, `.diagnostic-grid`, `.plan-content`, `.waiting-surface`, and `.tasks-panel.compact`. Do not introduce new wrapper elements for inspector cards in this task.

- [ ] **Step 5: Run inspector and build checks**

Run:

```bash
npm --prefix web test -- web/e2e/visual.spec.ts -g "far-right contextual"
npm --prefix web run build
```

Expected: both PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add web/src/InspectorPanel.tsx web/src/App.css web/e2e/visual.spec.ts
git commit -m "Restyle right context inspector"
```

---

### Task 7: Update responsive behavior and visual regression baselines

**Files:**
- Modify: `web/src/App.css`
- Modify: `web/e2e/visual.spec.ts`
- Modify: Playwright screenshot snapshots under `web/e2e/**` if the test runner updates them

- [ ] **Step 1: Update responsive assertions for no rail and inspector/sidebar collapse**

In `web/e2e/visual.spec.ts`, in the viewport readability test, keep these assertions for all viewports:

```ts
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  await expectNoHorizontalPageOverflow(page);
  await expectViewportContains(composer, 'composer');
  await expectComposerPinnedBelowEvents(page);
  await expectNoHorizontalElementOverflow(events, 'event stream');
```

For viewports `<= 1100`, assert the inspector does not shrink the chat workspace:

```ts
    const beforeOpenWorkspace = await boxFor(workspace, 'workspace before inspector opens');
    await expectCompactInspector(page, 'compact inspector');
    const afterOpenWorkspace = await boxFor(workspace, 'workspace after inspector opens');
    expect(
      Math.abs(afterOpenWorkspace.width - beforeOpenWorkspace.width),
      'opening inspector on constrained viewports should not shrink the chat workspace'
    ).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Update responsive CSS for medium and narrow widths**

In `web/src/App.css`, replace existing `@media (max-width: 1100px)` shell rules with:

```css
@media (max-width: 1100px) {
  .app-shell {
    grid-template-columns: minmax(224px, 280px) minmax(0, 1fr) 72px;
  }

  .app-shell.inspector-open .inspector {
    position: fixed;
    top: var(--claude-shell-gap);
    right: var(--claude-shell-gap);
    bottom: var(--claude-shell-gap);
    width: min(var(--inspector-width), calc(100vw - 48px));
    z-index: 20;
  }
}
```

Replace existing `@media (max-width: 760px)` shell rules with:

```css
@media (max-width: 760px) {
  .app-shell,
  .app-shell.inspector-closed,
  .app-shell.sidebar-closed,
  .app-shell.sidebar-closed.inspector-closed {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    padding: 8px;
  }

  .session-sidebar {
    position: fixed;
    top: 8px;
    left: 8px;
    bottom: 8px;
    width: min(320px, calc(100vw - 16px));
    z-index: 25;
  }

  .app-shell.sidebar-closed .session-sidebar {
    transform: translateX(calc(-100% - 16px));
  }

  .workspace.conversation-workspace {
    grid-column: 1;
    min-width: 0;
  }

  .inspector {
    position: fixed;
    top: 8px;
    right: 8px;
    bottom: 8px;
    width: min(340px, calc(100vw - 16px));
    z-index: 30;
  }

  .app-shell.inspector-closed .inspector {
    width: 58px;
  }
}
```

Keep any existing mobile rules for composer and event scrolling that are still needed.

- [ ] **Step 3: Run full frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS except for screenshot snapshot diffs caused by intentional visual changes.

- [ ] **Step 4: Update visual snapshots if Playwright reports expected screenshot diffs**

Run:

```bash
npm --prefix web test -- --update-snapshots web/e2e/visual.spec.ts
```

Expected: PASS and updated snapshot files only for intentional visual layout/style changes.

- [ ] **Step 5: Run production build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add web/src/App.css web/e2e/visual.spec.ts web/e2e
git commit -m "Update Claude app visual regressions"
```

---

### Task 8: Manual browser verification and documentation review

**Files:**
- Modify: `README.md` only if the redesign changes documented user-facing behavior.
- Modify: `CLAUDE.md` only if project instructions need to change.

- [ ] **Step 1: Start the app for manual verification**

Run:

```bash
npm --prefix web run build
scripts/start-server.sh --skip-web-build
```

Expected: server starts and prints the bind address. If port `8787` is in use, stop the conflicting local dev process or use a config file with another loopback port.

- [ ] **Step 2: Verify desktop default layout in a browser**

Open the app and verify:

- No persistent rail appears.
- Left side is chat history.
- Center is the conversation workspace.
- Far right is the contextual inspector.
- The conversation header is minimal and does not expose rename/archive/restart/delete controls.

- [ ] **Step 3: Verify session row actions**

In the browser:

- Hover or focus an active session row.
- Open the row `...` menu.
- Confirm Rename, Copy session ID, Pin/Unpin, Continue/Restart/Stop/Archive/Delete actions appear according to session state.
- Confirm selecting another session still works by clicking the row outside the menu.

- [ ] **Step 4: Verify chat surfaces**

In the browser:

- Start or select a chat.
- Send a message if a safe local Claude session is available; otherwise use the existing mocked visual route if running tests.
- Confirm composer, transcript messages, tool blocks, code blocks, permission/action cards, and empty states share the warm Claude-style hierarchy.

- [ ] **Step 5: Verify inspector behavior**

In the browser:

- Open Activity, Plan, Session tasks, All tasks, Preview, and Diagnostics when available.
- Confirm content appears in the far-right inspector, not in a rail or conversation header menu.
- Resize to medium width and confirm the inspector collapses or overlays before shrinking the chat.
- Resize to narrow width and confirm the conversation and composer remain usable.

- [ ] **Step 6: Stop the app server**

Stop the process started by `scripts/start-server.sh` with Ctrl-C in its terminal, or stop the background process if it was launched by a process manager.

- [ ] **Step 7: Review README and CLAUDE instructions**

Run:

```bash
git diff -- README.md CLAUDE.md
```

Expected: no diff unless implementation changed documented behavior or project instructions. If docs need an update, make the smallest accurate edit and include it in the final commit.

- [ ] **Step 8: Final status and commit**

Run:

```bash
git status --short
```

Expected: only intentional files are modified. If README/CLAUDE changed, commit them:

```bash
git add README.md CLAUDE.md
git commit -m "Document Claude app visual shell changes"
```

If they did not change, do not create an empty commit.
