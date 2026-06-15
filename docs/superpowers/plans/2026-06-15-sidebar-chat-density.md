# Sidebar Chat Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar default density feel like Claude app chat history while preserving Claude Code session details on hover, focus, and selected rows.

**Architecture:** Keep `SessionSidebar` responsible for list-level behavior and extract each session row into a local `SessionListItem` component. Update existing Vitest coverage in `web/src/App.test.tsx` to assert compact default content, archived mode via a quiet toolbar action, and retained pin/move/worktree details.

**Tech Stack:** React, TypeScript, CSS, Vite, Vitest, Testing Library.

---

## File structure

- Modify: `web/src/App.test.tsx`
  - Update sidebar expectations that currently assume prominent status pills, default cwd/path text, and top `Active / Archived` segmented controls.
  - Add assertions for compact row subtitles, quiet archived/recent toggle, and retained accessible actions.
- Modify: `web/src/SessionSidebar.tsx`
  - Add local helpers for compact subtitles and expanded metadata chips.
  - Add `SessionListItem` inside this file.
  - Replace inline session row JSX with `SessionListItem`.
  - Replace the top mode segmented control with a quiet toolbar action.
  - Preserve existing drag/drop, group, pin, move, search, and list-mode callbacks.
- Modify: `web/src/App.css`
  - Remove or retire the visible `.session-modes` stack.
  - Add compact row, subtitle, inline expansion, and quiet action styles.
  - Keep existing class names where practical so tests and behavior remain stable.
- Review: `README.md`, `CLAUDE.md`
  - Confirm no docs update is needed for this UI density-only change.

## Task 1: Update sidebar tests for compact chat rows

**Files:**
- Modify: `web/src/App.test.tsx:508-540`
- Modify: `web/src/App.test.tsx:795-809`
- Modify: `web/src/App.test.tsx:1470-1509`
- Modify: `web/src/App.test.tsx:1819-1832`

- [ ] **Step 1: Replace status/path-heavy expectations in the main render test**

In `web/src/App.test.tsx`, replace this block inside `it('loads sessions, tasks, and renders active event stream as conversation blocks', ...)`:

```tsx
    expect((await screen.findAllByText('Repo One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('/repo/one').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'one' })).toBeInTheDocument();
    expect(screen.getAllByText('/repo · Active this week').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready for your reply').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Claude is working').length).toBeGreaterThan(0);
    expect(screen.getByText('Can resume')).toBeInTheDocument();
    expectSessionStatus('Repo One', 'Waiting for you');
    expectSessionStatus('Worktree Repo', 'Running');
    expectSessionStatus('Stopped Repo', 'Ended');
```

with:

```tsx
    expect((await screen.findAllByText('Repo One')).length).toBeGreaterThan(0);
    const sidebar = screen.getByRole('complementary', { name: 'Session navigation' });
    expect(within(sidebar).getByRole('heading', { name: 'Recent chats' })).toBeInTheDocument();
    expect(within(sessionButton('Repo One')).getByText(/one · waiting ·/)).toBeInTheDocument();
    expect(within(sessionButton('Worktree Repo')).getByText(/one · running ·/)).toBeInTheDocument();
    expect(within(sessionButton('Stopped Repo')).getByText(/stopped ·/)).toBeInTheDocument();
    expect(within(sessionButton('Repo One')).queryByText('Ready for your reply')).not.toBeInTheDocument();
    expect(within(sessionButton('Worktree Repo')).queryByText('Claude is working')).not.toBeInTheDocument();
    expect(within(sessionButton('Stopped Repo')).queryByText('Ended')).not.toBeInTheDocument();
    expect(within(sessionButton('Repo One')).getByText('/repo/one')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'one' })).toBeInTheDocument();
    expect(screen.getByText('Can resume')).toBeInTheDocument();
```

- [ ] **Step 2: Remove the now-unused status helper**

Delete this helper from `web/src/App.test.tsx`:

```tsx
function expectSessionStatus(name: string, status: string) {
  expect(within(sessionButton(name)).getByText(status)).toBeInTheDocument();
}
```

