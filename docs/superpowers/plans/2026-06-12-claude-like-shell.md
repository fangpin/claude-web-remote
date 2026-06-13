# Claude-like Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Web UI into a Claude Desktop-like shell with a primary rail, session sidebar, central conversation surface, fixed composer, and right inspector while preserving existing behavior.

**Architecture:** Keep current backend APIs and most React state/handlers in `App.tsx`, but reorganize the JSX into explicit shell regions. Move the always-visible new-session form into an expandable panel, relocate task panels into a right inspector, and update CSS/tests around the new layout without adding dependencies.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS in `web/src/App.css`.

---

## File Structure

- Modify `web/src/App.tsx`
  - Owns app state, data fetching, session lifecycle handlers, WebSocket subscription, composer behavior, navigation, and the main JSX layout.
  - Add only small state needed for shell layout: `isNewSessionOpen`, `isInspectorOpen`, and `inspectorTab`.
  - Keep existing API calls and event/task/session state flows intact.

- Modify `web/src/App.css`
  - Owns global visual treatment and layout classes.
  - Replace the current two-column shell rules with a rail/sidebar/main/inspector grid.
  - Add styles for collapsible new-session panel, centered conversation content, fixed composer, and inspector tabs.

- Modify `web/src/App.test.tsx`
  - Owns integration coverage for the app shell and user flows.
  - Update tests for the new session panel, inspector placement, config navigation, and composer accessible label.

- Modify `web/src/ConversationBlockList.tsx` only if implementation needs a wrapper hook for centered conversation content. Prefer no change.

- Modify `web/src/ConfigView.tsx` only if implementation needs a layout hook. Prefer no behavior change.

- Review `README.md` and `CLAUDE.md` after changes. Update only if the project’s documented frontend behavior or run instructions become inaccurate.

---

### Task 1: Add shell structure regression coverage

**Files:**
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Add a test for the Claude-like shell regions**

Add this test near the start of the `describe('App', ...)` block, before the existing “loads sessions” test:

```tsx
  it('renders the Claude-like shell regions with conversation and inspector areas', async () => {
    render(<App />);

    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Session navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Conversation workspace' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm --prefix web test -- App
```

Expected: FAIL because the current DOM has no `Primary navigation`, `Session navigation`, `Conversation workspace`, or `Session inspector` landmarks, and the new-session form is still always visible.

---

### Task 2: Add new-session panel behavior coverage

**Files:**
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Update the create-session test to open the new panel first**

In the existing test named `creates a session from the form and can include worktree request data`, replace the body with:

```tsx
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByLabelText('Use git worktree'));
    fireEvent.click(screen.getByText('Create session'));

    expect((await screen.findAllByText('New Repo')).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      cwd: '/repo/two',
      name: 'New Repo',
      worktree: { enabled: true }
    });
```

- [ ] **Step 2: Update the deleted-mode create test to open the panel first**

In the existing test named `switches to active mode when creating from deleted mode`, insert this line before changing the working directory:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
```

The relevant part should become:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Deleted' }));
    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByText('Create session'));
```

- [ ] **Step 3: Update create-error and recent-directory tests to open the panel first**

In `shows create session errors`, insert after `render(<App />);`:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
```

In `shows recent working directory suggestions and fills the input`, insert after `render(<App />);`:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
```

- [ ] **Step 4: Run focused tests and verify they fail for missing New chat behavior**

Run:

```bash
npm --prefix web test -- App
```

Expected: FAIL because the app does not yet render a `New chat` button or hide the form by default.

---

### Task 3: Implement shell landmarks and collapsible new-session panel

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Add shell UI state**

In `web/src/App.tsx`, after the existing `const [view, setView] = useState<AppView>('sessions');` line, add:

```tsx
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<'session' | 'global' | 'details'>('session');
```

- [ ] **Step 2: Close the new-session panel after successful create**

In `onCreateSession`, after the existing `setUseWorktree(false);` line, add:

```tsx
      setIsNewSessionOpen(false);
```

- [ ] **Step 3: Replace the top-level JSX shell with rail/sidebar/workspace/inspector structure**

In `web/src/App.tsx`, replace the JSX from:

```tsx
  return (
    <main className="app-shell">
      <aside className="sidebar">
```

through the matching final `</main>` with the structure below. Keep all existing helper functions and handlers above it unchanged.

