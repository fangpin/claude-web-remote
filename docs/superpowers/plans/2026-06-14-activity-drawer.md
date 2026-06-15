# Activity Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Inspector UI with a default-closed Activity drawer opened from the conversation header.

**Architecture:** Keep the existing React data flow from `App.tsx` into the current inspector component, but change the surface semantics to an Activity drawer. Move the drawer out of the grid column model and into a fixed overlay with backdrop, while preserving existing activity/task/plan/diagnostics content and lazy diagnostics fetching.

**Tech Stack:** React, TypeScript, Vite, Vitest, React Testing Library, CSS.

---

## File Structure

- Modify `web/src/App.test.tsx`: update existing Inspector tests and helper names to Activity drawer behavior.
- Modify `web/src/ConversationWorkspace.tsx`: add a header `Activity` button prop and render it on the right side of the conversation header.
- Modify `web/src/App.tsx`: default tab to `activity`, rename toggle semantics/copy, pass header button to workspace, gate diagnostics by `import.meta.env.DEV`, and use visible tab keyboard order.
- Modify `web/src/AppShell.tsx`: remove permanent inspector grid semantics and keep rendering the drawer as an overlay layer.
- Modify `web/src/InspectorPanel.tsx`: convert visible labels/ARIA from Inspector to Activity drawer, add backdrop and close button, reduce main tabs to Activity/Tasks/Plan, add Advanced group for All tasks and dev-only Diagnostics.
- Modify `web/src/ActivityPanel.tsx`: tune copy toward current run/execution trace without changing data flow.
- Modify `web/src/App.css`: replace grid-column inspector styles with fixed drawer/backdrop styles and remove mobile bottom-panel behavior.
- Review `README.md` and `CLAUDE.md`: confirm whether user-facing Activity naming requires docs updates.

---

### Task 1: Test the Activity drawer entry point and default state

**Files:**
- Modify: `web/src/App.test.tsx:274-280`
- Modify: `web/src/App.test.tsx:1705-1746`

- [ ] **Step 1: Update the drawer test helper**

Replace the current `openInspector` helper in `web/src/App.test.tsx` with:

```tsx
function openActivityDrawer(): HTMLElement {
  const button = screen.getByRole('button', { name: 'Open activity drawer' });
  fireEvent.click(button);
  return screen.getByRole('complementary', { name: 'Activity drawer' });
}
```

- [ ] **Step 2: Replace the session tasks inspector test with Activity drawer expectations**

Replace the test beginning with:

```tsx
it('shows session tasks in the inspector and can switch to all tasks and plan', async () => {
```

with:

```tsx
it('opens the Activity drawer from the conversation header and defaults to activity', async () => {
  render(<App />);

  await screen.findByRole('heading', { name: 'Repo One' });
  expect(screen.queryByRole('complementary', { name: 'Activity drawer' })).not.toBeInTheDocument();
  expect(screen.queryByRole('complementary', { name: 'Session inspector' })).not.toBeInTheDocument();

  const drawer = openActivityDrawer();
  expect(within(drawer).getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  expect(within(drawer).getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  expect(within(drawer).getByText('Current run')).toBeInTheDocument();
  expect(within(drawer).getByText(/Claude is waiting/i)).toBeInTheDocument();
  expect(within(drawer).getByRole('tab', { name: 'Tasks' })).toHaveAttribute('tabIndex', '-1');
  expect(within(drawer).getByRole('tab', { name: 'Plan' })).toHaveAttribute('tabIndex', '-1');
  expect(within(drawer).queryByRole('tab', { name: 'Session tasks' })).not.toBeInTheDocument();
});

it('shows current tasks, advanced all tasks, and plan inside the Activity drawer', async () => {
  render(<App />);

  const drawer = openActivityDrawer();
  fireEvent.click(within(drawer).getByRole('tab', { name: 'Tasks' }));
  const tasksPanel = within(drawer).getByRole('tabpanel', { name: 'Tasks' });
  expect(within(tasksPanel).getByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
  expect(await within(tasksPanel).findByText('Agent: Review branch')).toBeInTheDocument();
  expect(within(drawer).getByRole('tab', { name: 'Tasks' })).toHaveAttribute('tabIndex', '0');
  expect(within(drawer).getByRole('tab', { name: 'Plan' })).toHaveAttribute('tabIndex', '-1');

  fireEvent.keyDown(within(drawer).getByRole('tab', { name: 'Tasks' }), { key: 'ArrowRight' });
  expect(within(drawer).getByRole('tab', { name: 'Plan' })).toHaveAttribute('aria-selected', 'true');
  expect(within(drawer).getByRole('tab', { name: 'Plan' })).toHaveFocus();
  expect(within(drawer).getByRole('tab', { name: 'Tasks' })).toHaveAttribute('tabIndex', '-1');

  fireEvent.click(within(drawer).getByRole('button', { name: 'All tasks' }));
  const allTasksPanel = within(drawer).getByRole('tabpanel', { name: 'All tasks' });
  expect(await within(allTasksPanel).findByText('Agent: Check stopped repo')).toBeInTheDocument();

  fireEvent.click(within(drawer).getByRole('tab', { name: 'Plan' }));
  const planPanel = within(drawer).getByRole('tabpanel', { name: 'Plan' });
  expect(within(planPanel).getByText('No plan available for this session.')).toBeInTheDocument();

  await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
  FakeWebSocket.instances[0].emit({
    id: 42,
    sessionId: 's1',
    time: '2026-06-11T00:00:00Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      name: 'ExitPlanMode',
      input: { plan: '# Session plan\n\n- Replace details with plan.' }
    }
  });

  expect(await within(planPanel).findByText(/Replace details with plan/)).toBeInTheDocument();
  expect(within(planPanel).getByText('From ExitPlanMode')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the focused tests and verify they fail**

Run:

```bash
npm --prefix web test -- App.test.tsx -t "Activity drawer|current tasks"
```

Expected: FAIL because the header button, Activity drawer ARIA label, default Activity tab, and Advanced all-tasks button are not implemented yet.

- [ ] **Step 4: Commit the failing tests**

Run:

```bash
git add web/src/App.test.tsx
git commit -m "Test activity drawer entry point"
```

Expected: commit succeeds with only test changes.

---

### Task 2: Add the header Activity button and shell overlay model

**Files:**
- Modify: `web/src/ConversationWorkspace.tsx:18-69`
- Modify: `web/src/ConversationWorkspace.tsx:345-384`
- Modify: `web/src/App.tsx:640-705`
- Modify: `web/src/AppShell.tsx:15-120`

- [ ] **Step 1: Add Activity button props to ConversationWorkspace**

In `web/src/ConversationWorkspace.tsx`, add these props to the `Props` type:

```tsx
  isActivityDrawerOpen: boolean;
  onToggleActivityDrawer: () => void;
```

Add them to the destructuring list in `ConversationWorkspace`:

```tsx
  isActivityDrawerOpen,
  onToggleActivityDrawer,
```

- [ ] **Step 2: Render the Activity button in the conversation header**

Replace the existing header closing block:

```tsx
              <p title={workspacePathForSession(activeSession)}>{workspacePathForSession(activeSession)}</p>
            </div>
          </header>
```

with:

```tsx
              <p title={workspacePathForSession(activeSession)}>{workspacePathForSession(activeSession)}</p>
            </div>
            <button
              type="button"
              className="activity-drawer-trigger"
              aria-label="Open activity drawer"
              aria-expanded={isActivityDrawerOpen}
              onClick={onToggleActivityDrawer}
            >
              Activity
            </button>
          </header>
```

- [ ] **Step 3: Pass Activity button props from App**

In the `ConversationWorkspace` JSX in `web/src/App.tsx`, add:

```tsx
          isActivityDrawerOpen={isInspectorOpen}
          onToggleActivityDrawer={() => setIsInspectorOpen((open) => !open)}
```

- [ ] **Step 4: Simplify AppShell drawer-related props**

In `web/src/AppShell.tsx`, keep `isInspectorOpen`, `inspector`, and `inspectorWidth`, but remove grid meaning from names only in implementation. Ensure the returned shell still renders:

```tsx
      {view === 'sessions' && sidebar}
      {workspace}
      {view === 'sessions' && inspector}