- [ ] **Step 3: Update archived navigation expectations when creating from archived mode**

In `it('switches to active mode when creating from archived mode', ...)`, replace:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Start chat'));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument();
```

with:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived chats' }));
    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Start chat'));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archived chats' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recent chats' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument();
```

- [ ] **Step 4: Update archived list mode test selectors**

In `it('loads archived sessions without opening a WebSocket or composer and unarchives them', ...)`, replace:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
```

with:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Archived chats' }));
```

In `it('deletes archived session data from the archived list', ...)`, replace:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
```

with:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived chats' }));
```

In `it('keeps the archived empty workspace separate from the project home', ...)`, replace:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
```

with:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Archived chats' }));
```

In `it('ignores stale active list responses after switching to archived mode', ...)`, replace:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
```

with:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'Archived chats' }));
```

- [ ] **Step 5: Replace the prominent mode-button accessibility test**

Replace the entire test named `it('exposes selected state on the active and archived list mode buttons', ...)` with:

```tsx
  it('uses a quiet toolbar action to switch between recent and archived chats', async () => {
    render(<App />);

    const sidebar = await screen.findByRole('complementary', { name: 'Session navigation' });
    expect(within(sidebar).getByRole('heading', { name: 'Recent chats' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Archived chats' })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: 'Active' })).not.toBeInTheDocument();

    fireEvent.click(within(sidebar).getByRole('button', { name: 'Archived chats' }));

    expect(await within(sidebar).findByRole('heading', { name: 'Archived chats' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Recent chats' })).toBeInTheDocument();
    expect(within(sidebar).queryByRole('button', { name: 'Archived chats' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Run the focused failing tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: FAIL because `SessionSidebar` still renders the old status text and `Active / Archived` segmented controls.

- [ ] **Step 7: Commit failing test changes**

Do not commit if unrelated files are staged. Run:

```bash
git add web/src/App.test.tsx
git commit -m "test: cover compact sidebar density"
```

Expected: a new commit containing only `web/src/App.test.tsx`.

## Task 2: Extract `SessionListItem` and compact row helpers

**Files:**
- Modify: `web/src/SessionSidebar.tsx:180-226`
- Modify: `web/src/SessionSidebar.tsx:429-494`

- [ ] **Step 1: Add helper types and compact label helpers**

In `web/src/SessionSidebar.tsx`, after `branchLabel`, add:

```tsx
type SessionListItemProps = {
  activeId: string | null;
  listMode: SessionListMode;
  pinnedSessionIds: Set<string>;
  session: SessionInfo;
  sessionGroups: SessionGroup[];
  onMoveSessionToGroup: (sessionId: string, groupId: string | null) => void;
  onSelectSession: (sessionId: string) => void;
  onSessionDragStart: (event: DragEvent<HTMLDivElement>, sessionId: string) => void;
  onTogglePinned: (sessionId: string) => void;
};

function compactRelativeUpdatedAt(value: string): string {
  return formatRelativeUpdatedAt(value).replace(/^Updated\s+/u, '');
}

function compactRuntimeLabel(session: SessionInfo, listMode: SessionListMode): string | null {
  if (listMode === 'archived' || session.deletedAt) return null;
  const runtimeStatus = getRuntimeStatus(session);
  if (runtimeStatus === 'running') return 'running';
  if (runtimeStatus === 'starting') return 'starting';
  if (runtimeStatus === 'waiting') return 'waiting';
  if (runtimeStatus === 'failed') return 'failed';
  return null;
}