```tsx
  return (
    <div className={`app-shell ${isInspectorOpen ? 'inspector-open' : 'inspector-closed'}`}>
      <nav className="primary-rail" aria-label="Primary navigation">
        <div className="rail-brand" aria-label="Claude Remote Web">CRW</div>
        <button type="button" className={view === 'sessions' ? 'active' : ''} onClick={() => setView('sessions')}>Sessions</button>
        <button type="button" className={view === 'config' ? 'active' : ''} onClick={() => setView('config')}>Config</button>
        <button
          type="button"
          className={listMode === 'deleted' && view === 'sessions' ? 'active' : ''}
          onClick={() => {
            setView('sessions');
            setListMode('deleted');
          }}
        >
          Deleted
        </button>
      </nav>

      {view === 'sessions' && (
        <aside className="session-sidebar" aria-label="Session navigation">
          <div className="sidebar-header">
            <div>
              <h1>Claude Remote Web</h1>
              <p>Remote Claude sessions</p>
            </div>
            <button type="button" className="primary-action" onClick={() => setIsNewSessionOpen((open) => !open)}>
              New chat
            </button>
          </div>

          {isNewSessionOpen && (
            <form className="new-session-panel" onSubmit={onCreateSession}>
              <h2>New session</h2>
              <label>
                Working directory
                <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
              </label>
              {recentDirectories.length > 0 && (
                <div className="directory-suggestions" aria-label="Recent working directories">
                  <span>Recent</span>
                  {recentDirectories.map((directory) => (
                    <button key={directory} type="button" onClick={() => setCwd(directory)} aria-label={`Use ${directory}`}>
                      {directory}
                    </button>
                  ))}
                </div>
              )}
              <label className="checkbox-label">
                <input type="checkbox" checked={useWorktree} onChange={(event) => setUseWorktree(event.target.checked)} />
                Use git worktree
              </label>
              <label>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
              </label>
              <label>
                Permission mode
                <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
                  <option value="acceptEdits">acceptEdits</option>
                  <option value="auto">auto</option>
                  <option value="default">default</option>
                </select>
              </label>
              <button className="primary-action" type="submit">Create session</button>
            </form>
          )}

          <div className="session-modes" role="group" aria-label="Session list mode">
            <button
              type="button"
              className={listMode === 'active' ? 'selected' : undefined}
              aria-pressed={listMode === 'active'}
              onClick={() => setListMode('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={listMode === 'deleted' ? 'selected' : undefined}
              aria-pressed={listMode === 'deleted'}
              onClick={() => setListMode('deleted')}
            >
              Deleted
            </button>
          </div>

          <section className="sessions">
            <h2>{listMode === 'deleted' ? 'Deleted sessions' : 'Sessions'}</h2>
            {isListLoading && <p className="muted">Loading sessions...</p>}
            {!isListLoading && sessions.length === 0 && <p className="muted">{listMode === 'deleted' ? 'No deleted sessions.' : 'No sessions yet.'}</p>}
            {sessions.map((session) => (
              <button
                key={session.id}
                className={session.id === activeId ? 'session active' : 'session'}
                onClick={() => setActiveId(session.id)}
              >
                <strong>{session.name || session.cwd}</strong>
                <span className="session-path" title={session.cwd}>{session.cwd}</span>
                {session.worktree && <span className="session-path" title={session.worktree.branch}>{session.worktree.branch}</span>}
                <em className={`status status-${session.status}`}>{session.status}</em>
              </button>
            ))}
          </section>
        </aside>
      )}

      {view === 'config' ? (
        <main className="workspace config-workspace" aria-label="Configuration workspace">
          <ConfigView />
        </main>
      ) : (
        <main className="workspace conversation-workspace" aria-label="Conversation workspace">
          {error && <p role="alert" className="error">{error}</p>}
          {activeSession ? (
            <>
              <header className="conversation-header">
                <div>
                  <span className="eyebrow">{listMode === 'deleted' ? 'Deleted Claude session' : 'Remote Claude session'}</span>
                  <h2>{activeSession.name || activeSession.cwd}</h2>
                  <p title={activeSession.cwd}>{activeSession.cwd}</p>
                  {activeSession.worktree && (
                    <div className="worktree-meta">
                      <span>Source: {activeSession.worktree.sourceCwd}</span>
                      <span>Branch: {activeSession.worktree.branch}</span>
                    </div>
                  )}
                </div>
                {renderActions()}
              </header>
              {listMode === 'deleted' && (
                <p className="deleted-note">This session is deleted. Restore it before resuming work or sending messages.</p>
              )}
              <div className="events" ref={eventsRef}>
                <div className="conversation-content">
                  {hiddenEventCount > 0 && (
                    <div className="event-limit-note">
                      Showing latest {EVENT_RENDER_LIMIT} events. {hiddenEventCount} older events hidden.
                    </div>
                  )}
                  <ConversationBlockList blocks={activeBlocks} />
                </div>
              </div>
              {isActiveSessionMode && activeSession.status === 'running' && (
                <form className="composer" onSubmit={onSend} ref={composerRef} aria-label="Message composer">
                  <div className="composer-input">
                    <label className="sr-only" htmlFor="message-input">Message</label>
                    <textarea
                      id="message-input"
                      ref={messageInputRef}
                      value={message}
                      aria-label="Message"
                      placeholder="Ask Claude to inspect, edit, test, or explain..."
                      onChange={(event) => {
                        setMessage(event.target.value);
                        refreshAutocomplete(event.target.value, event.target.selectionStart);
                      }}
                      onSelect={(event) => refreshAutocomplete(event.currentTarget.value, event.currentTarget.selectionStart)}
                      onKeyDown={onMessageKeyDown}
                      rows={3}
                    />
                    {suggestions.length > 0 && autocompleteToken && (
                      <div className="autocomplete" role="listbox" aria-label="Claude command suggestions">
                        {suggestions.map((suggestion, index) => (
                          <button
                            key={suggestion.name}
                            type="button"
                            role="option"
                            aria-selected={index === activeSuggestionIndex}
                            className={index === activeSuggestionIndex ? 'autocomplete-option active' : 'autocomplete-option'}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => completeSuggestion(suggestion)}
                          >
                            <strong>{suggestion.name}</strong>
                            <span>{suggestion.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="send-button" type="submit">Send</button>
                </form>
              )}
            </>
          ) : (
            <div className="empty-state">Create or select a session.</div>
          )}
        </main>
      )}

      {view === 'sessions' && (
        <aside className="inspector" aria-label="Session inspector">
          <header className="inspector-header">
            <div>
              <h2>Inspector</h2>
              <p>{activeSession ? activeSession.name || activeSession.cwd : 'No session selected'}</p>
            </div>
            <button type="button" onClick={() => setIsInspectorOpen((open) => !open)}>
              {isInspectorOpen ? 'Hide' : 'Show'}
            </button>
          </header>
          {isInspectorOpen && (
            <>
              <div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
                <button type="button" role="tab" aria-selected={inspectorTab === 'session'} onClick={() => setInspectorTab('session')}>Session tasks</button>
                <button type="button" role="tab" aria-selected={inspectorTab === 'global'} onClick={() => setInspectorTab('global')}>All tasks</button>
                <button type="button" role="tab" aria-selected={inspectorTab === 'details'} onClick={() => setInspectorTab('details')}>Details</button>
              </div>
              {inspectorTab === 'session' && isActiveSessionMode && (
                <TasksPanel title="Session tasks" tasks={sessionTasks} error={sessionTaskError} compact onSelectTask={onSelectTask} />
              )}
              {inspectorTab === 'session' && !isActiveSessionMode && <p className="inspector-empty">No active session tasks.</p>}
              {inspectorTab === 'global' && <TasksPanel title="All tasks" tasks={tasks} error={taskError} compact onSelectTask={onSelectTask} />}
              {inspectorTab === 'details' && activeSession && (
                <section className="session-details">
                  <h3>Session details</h3>
                  <dl>
                    <dt>Status</dt>
                    <dd>{activeSession.status}</dd>
                    <dt>Directory</dt>
                    <dd>{activeSession.cwd}</dd>
                    <dt>Permission mode</dt>
                    <dd>{activeSession.permissionMode}</dd>
                    {activeSession.claudeSessionId && (
                      <>
                        <dt>Claude session</dt>
                        <dd>{activeSession.claudeSessionId}</dd>
                      </>
                    )}
                    {activeSession.worktree && (
                      <>
                        <dt>Worktree branch</dt>
                        <dd>{activeSession.worktree.branch}</dd>
                      </>
                    )}
                  </dl>
                </section>
              )}
              {inspectorTab === 'details' && !activeSession && <p className="inspector-empty">No session selected.</p>}
            </>
          )}
        </aside>
      )}
    </div>
  );
```