```

Do not remove `inspectorWidth` yet because drawer resize still uses `--inspector-width`.

- [ ] **Step 5: Run the focused Activity entry test**

Run:

```bash
npm --prefix web test -- App.test.tsx -t "opens the Activity drawer"
```

Expected: still FAIL because `InspectorPanel` still has old ARIA labels and content, but the failure should no longer be about a missing `Open activity drawer` button.

- [ ] **Step 6: Commit the header entry point**

Run:

```bash
git add web/src/ConversationWorkspace.tsx web/src/App.tsx web/src/AppShell.tsx
git commit -m "Add activity drawer header trigger"
```

---

### Task 3: Convert InspectorPanel into the Activity drawer UI

**Files:**
- Modify: `web/src/InspectorPanel.tsx:15-164`
- Modify: `web/src/App.tsx:53-55`
- Modify: `web/src/App.tsx:401`
- Modify: `web/src/App.tsx:508-528`
- Modify: `web/src/App.tsx:708-733`

- [ ] **Step 1: Default the selected tab to Activity**

In `web/src/App.tsx`, replace:

```tsx
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('session');
```

with:

```tsx
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('activity');
```

- [ ] **Step 2: Gate diagnostics by Vite dev mode**

In `web/src/App.tsx`, add:

```tsx
  const isDeveloperMode = import.meta.env.DEV;
```

Then replace:

```tsx
  const isDiagnosticsVisible = view === 'sessions' && isInspectorOpen && inspectorTab === 'diagnostics';
```

with:

```tsx
  const isDiagnosticsVisible = isDeveloperMode && view === 'sessions' && isInspectorOpen && inspectorTab === 'diagnostics';
```

- [ ] **Step 3: Update command palette copy**

Replace the `toggle-inspector` command in `web/src/App.tsx` with:

```tsx
    { id: 'toggle-inspector', title: isInspectorOpen ? 'Hide activity' : 'Show activity', hint: 'Toggle Claude activity, tasks, and plan', kind: 'Command', shortcut: '⌘I', run: () => setIsInspectorOpen((open) => !open) }
```

- [ ] **Step 4: Use visible tabs for keyboard navigation**

Replace `onInspectorTabKeyDown` in `web/src/App.tsx` with:

```tsx
  function visibleInspectorTabs(): InspectorTab[] {
    return isDeveloperMode ? ['activity', 'session', 'plan', 'global', 'diagnostics'] : ['activity', 'session', 'plan', 'global'];
  }

  function onInspectorTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs = visibleInspectorTabs().filter((tab) => tab !== 'global' && tab !== 'diagnostics');
    const currentIndex = tabs.indexOf(inspectorTab);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;

    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    setInspectorTab(tabs[nextIndex]);
    document.getElementById(`inspector-tab-${tabs[nextIndex]}`)?.focus();
  }
```

- [ ] **Step 5: Prevent hidden Diagnostics from remaining selected**

Add this effect after `onInspectorTabKeyDown` in `web/src/App.tsx`:

```tsx
  useEffect(() => {
    if (!isDeveloperMode && inspectorTab === 'diagnostics') {
      setInspectorTab('activity');
    }
  }, [inspectorTab, isDeveloperMode]);
```

- [ ] **Step 6: Pass developer mode into InspectorPanel**

In `web/src/InspectorPanel.tsx`, add this prop to `Props`:

```tsx
  isDeveloperMode: boolean;
```

Add it to the component destructuring:

```tsx
  isDeveloperMode,
```

In `web/src/App.tsx`, pass:

```tsx
          isDeveloperMode={isDeveloperMode}