function compactSubtitleForSession(session: SessionInfo, listMode: SessionListMode): string {
  const projectName = pathBasename(projectPathForSession(session));
  const runtimeLabel = compactRuntimeLabel(session, listMode);
  const timeLabel = compactRelativeUpdatedAt(session.updatedAt);
  return runtimeLabel ? `${projectName} · ${runtimeLabel} · ${timeLabel}` : `${projectName} · ${timeLabel}`;
}
```

- [ ] **Step 2: Add the `SessionListItem` component**

In `web/src/SessionSidebar.tsx`, after `PinIcon`, add:

```tsx
function SessionListItem({
  activeId,
  listMode,
  pinnedSessionIds,
  session,
  sessionGroups,
  onMoveSessionToGroup,
  onSelectSession,
  onSessionDragStart,
  onTogglePinned
}: SessionListItemProps) {
  const runtimeStatus = getSidebarRuntimeStatus(session);
  const statusClass = listMode === 'archived' ? 'archived' : runtimeStatus;
  const sessionTitle = session.name || pathBasename(projectPathForSession(session));
  const projectPath = projectPathForSession(session);
  const isPinned = pinnedSessionIds.has(session.id);
  const branch = branchLabel(session);
  const isActive = session.id === activeId;
  const worktreeLabel = session.worktree ? 'worktree' : null;

  return (
    <div
      className={isActive ? 'session-row active' : 'session-row'}
      key={session.id}
      draggable
      onDragStart={(event) => onSessionDragStart(event, session.id)}
    >
      <button
        className={isActive ? 'session active' : 'session'}
        aria-current={isActive ? 'page' : undefined}
        data-session-id={session.id}
        title="Select session (⌥ Up/Down switches sessions)"
        onClick={() => onSelectSession(session.id)}
      >
        <span className="session-title-row">
          <span className="session-title-main">
            <span className={`session-attention-dot ${runtimeStatus}`} aria-hidden="true" />
            <strong>{sessionTitle}</strong>
          </span>
        </span>
        <span className="session-subtitle">{compactSubtitleForSession(session, listMode)}</span>
        <span className="session-expanded-details" aria-label={`Details for ${sessionTitle}`}>
          <span className="session-cwd" title={projectPath}>{projectPath}</span>
          <span className="session-detail-chips">
            {branch && <span className="session-detail-chip" title={branch}>{branch}</span>}
            {worktreeLabel && <span className="session-detail-chip">{worktreeLabel}</span>}
            <span className="session-detail-chip">{session.permissionMode}</span>
            {listMode === 'archived' && <span className={`session-detail-chip status-${statusClass}`}>archived</span>}
          </span>
        </span>
      </button>
      <select
        className="session-move-select"
        aria-label={`Move ${sessionTitle} to group`}
        value={session.groupId ?? ''}
        onChange={(event) => onMoveSessionToGroup(session.id, event.target.value || null)}
        title="Move conversation to group"
      >
        <option value="">Ungrouped</option>
        {sessionGroups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
      </select>
      <button
        type="button"
        className={isPinned ? 'session-pin-button pinned' : 'session-pin-button'}
        aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${sessionTitle}`}
        aria-pressed={isPinned}
        title={isPinned ? 'Unpin conversation' : 'Pin conversation'}
        onClick={() => onTogglePinned(session.id)}
      >
        <PinIcon filled={isPinned} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Replace inline row JSX with the new component**

In the `section.sessions.map((session) => { ... })` block, replace the entire callback body with:

```tsx
                    return (
                      <SessionListItem
                        activeId={activeId}
                        key={session.id}
                        listMode={listMode}
                        pinnedSessionIds={pinnedSessionIds}
                        session={session}
                        sessionGroups={sessionGroups}
                        onMoveSessionToGroup={onMoveSessionToGroup}
                        onSelectSession={onSelectSession}
                        onSessionDragStart={onSessionDragStart}
                        onTogglePinned={onTogglePinned}
                      />
                    );
```

Then remove now-unused local variables from the old map callback.

- [ ] **Step 4: Run TypeScript build to catch extraction mistakes**

Run:

```bash
npm --prefix web run build
```

Expected: FAIL only if the extraction missed a prop, helper, or import. Fix TypeScript errors before continuing.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: tests may still fail because CSS and archived toolbar mode have not changed yet, but there should be no runtime crash from rendering `SessionListItem`.

- [ ] **Step 6: Commit the component extraction**

Run:

```bash
git add web/src/SessionSidebar.tsx
git commit -m "refactor: extract sidebar session rows"
```

Expected: a new commit containing the component extraction.

## Task 3: Replace prominent Active/Archived controls with quiet toolbar action

**Files:**
- Modify: `web/src/SessionSidebar.tsx:302-352`
- Modify: `web/src/App.css:667-689`

- [ ] **Step 1: Remove the `session-modes` block from the sidebar header stack**

In `web/src/SessionSidebar.tsx`, delete this block:

```tsx
      <div className="session-modes" role="group" aria-label="Session list mode">
        <button
          type="button"
          className={listMode === 'active' ? 'selected' : undefined}
          aria-pressed={listMode === 'active'}
          onClick={() => onSetListMode('active')}
        >
          Active
        </button>
        <button
          type="button"
          className={listMode === 'archived' ? 'selected' : undefined}
          aria-pressed={listMode === 'archived'}
          onClick={() => onSetListMode('archived')}
        >
          Archived
        </button>
      </div>
```

- [ ] **Step 2: Add a quiet mode action in the toolbar**

In `web/src/SessionSidebar.tsx`, replace the toolbar heading/action JSX:

```tsx
          <div>
            <h2>{searchQuery ? 'Search results' : listMode === 'archived' ? 'Archived chats' : 'Recent chats'}</h2>
            <p>{toolbarSummary(sessionSearch, sessions, visibleSessions)}</p>
          </div>
          <div className="session-list-toolbar-actions">
            <button type="button" onClick={onAddGroup}>New group</button>
            {sessionSearch && (
              <button type="button" onClick={() => onSetSessionSearch('')}>Clear</button>
            )}
          </div>
```

with:

```tsx
          <div>
            <h2>{searchQuery ? 'Search results' : listMode === 'archived' ? 'Archived chats' : 'Recent chats'}</h2>
            <p>{toolbarSummary(sessionSearch, sessions, visibleSessions)}</p>
          </div>
          <div className="session-list-toolbar-actions">
            <button type="button" className="quiet-action" onClick={onAddGroup}>New group</button>
            <button
              type="button"
              className="quiet-action"
              onClick={() => onSetListMode(listMode === 'archived' ? 'active' : 'archived')}
            >
              {listMode === 'archived' ? 'Recent chats' : 'Archived chats'}
            </button>
            {sessionSearch && (
              <button type="button" className="quiet-action" onClick={() => onSetSessionSearch('')}>Clear</button>
            )}
          </div>
```

- [ ] **Step 3: Update sidebar grid rows after removing mode controls**

In `web/src/App.css`, replace:

```css
.session-sidebar {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel-bg);
}
```

with:

```css
.session-sidebar {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel-bg);
}
```

- [ ] **Step 4: Replace `.session-modes` styles with `.quiet-action` styles**

In `web/src/App.css`, delete the `.session-modes` block:

```css
.session-modes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  border-bottom: 1px solid var(--border);
  padding: 10px 16px;
  background: var(--panel-bg);
}