- [ ] **Step 4: Run focused tests and verify Task 1/2 tests pass or fail only on styling-independent assertions**

Run:

```bash
npm --prefix web test -- App
```

Expected: The shell-region test and new-session tests should now pass. Other existing tests may fail because labels/duplicate task titles moved; fix only behavior-preserving test queries in later tasks.

---

### Task 4: Add and implement inspector behavior coverage

**Files:**
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/App.tsx` if needed
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Add an inspector tab test**

Add this test near the existing task-selection tests:

```tsx
  it('shows session tasks in the inspector and can switch to all tasks and details', async () => {
    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    expect(within(inspector).getByText('Session tasks')).toBeInTheDocument();
    expect(within(inspector).getByText('Agent: Review branch')).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    expect(within(inspector).getByText('Bash: sleep 10')).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole('tab', { name: 'Details' }));
    expect(within(inspector).getByText('Permission mode')).toBeInTheDocument();
    expect(within(inspector).getByText('acceptEdits')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the focused test and verify it fails if inspector tabs are incomplete**

Run:

```bash
npm --prefix web test -- App
```

Expected: FAIL if Task 3 did not fully implement the inspector tab behavior; otherwise PASS.

- [ ] **Step 3: If failing, adjust App.tsx to match the test exactly**

Use the inspector JSX from Task 3. Ensure:

```tsx
<div className="inspector-tabs" role="tablist" aria-label="Inspector sections">
  <button type="button" role="tab" aria-selected={inspectorTab === 'session'} onClick={() => setInspectorTab('session')}>Session tasks</button>
  <button type="button" role="tab" aria-selected={inspectorTab === 'global'} onClick={() => setInspectorTab('global')}>All tasks</button>
  <button type="button" role="tab" aria-selected={inspectorTab === 'details'} onClick={() => setInspectorTab('details')}>Details</button>
</div>
```

And ensure the details section includes:

```tsx
<dt>Permission mode</dt>
<dd>{activeSession.permissionMode}</dd>
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```bash
npm --prefix web test -- App
```

Expected: PASS for the inspector tab test.

---

### Task 5: Update remaining App tests for the new layout without weakening behavior checks

**Files:**
- Modify: `web/src/App.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Update the initial render test for renamed task panel title**

In `loads sessions, tasks, and renders active event stream as conversation blocks`, replace:

```tsx
    expect(await screen.findByText('Tasks')).toBeInTheDocument();
```

with:

```tsx
    expect(await screen.findByText('Session tasks')).toBeInTheDocument();
```

If this creates a duplicate with the next assertion, keep only one `Session tasks` assertion:

```tsx
    expect(await screen.findByText('Session tasks')).toBeInTheDocument();
```

- [ ] **Step 2: Update the recent directory test to account for hidden panel by default**

After Task 2’s `New chat` click, keep the assertions unchanged:

```tsx
    const suggestions = await screen.findByLabelText('Recent working directories');
    expect(within(suggestions).getByText('/repo/one')).toBeInTheDocument();
    expect(within(suggestions).getByText('/repo/stopped')).toBeInTheDocument();
```

Do not move recent directories outside the new-session panel.

- [ ] **Step 3: Scope task click queries to the inspector when needed**

In `selects the owning session and refreshes tasks when a task is clicked`, replace:

```tsx
    await screen.findByText('Bash: sleep 10');
```

with:

```tsx
    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    await within(inspector).findByText('Bash: sleep 10');
```

Replace:

```tsx
    fireEvent.click(screen.getAllByText('Bash: sleep 10')[0]);
```

with:

```tsx
    fireEvent.click(within(inspector).getByText('Bash: sleep 10'));
```

- [ ] **Step 4: Update config navigation test name expectation only if needed**

Keep this existing assertion:

```tsx
    fireEvent.click(await screen.findByText('Config'));
    expect(await screen.findByText('Daemon config')).toBeInTheDocument();
```

If there are duplicate `Config` matches, replace the click with:

```tsx
    fireEvent.click(await screen.findByRole('button', { name: 'Config' }));
```

- [ ] **Step 5: Run focused App tests and fix only query mismatches caused by the layout move**

Run:

```bash
npm --prefix web test -- App
```

Expected: all App tests pass. Do not remove assertions for session actions, deleted sessions, worktree behavior, autocomplete, WebSocket behavior, or task refresh ordering.

---

### Task 6: Implement Claude-like shell styling

**Files:**
- Modify: `web/src/App.css`
- Test: `web/src/ConversationBlockList.test.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Replace top-level shell and sidebar styles**

In `web/src/App.css`, replace the existing `.app-shell`, `.sidebar`, `.brand`, `.new-session`, and `.view-switch`-adjacent layout styles with these rules. If a selector does not exist yet, add it near the existing shell styles.

```css
.app-shell {
  display: grid;
  grid-template-columns: 72px minmax(260px, 320px) minmax(0, 1fr) minmax(280px, 360px);
  height: 100vh;
  min-height: 0;
  background: #f7f4ef;
}

.app-shell.inspector-closed {
  grid-template-columns: 72px minmax(260px, 320px) minmax(0, 1fr) 88px;
}

.primary-rail {
  display: grid;
  grid-template-rows: auto auto auto auto 1fr;
  gap: 10px;
  border-right: 1px solid #e2ded7;
  background: #f1eee8;
  padding: 14px 10px;
}

.rail-brand {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  color: #fff;
  background: #2f2a24;
  font-size: 13px;
  font-weight: 800;
}

.primary-rail button {
  width: 100%;
  border-color: transparent;
  background: transparent;
  color: #5f5a52;
  padding: 10px 8px;
  font-size: 12px;
}

.primary-rail button.active,
.primary-rail button:hover {
  background: #fffaf2;
  color: #2f2a24;
}

.session-sidebar {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid #e2ded7;
  background: #fbfaf7;
}

.sidebar-header {
  display: grid;
  gap: 12px;
  border-bottom: 1px solid #e8e2da;
  padding: 18px 16px;
}

.sidebar-header h1,
.sidebar-header p,
.new-session-panel h2 {
  margin: 0;
}

.sidebar-header h1 {
  color: #2f2a24;
  font-size: 17px;
}

.sidebar-header p {
  margin-top: 3px;
  color: #7a746b;
  font-size: 13px;
}

.new-session-panel {
  display: grid;
  gap: 10px;
  border-bottom: 1px solid #e8e2da;
  padding: 14px 16px 16px;
  background: #fffdf8;
}
```

- [ ] **Step 2: Add workspace, conversation content, and inspector styles**

Add these rules near the existing `.conversation` and task panel styles:

```css
.workspace {
  display: grid;
  min-width: 0;
  min-height: 0;
  background: #f7f4ef;
}

.conversation-workspace {
  grid-template-rows: auto auto minmax(0, 1fr) auto;
}

.config-workspace {
  overflow: auto;
  padding: 24px;
}

.conversation-header {
  background: rgba(255, 252, 247, 0.96);
}

.events {
  min-height: 0;
  overflow: auto;
  padding: 24px;
  scroll-behavior: smooth;
}

.conversation-content {
  width: min(100%, 920px);
  margin: 0 auto;
}

.composer {
  width: min(calc(100% - 48px), 920px);
  margin: 0 auto 18px;
  border: 1px solid #e2ded7;
  border-radius: 18px;
  background: #fffdf8;
  box-shadow: 0 18px 50px rgb(47 42 36 / 0.12);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.inspector {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-left: 1px solid #e2ded7;
  background: #fbfaf7;
}

.inspector-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e8e2da;
  padding: 16px;
}

.inspector-header h2,
.inspector-header p {
  margin: 0;
}

.inspector-header p,
.inspector-empty {
  color: #7a746b;
  font-size: 13px;
}

.inspector-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 10px;
}

.inspector-tabs button[aria-selected='true'] {
  border-color: #d97757;
  background: #fff7f3;
}

.inspector-empty,
.session-details {
  padding: 16px;
}

.session-details dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px 12px;
}