```

- [ ] **Step 7: Replace InspectorPanel shell markup with drawer markup**

In `web/src/InspectorPanel.tsx`, replace the component `return` from `return (` through the closing `</aside>` fragment with:

```tsx
  if (!isInspectorOpen) return null;

  return (
    <>
      <button
        type="button"
        className="activity-drawer-backdrop"
        aria-label="Close activity drawer"
        onClick={onToggleInspector}
      />
      <aside className="inspector activity-drawer" aria-label="Activity drawer">
        <button
          type="button"
          className="inspector-resize-handle"
          aria-label="Resize activity drawer"
          title="Drag to resize activity drawer"
          onPointerDown={onResizeInspectorStart}
        />
        <header className="inspector-header activity-drawer-header">
          <div>
            <h2>Activity</h2>
            <p>{activeSession ? activeSession.name || activeSession.cwd : 'No session selected'}</p>
          </div>
          <button type="button" className="activity-drawer-close" aria-label="Close activity drawer" onClick={onToggleInspector}>Close</button>
        </header>
        <div className="inspector-tabs" role="tablist" aria-label="Activity drawer sections">
          <button type="button" id="inspector-tab-activity" role="tab" aria-selected={inspectorTab === 'activity'} aria-controls="inspector-panel-activity" tabIndex={inspectorTab === 'activity' ? 0 : -1} onClick={() => onSetInspectorTab('activity')} onKeyDown={onInspectorTabKeyDown}>Activity</button>
          <button type="button" id="inspector-tab-session" role="tab" aria-selected={inspectorTab === 'session'} aria-controls="inspector-panel-session" tabIndex={inspectorTab === 'session' ? 0 : -1} onClick={() => onSetInspectorTab('session')} onKeyDown={onInspectorTabKeyDown}>Tasks</button>
          <button type="button" id="inspector-tab-plan" role="tab" aria-selected={inspectorTab === 'plan'} aria-controls="inspector-panel-plan" tabIndex={inspectorTab === 'plan' ? 0 : -1} onClick={() => onSetInspectorTab('plan')} onKeyDown={onInspectorTabKeyDown}>Plan</button>
        </div>
        <div id="inspector-panel-activity" role="tabpanel" aria-labelledby="inspector-tab-activity" hidden={inspectorTab !== 'activity'}>
          <ActivityPanel
            activities={activities}
            activeSession={activeSession}
            waitingMessage={waitingMessage}
            onSelectActivity={onSelectActivity}
          />
        </div>
        <div id="inspector-panel-session" role="tabpanel" aria-labelledby="inspector-tab-session" hidden={inspectorTab !== 'session'}>
          {isActiveSessionMode ? (
            <TasksPanel title="Tasks" tasks={sessionTasks} error={sessionTaskError} compact onSelectTask={onSelectTask} />
          ) : (
            <p className="inspector-empty">No active session tasks.</p>
          )}
        </div>
        <section id="inspector-panel-plan" role="tabpanel" aria-labelledby="inspector-tab-plan" className="session-plan" hidden={inspectorTab !== 'plan'}>
          {!activeSession ? (
            <p className="inspector-empty">No session selected.</p>
          ) : activePlan ? (
            <>
              <h3>Session plan</h3>
              <p className="plan-source">From {activePlan.source === 'ExitPlanMode' ? 'ExitPlanMode' : 'plan file'}</p>
              <pre className="plan-content">{activePlan.markdown}</pre>
            </>
          ) : (
            <p className="inspector-empty">No plan available for this session.</p>
          )}
        </section>
        <section className="activity-drawer-advanced" aria-label="Advanced activity sections">
          <h3>Advanced</h3>
          <div className="activity-drawer-advanced-actions">
            <button type="button" aria-pressed={inspectorTab === 'global'} onClick={() => onSetInspectorTab('global')}>All tasks</button>
            {isDeveloperMode && <button type="button" aria-pressed={inspectorTab === 'diagnostics'} onClick={() => onSetInspectorTab('diagnostics')}>Diagnostics</button>}
          </div>
        </section>
        <div id="inspector-panel-global" role="tabpanel" aria-label="All tasks" hidden={inspectorTab !== 'global'}>
          <TasksPanel title="All tasks" tasks={tasks} error={taskError} compact onSelectTask={onSelectTask} />
        </div>
        {isDeveloperMode && (
          <section id="inspector-panel-diagnostics" role="tabpanel" aria-label="Diagnostics" className="diagnostics-panel" hidden={inspectorTab !== 'diagnostics'}>
            <DiagnosticsPanel
              activeSession={activeSession}
              diagnostics={diagnostics}
              error={diagnosticsError}
              isLoading={isDiagnosticsLoading}
              sessionDiagnostics={sessionDiagnostics}
              onRefresh={onRefreshDiagnostics}
            />
          </section>
        )}
      </aside>
    </>
  );
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx -t "Activity drawer|current tasks"
```

Expected: the tests from Task 1 PASS or only fail on CSS-independent label issues that this task should fix before proceeding.

- [ ] **Step 9: Commit the Activity drawer component conversion**

Run:

```bash
git add web/src/App.tsx web/src/InspectorPanel.tsx
git commit -m "Convert inspector to activity drawer"
```

---

### Task 4: Update Activity copy and drawer styling

**Files:**
- Modify: `web/src/ActivityPanel.tsx:89-118`
- Modify: `web/src/App.css:137-156`
- Modify: `web/src/App.css:1271-1279`
- Modify: `web/src/App.css:3364-3523`
- Modify: `web/src/App.css:3530-3569`
- Modify: `web/src/App.css:4251-4550`

- [ ] **Step 1: Update ActivityPanel copy**

In `web/src/ActivityPanel.tsx`, replace the header copy:

```tsx
          <h3>Activity</h3>
```

with:

```tsx
          <h3>Current run</h3>
```

Replace:

```tsx
          <span>Select a session to see recent tool activity.</span>
```

with:

```tsx
          <span>Select a chat to see what Claude has been doing.</span>
```

Replace:

```tsx
          <span>No tool activity yet</span>
          <span>Tool calls will appear here when Claude starts using them.</span>
```

with:

```tsx
          <span>No activity yet</span>
          <span>Claude's tool calls and permission waits will appear here.</span>
```

- [ ] **Step 2: Remove Inspector grid column reservation**

In `web/src/App.css`, replace the base `.app-shell` grid definitions at lines 137-156 with:

```css
.app-shell {
  display: grid;
  grid-template-columns: 72px minmax(260px, 320px) minmax(0, 1fr);
  height: 100vh;
  min-height: 0;
  color: var(--text);
  background: var(--app-bg);
}

.app-shell.sidebar-closed {
  grid-template-columns: 72px 0 minmax(0, 1fr);
}
```

Delete the `.app-shell.inspector-closed` and `.app-shell.sidebar-closed.inspector-closed` base rules.

- [ ] **Step 3: Style the conversation header button**

Replace the `.conversation-header` rule with:

```css
.conversation-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 50px;
  border-bottom: 1px solid var(--border);
  padding: 8px 16px;
  background: rgb(250 247 241 / 0.94);
}
```

Add after `.conversation-title-group`:

```css
.activity-drawer-trigger {
  justify-self: end;
  padding: 6px 10px;
  font-size: 12px;
}
```

- [ ] **Step 4: Replace Inspector panel CSS with drawer CSS**

Replace the `.inspector` through `.app-shell.inspector-closed [role='tabpanel']` block with:

```css
.activity-drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  width: auto;
  height: auto;
  border: 0;
  border-radius: 0;
  background: rgb(45 42 38 / 0.22);
  padding: 0;
  cursor: default;
  backdrop-filter: blur(2px);
}