.session-modes button {
  border-color: transparent;
  color: var(--muted);
  background: transparent;
  padding: 7px 10px;
  font-size: 13px;
}

.session-modes button.selected {
  border-color: var(--border);
  color: var(--text);
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(45 42 38 / 0.05);
}
```

Then add this in its place:

```css
.quiet-action {
  border-color: transparent;
  color: var(--muted);
  background: transparent;
  padding: 5px 7px;
  font-size: 12px;
}

.quiet-action:hover,
.quiet-action:focus-visible {
  border-color: var(--border);
  color: var(--text-soft);
  background: rgb(255 253 250 / 0.62);
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: archived toolbar tests pass; row density tests may still fail until CSS and markup are fully aligned.

- [ ] **Step 6: Commit the archived control change**

Run:

```bash
git add web/src/SessionSidebar.tsx web/src/App.css
git commit -m "refactor: quiet sidebar archive switch"
```

Expected: a new commit containing the quiet toolbar mode action.

## Task 4: Style compact rows and inline details

**Files:**
- Modify: `web/src/App.css:894-1128`

- [ ] **Step 1: Replace row and session base styles**

In `web/src/App.css`, replace the existing `.session-row`, `.session`, `.session-title-row`, `.session-path-row`, `.session-detail-row`, `.session-title-main`, `.session-attention-dot`, `.session strong`, `.session-resume-cue`, `.session-path-row`, `.session-detail-row`, `.session-project`, `.session-parent`, `.session-branch`, `.session-detail-row`, and `.session-branch` rules from `.session-row {` through the end of `.session-branch { ... }` with:

```css
.session-row {
  position: relative;
  display: grid;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.session-row:hover,
.session-row:focus-within {
  border-color: transparent;
  background: var(--surface-hover);
}

.session-row.active {
  border-color: var(--border);
  background: var(--surface);
  box-shadow: 0 1px 2px rgb(45 42 38 / 0.04);
}

.session {
  display: grid;
  gap: 4px;
  width: 100%;
  min-height: 56px;
  border-color: transparent;
  text-align: left;
  color: var(--text);
  background: transparent;
  padding: 10px 34px 10px 10px;
}

.session:hover {
  border-color: transparent;
  background: transparent;
}

.session.active {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.session-title-main {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.session-attention-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: var(--muted-soft);
}

.session-attention-dot.running,
.session-attention-dot.starting {
  background: #5f8fbd;
  animation: dot-pulse 1.1s ease-in-out infinite;
}

.session-attention-dot.waiting {
  background: #c95f50;
}

.session-attention-dot.failed {
  background: var(--danger);
}

.session strong {
  min-width: 0;
  color: var(--text);
  overflow-wrap: anywhere;
  font-size: 13.5px;
  line-height: 1.35;
}

.session-subtitle,
.session-expanded-details {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
}

.session-subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-expanded-details {
  display: grid;
  gap: 5px;
  max-height: 0;
  overflow: hidden;
  opacity: 0;
  transform: translateY(-2px);
  transition: max-height 160ms ease, opacity 140ms ease, transform 140ms ease;
}

.session-row:hover .session-expanded-details,
.session-row:focus-within .session-expanded-details,
.session-row.active .session-expanded-details {
  max-height: 64px;
  opacity: 1;
  transform: translateY(0);
}

.session-cwd {
  overflow: hidden;
  color: var(--muted-soft);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

.session-detail-chip {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  background: rgb(255 253 250 / 0.64);
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 2: Adjust move select positioning for expanded rows**

Replace the existing `.session-move-select` rule with:

```css
.session-move-select {
  position: absolute;
  right: 37px;
  bottom: 9px;
  max-width: 112px;
  min-height: 24px;
  border-radius: 7px;
  background: rgb(255 253 250 / 0.9);
  padding: 2px 6px;
  color: var(--muted);
  font-size: 11px;
  opacity: 0;
}
```

Keep this existing visibility rule, but expand it to include active rows:

```css
.session-row:hover .session-move-select,
.session-row:focus-within .session-move-select,
.session-row.active .session-move-select,
.session-move-select:focus-visible {
  opacity: 1;
}
```

- [ ] **Step 3: Expand pin visibility for active/focused rows**

Replace the pin visibility rule with:

```css
.session-row:hover .session-pin-button,
.session-row:focus-within .session-pin-button,
.session-row.active .session-pin-button,
.session-pin-button:focus-visible,
.session-pin-button.pinned {
  opacity: 1;
}
```

- [ ] **Step 4: Keep legacy `.status` styles available but not dominant**

Leave the `.status` and `.status-*` rules in place because other components use status pill patterns and archived detail chips may reuse color classes. Do not remove these rules in this task.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS for updated sidebar behavior.

- [ ] **Step 6: Commit compact row styling**

Run:

```bash
git add web/src/App.css
git commit -m "style: compact sidebar chat rows"
```

Expected: a new commit containing only CSS changes.

## Task 5: Polish section headings and remove metadata-heavy descriptions

**Files:**
- Modify: `web/src/SessionSidebar.tsx:76-152`
- Modify: `web/src/App.css:785-865`

- [ ] **Step 1: Simplify section descriptions in `buildSessionSections`**

In `web/src/SessionSidebar.tsx`, replace the pinned section description:

```tsx
      description: listMode === 'archived' ? 'Saved archived conversations' : 'Favorites and active work',
```

with:

```tsx
      description: countLabel(pinnedSessions.length),
```

Replace custom group descriptions:

```tsx
        description: groupSessions.length > 0 ? 'Custom group' : 'Drop chats here',
```

with:

```tsx
        description: groupSessions.length > 0 ? countLabel(groupSessions.length) : 'Drop chats here',
```

Replace project section descriptions:

```tsx
        description: `${parentPath(projectPath)} · ${timeHintForSession(session, now)}`,
```

with:

```tsx
        description: timeHintForSession(session, now),
```

- [ ] **Step 2: Keep section counts but avoid duplicate count text for descriptions**

In the section heading JSX, replace:

```tsx
                    <span>{countLabel(section.sessions.length)}</span>
```

with:

```tsx
                    {!section.description.includes(countLabel(section.sessions.length)) && <span>{countLabel(section.sessions.length)}</span>}
```

This avoids showing `2 chats` twice for pinned/custom groups while keeping counts visible for project/date-like sections.

- [ ] **Step 3: Make section heading descriptions quieter**

In `web/src/App.css`, update `.session-section-heading h3` font size if needed by replacing:

```css
  font-size: 13px;
```

with:

```css
  font-size: 12px;
```

inside the `.session-section-heading h3` rule only.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx
```

Expected: PASS. If a test expects `/repo · Active this week`, update it to assert only the project heading or the compact session subtitle.

- [ ] **Step 5: Commit section heading polish**

Run:

```bash
git add web/src/SessionSidebar.tsx web/src/App.css
git commit -m "style: quiet sidebar section metadata"
```

Expected: a new commit containing section description and heading polish.

## Task 6: Full verification, UI check, and docs review

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- No code changes expected unless verification finds a problem.

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 2: Run the production frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 3: Start the app for manual sidebar verification**

Use the project preview/server workflow available in the current environment. If using Claude Preview, start the configured app server. If no preview config exists, create `.claude/launch.json` with the project’s normal dev command and then start it through the preview tool, not a long-running Bash server.

Manual checks in the browser:

- Recent sidebar rows show title plus compact subtitle by default.
- Active row exposes cwd, branch/worktree, permission, pin, and move controls.
- Hover and keyboard focus expose the same expanded details.
- Waiting/running/failed sessions are visible via subtitle text and dot color.
- `Archived chats` switches to archived mode; `Recent chats` returns.
- Pin, move select, drag/drop groups, rename group, and delete group remain reachable.

- [ ] **Step 4: Review README and CLAUDE update need**

Run:

```bash
git diff -- README.md CLAUDE.md
```

Expected: no output unless a prior task changed docs accidentally.

Read the relevant instruction/docs sections if uncertain:

```bash
grep -n "sidebar\|session\|Archived\|Active" README.md CLAUDE.md
```

Expected: no mandatory docs update for this UI density-only change. If README or CLAUDE contains stale screenshots or precise sidebar behavior text, update only that stale text and commit it separately.

- [ ] **Step 5: Review final diff**

Run:

```bash
git status --short
git diff -- web/src/App.test.tsx web/src/SessionSidebar.tsx web/src/App.css README.md CLAUDE.md
```

Expected: only intended changes are present. If all implementation tasks were committed, `git status --short` should be clean.

- [ ] **Step 6: Final commit for verification fixes if needed**

If manual verification required small fixes, commit them:

```bash
git add web/src/App.test.tsx web/src/SessionSidebar.tsx web/src/App.css README.md CLAUDE.md
git commit -m "fix: polish sidebar chat density"
```

Expected: commit only if there were uncommitted verification fixes. Do not create an empty commit.

## Self-review

- Spec coverage: default compact rows are covered by Tasks 1, 2, and 4; hover/focus/active inline details by Tasks 2 and 4; quiet archived mode by Tasks 1 and 3; section metadata reduction by Task 5; accessibility by Tasks 1, 2, and 4; frontend tests/build/manual verification/docs review by Task 6.
- Placeholder scan: no placeholders remain in the task steps; code snippets and commands are explicit.
- Type consistency: `SessionInfo.permissionMode`, `SessionInfo.worktree`, `SessionGroup`, `SessionListMode`, and existing callbacks match the current code and types.