.session-details dt {
  color: #7a746b;
  font-size: 12px;
  font-weight: 700;
}

.session-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
```

- [ ] **Step 3: Adjust task panel compact styling for inspector**

Replace the existing `.tasks-panel.compact` rule with:

```css
.tasks-panel.compact {
  margin: 0;
  border-top: 1px solid #e8e2da;
  border-bottom: 0;
  padding: 12px 16px 16px;
  background: transparent;
}
```

- [ ] **Step 4: Replace mobile media query for four-zone shell**

Replace the existing `@media (max-width: 820px)` block with:

```css
@media (max-width: 1020px) {
  body {
    overflow: auto;
  }

  .app-shell,
  .app-shell.inspector-closed {
    grid-template-columns: 64px minmax(240px, 320px) minmax(0, 1fr);
    grid-template-rows: minmax(520px, 1fr) auto;
    height: auto;
    min-height: 100vh;
  }

  .inspector {
    grid-column: 2 / 4;
    border-left: 0;
    border-top: 1px solid #e2ded7;
  }
}

@media (max-width: 760px) {
  .app-shell,
  .app-shell.inspector-closed {
    grid-template-columns: 1fr;
  }

  .primary-rail,
  .session-sidebar,
  .inspector {
    grid-column: auto;
  }

  .primary-rail {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-template-rows: auto;
  }
}
```

- [ ] **Step 5: Run CSS-related component tests and App tests**

Run:

```bash
npm --prefix web test -- ConversationBlockList App
```

Expected: tests pass. If CSS selector tests fail because old selectors were intentionally replaced, update tests only to assert the new selectors exist.

---

### Task 7: Manual UI verification and final frontend checks

**Files:**
- Verify only unless a discovered issue requires a fix.
- Modify if needed: `web/src/App.tsx`
- Modify if needed: `web/src/App.css`
- Modify if needed: `web/src/App.test.tsx`

- [ ] **Step 1: Run full frontend test suite**

Run:

```bash
npm --prefix web test
```

Expected: all frontend tests pass.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
npm --prefix web run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 3: Launch frontend dev server**

Run:

```bash
npm --prefix web run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL, usually `http://127.0.0.1:5173/`.