.activity-drawer-backdrop:hover {
  background: rgb(45 42 38 / 0.24);
}

.inspector,
.activity-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: grid;
  grid-template-rows: auto auto minmax(0, auto) minmax(0, 1fr);
  width: min(var(--inspector-width, 360px), calc(100vw - 72px));
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--panel-bg);
  box-shadow: var(--shadow-popover);
}

.inspector-resize-handle {
  position: absolute;
  inset: 0 auto 0 -5px;
  z-index: 80;
  width: 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  cursor: col-resize;
  touch-action: none;
}

.inspector-resize-handle::after {
  content: '';
  position: absolute;
  top: 18px;
  bottom: 18px;
  left: 4px;
  width: 2px;
  border-radius: 999px;
  background: transparent;
  transition: background 0.16s ease;
}

.inspector-resize-handle:hover::after,
.inspector-resize-handle:focus-visible::after {
  background: var(--accent);
}

.inspector-header,
.activity-drawer-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  min-width: 0;
  border-bottom: 1px solid var(--border);
  padding: 15px 16px;
}

.inspector-header > div {
  min-width: 0;
}

.inspector-header h2,
.inspector-header p {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector-header h2 {
  font-size: 16px;
  font-weight: 720;
}

.inspector-header p,
.inspector-empty {
  color: var(--muted);
  font-size: 13px;
}

.activity-drawer-close {
  padding: 6px 10px;
  font-size: 12px;
}

.inspector-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 3px;
  border-bottom: 1px solid var(--border);
  padding: 10px 10px 9px;
}

.inspector-tabs button {
  display: block;
  min-height: 30px;
  border-color: transparent;
  background: transparent;
  color: var(--muted);
  padding: 7px 6px;
  font-size: 11px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inspector-tabs button:hover {
  color: var(--text);
  background: var(--surface-hover);
}

.inspector-tabs button[aria-selected='true'] {
  border-color: #d8c7b8;
  color: var(--text);
  background: #fffaf4;
  box-shadow: 0 1px 2px rgb(45 42 38 / 0.04);
}

.activity-drawer-advanced {
  display: grid;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding: 10px 14px;
}

.activity-drawer-advanced h3 {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 720;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.activity-drawer-advanced-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.activity-drawer-advanced-actions button {
  padding: 6px 9px;
  font-size: 12px;
}

.activity-drawer-advanced-actions button[aria-pressed='true'] {
  border-color: #d8c7b8;
  color: var(--text);
  background: #fffaf4;
}
```

- [ ] **Step 5: Update responsive CSS to keep drawer overlay on mobile**

In `web/src/App.css`, update the `@media (max-width: 1100px)` grid rules to remove inspector-specific grid columns:

```css
  .app-shell {
    grid-template-columns: 64px minmax(220px, 280px) minmax(0, 1fr);
    grid-template-rows: 1fr;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
  }
```

Delete nested `.app-shell.inspector-closed ...` rules inside this media block.

In `@media (max-width: 760px)`, keep the mobile grid for rail/sidebar/workspace but replace the old `.inspector` mobile bottom-panel rules with:

```css
  .activity-drawer {
    width: min(420px, calc(100vw - 18px));
  }

  .inspector-resize-handle {
    display: none;
  }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx -t "Activity drawer|current tasks"
```

Expected: PASS.

- [ ] **Step 7: Commit copy and styling**

Run:

```bash
git add web/src/ActivityPanel.tsx web/src/App.css
git commit -m "Style activity drawer overlay"
```

---

### Task 5: Update diagnostics and task-selection tests

**Files:**
- Modify: `web/src/App.test.tsx:1748-1817`

- [ ] **Step 1: Replace diagnostics test with dev-mode advanced diagnostics behavior**

Replace the test beginning with:

```tsx
it('shows runtime diagnostics in the inspector', async () => {
```

with:

```tsx
it('shows runtime diagnostics from the Activity drawer advanced section in dev mode', async () => {
  render(<App />);

  const drawer = openActivityDrawer();
  fireEvent.click(within(drawer).getByRole('button', { name: 'Diagnostics' }));

  const diagnosticsPanel = within(drawer).getByRole('tabpanel', { name: 'Diagnostics' });
  expect(await within(diagnosticsPanel).findByText('Daemon health checks are passing.')).toBeInTheDocument();
  expect(within(diagnosticsPanel).getByText('Data directory exists and is writable.')).toBeInTheDocument();
  expect(within(diagnosticsPanel).getByText('claude --print --input-format stream-json --output-format stream-json --include-partial-messages --permission-mode bypassPermissions --verbose')).toBeInTheDocument();
  expect(await within(diagnosticsPanel).findByText('No recent process errors recorded for this session.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics', undefined);
  expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/diagnostics', undefined);
});
```

Note: Vitest runs Vite in dev-like mode, so `import.meta.env.DEV` is true here.

- [ ] **Step 2: Update task-selection tests to use All tasks advanced button**

In the test `selects the owning session and refreshes tasks when a task is clicked`, replace:

```tsx
    const inspector = openInspector();
    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    const allTasksPanel = within(inspector).getByRole('tabpanel', { name: 'All tasks' });
```

with:

```tsx
    const drawer = openActivityDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'All tasks' }));
    const allTasksPanel = within(drawer).getByRole('tabpanel', { name: 'All tasks' });
```

In the test `keeps the latest global task refresh when older requests resolve later`, replace:

```tsx
    const inspector = openInspector();
    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    const allTasksPanel = within(inspector).getByRole('tabpanel', { name: 'All tasks' });
```

with:

```tsx
    const drawer = openActivityDrawer();
    fireEvent.click(within(drawer).getByRole('button', { name: 'All tasks' }));
    const allTasksPanel = within(drawer).getByRole('tabpanel', { name: 'All tasks' });
```

- [ ] **Step 3: Replace remaining helper references**

Run:

```bash
grep -n "openInspector\|Session inspector\|Show inspector\|Hide inspector\|Session tasks" web/src/App.test.tsx web/src/App.tsx web/src/AppShell.tsx web/src/InspectorPanel.tsx
```

Expected: no old Inspector user-facing references remain except type/component/internal names that are intentionally deferred.

- [ ] **Step 4: Run the affected tests**

Run:

```bash
npm --prefix web test -- App.test.tsx -t "diagnostics|owning session|latest global task|Activity drawer|current tasks"
```

Expected: PASS.

- [ ] **Step 5: Commit updated tests**

Run:

```bash
git add web/src/App.test.tsx
git commit -m "Update activity drawer tests"
```

---

### Task 6: Verify full frontend behavior and docs impact

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Modify only if needed: `README.md`
- Modify only if needed: `CLAUDE.md`

- [ ] **Step 1: Run the full frontend test suite**

Run:

```bash
npm --prefix web test
```

Expected: all tests PASS.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm --prefix web run build
```

Expected: build succeeds. This also type-checks that `import.meta.env.DEV` usage is valid.

- [ ] **Step 3: Search docs for Inspector references**

Run:

```bash
grep -R "Inspector\|inspector\|Diagnostics\|Activity" -n README.md CLAUDE.md docs web/src --exclude-dir=node_modules
```

Expected: identify whether README.md or CLAUDE.md documents the old user-facing Inspector control. If only source/test/spec/plan references appear, no docs change is needed.

- [ ] **Step 4: Update docs only if the grep finds stale user-facing documentation**

If `README.md` or `CLAUDE.md` contains stale user-facing Inspector instructions, replace those sentences with Activity drawer wording. If neither file has stale user-facing Inspector instructions, make no docs change.

- [ ] **Step 5: Run git status and review diff**

Run:

```bash
git status --short
git diff -- web/src/App.tsx web/src/AppShell.tsx web/src/ConversationWorkspace.tsx web/src/InspectorPanel.tsx web/src/ActivityPanel.tsx web/src/App.css web/src/App.test.tsx README.md CLAUDE.md
```

Expected: diff shows only Activity drawer changes and any necessary docs updates.

- [ ] **Step 6: Commit verification/docs changes if files changed after Task 5**

If Step 5 shows uncommitted changes, run:

```bash
git add README.md CLAUDE.md web/src/App.tsx web/src/AppShell.tsx web/src/ConversationWorkspace.tsx web/src/InspectorPanel.tsx web/src/ActivityPanel.tsx web/src/App.css web/src/App.test.tsx
git commit -m "Verify activity drawer behavior"
```

If Step 5 shows no uncommitted changes, do not create an empty commit.

---

## Self-Review

- Spec coverage: Entry point is covered by Task 2; overlay layout by Task 4; drawer content and Advanced grouping by Task 3; Activity copy by Task 4; diagnostics lazy/dev gating by Task 3 and Task 5; testing and docs review by Task 6.
- Placeholder scan: no unfinished markers are present. Conditional docs update is explicit and bounded by grep output.
- Type consistency: the plan intentionally keeps `InspectorTab` and `InspectorPanel` internal names while changing user-facing Activity labels. New props are `isActivityDrawerOpen` and `onToggleActivityDrawer`, and tests use `openActivityDrawer` consistently.