- [ ] **Step 4: Open and inspect the UI if browser tooling is available**

If Chromium/Playwright/chromium-cli is available, open the Vite URL and verify:

- Primary rail is visible.
- Session sidebar is visible.
- New-session form is hidden until `New chat` is clicked.
- Main conversation area is central and has a fixed composer for running sessions.
- Right inspector is visible and can switch between Session tasks, All tasks, and Details.
- Config is reachable from the rail.

If browser tooling is unavailable, document that limitation and at minimum verify the Vite page responds:

```bash
curl -s -o /tmp/claude-remote-web-vite.html -w "%{http_code}" http://127.0.0.1:5173/
```

Expected: `200`.

- [ ] **Step 5: Stop the dev server**

Stop the background Vite process that was started in Step 3.

---

### Task 8: Review documentation impact

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`

- [ ] **Step 1: Check whether README needs an update**

Read README sections describing features and UI usage. If the README only speaks generally about the React Web UI and does not document the old two-column layout, leave it unchanged.

If README mentions the old permanent new-session form or old tasks placement, replace that wording with:

```markdown
The Web UI uses a conversation-centered shell with session navigation, a main chat workspace, and an inspector for tasks and session details.
```

- [ ] **Step 2: Check whether CLAUDE.md needs an update**

Read CLAUDE.md project overview and implementation rules. If it does not prescribe the old UI layout, leave it unchanged.

If CLAUDE.md mentions the old layout, replace that wording with:

```markdown
The frontend should keep the conversation as the primary workspace and place operational details such as tasks, config, and session metadata in navigation or inspector surfaces.
```

- [ ] **Step 3: Run final diff review**

Run:

```bash
git diff -- web/src/App.tsx web/src/App.css web/src/App.test.tsx web/src/ConversationBlockList.tsx web/src/ConfigView.tsx README.md CLAUDE.md
```

Expected: diff shows only the planned layout/test/style changes and any necessary documentation wording.

---

## Self-Review

- Spec coverage: The plan covers the primary rail, session sidebar, central conversation area, fixed composer, right inspector, config view access, deleted sessions, task relocation, existing behavior preservation, tests, build, and manual UI verification.
- Placeholder scan: No placeholders or open-ended implementation steps remain; each code-changing step includes exact snippets or exact test changes.
- Type consistency: The plan uses existing `AppView`, `TaskGroups`, `TaskInfo`, `SessionInfo`, and existing handlers. New state names are consistent across tasks: `isNewSessionOpen`, `isInspectorOpen`, and `inspectorTab` with values `'session' | 'global' | 'details'`.
