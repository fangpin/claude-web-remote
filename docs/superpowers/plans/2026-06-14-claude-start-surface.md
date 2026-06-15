# Claude Start Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cwd-first new chat page with a Claude-style start surface that creates a session and immediately sends the user's first prompt.

**Architecture:** Keep the backend unchanged and update the frontend flow to call the existing `createSession(...)` API followed by `sendInput(sessionId, prompt)`. `ProjectHome.tsx` owns only lightweight start-composer UI state; `useSessions.ts` owns session creation, list updates, and first-prompt submission.

**Tech Stack:** React, TypeScript, Vite, Vitest, React Testing Library, existing REST API helpers in `web/src/api.ts`, styling in `web/src/App.css`.

---

## File Structure

- Modify `web/src/ProjectHome.tsx`: replace the cwd-first form with a start composer, context chips, suggestion cards, collapsible project context, recent chats, and recent project selector inside the context area.
- Modify `web/src/useSessions.ts`: add an `onStartSession(initialPrompt: string)` action that creates the session, opens it, and sends the initial prompt with `sendInput`.
- Modify `web/src/App.tsx`: pass `onStartSession` into `ProjectHome` and keep the existing post-create focus behavior.
- Modify `web/src/App.test.tsx`: update old new-chat assertions and add coverage for first-prompt submission, suggestion fill, empty prompt/cwd blocking, context disclosure, recent projects, and send-failure behavior.
- Modify `web/src/App.css`: replace the existing `.project-home*` launch-form styles with composer-first styles and responsive rules.
- Review `README.md` and `CLAUDE.md`: update only if the user-facing behavior or project instructions need documentation changes.

---

### Task 1: Add failing tests for the new start surface behavior

**Files:**
- Modify: `web/src/App.test.tsx:771-836`
- Modify: `web/src/App.test.tsx:862-868`
- Modify: `web/src/App.test.tsx:972-979`
- Modify: `web/src/App.test.tsx:1043-1068`
- Modify: `web/src/App.test.tsx:1552-1560`

- [ ] **Step 1: Replace the old create-session test with first-prompt behavior**

Replace the test beginning at `it('creates a session from the form and can include worktree request data'` with:

```tsx
  it('creates a session from the start composer and sends the initial prompt', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ask Claude to explain, edit, test, review…')).toBeInTheDocument();
    expect(screen.getByLabelText('Start prompt')).toHaveFocus();
    expect(screen.getByText('Project: one')).toBeInTheDocument();
    expect(screen.getByText('Worktree: On')).toBeInTheDocument();
    expect(screen.getByText('Permission: bypassPermissions')).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace context')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change project context' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    expect(screen.getByText('Skip prompts for trusted local repos.')).toBeInTheDocument();
    expect(screen.getByLabelText('Use git worktree')).toBeChecked();

    fireEvent.change(screen.getByLabelText('Start prompt'), { target: { value: 'Explain this repo structure' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      cwd: '/repo/two',
      permissionMode: 'bypassPermissions',
      worktree: { enabled: true }
    });
    expect(JSON.parse(String(createCall?.[1]?.body))).not.toHaveProperty('name');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s6/input', expect.objectContaining({ method: 'POST' })));
    const inputCall = fetchMock.mock.calls.find(([url]) => String(url) === '/api/sessions/s6/input');
    expect(JSON.parse(String(inputCall?.[1]?.body))).toEqual({ text: 'Explain this repo structure' });
  });
```

- [ ] **Step 2: Update archived-mode creation test**

In `it('switches to active mode when creating from archived mode'`, replace the form interactions with:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change project context' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Start prompt'), { target: { value: 'Start from archive mode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
```

- [ ] **Step 3: Update create-session error test**

Replace the body of `it('shows create session errors'` with:

```tsx
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change project context' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '~' } });
    fireEvent.change(screen.getByLabelText('Start prompt'), { target: { value: 'Try invalid cwd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('invalid request: cwd does not exist: ~')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
```

- [ ] **Step 4: Replace recent projects test with context-selector behavior**

Replace `it('shows recent projects and fills the launch directory'` with:

```tsx
  it('shows recent projects in project context and updates the context chip', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    expect(await screen.findByText('Project: one')).toBeInTheDocument();
    expect(screen.queryByLabelText('Recent projects')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Change project context' }));
    const recentProjects = await screen.findByLabelText('Recent projects');
    expect(within(recentProjects).getByText('external')).toBeInTheDocument();
    expect(within(recentProjects).getAllByText('/repo').length).toBeGreaterThan(0);
    expect(within(recentProjects).getByText('stopped')).toBeInTheDocument();
    expect(within(recentProjects).getByText('one')).toBeInTheDocument();
    expect(within(recentProjects).queryByText('external-worktree')).not.toBeInTheDocument();
    expect(within(recentProjects).queryByText('abc123')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use /repo/stopped as project context' }));

    expect(screen.getByLabelText('Workspace context')).toHaveValue('/repo/stopped');
    expect(screen.getByText('Project: stopped')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/sessions' && init?.method === 'POST')).toBe(false);
  });
```

- [ ] **Step 5: Add tests for suggestions and blocking invalid submit**

Insert after the recent projects test:

```tsx
  it('fills start prompt suggestions without creating a session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Explain this repo' }));

    expect(screen.getByLabelText('Start prompt')).toHaveValue('Explain this repo');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/sessions' && init?.method === 'POST')).toBe(false);
  });

  it('blocks start composer submission until cwd and prompt are present', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    const sendButton = await screen.findByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Start prompt'), { target: { value: 'Run tests' } });
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Change project context' }));
    fireEvent.change(screen.getByLabelText('Workspace context'), { target: { value: '   ' } });
    expect(sendButton).toBeDisabled();

    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/sessions' && init?.method === 'POST')).toBe(false);
  });
```

- [ ] **Step 6: Add test for prompt send failure after session creation**

Insert after the create-session error test:

```tsx
  it('opens the created session and reports an error when initial prompt sending fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = init?.method === undefined ? eventsResponse(url) : null;
      if (eventResponse) return eventResponse;
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions });
      if (url === '/api/session-groups' && !init) return jsonResponse({ groups: sessionGroups });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          ...sessions[0],
          id: 's6',
          name: null,
          cwd: body.cwd,
          worktree: null,
          updatedAt: '2026-06-12T00:00:00Z'
        });
      }
      if (url === '/api/sessions/s6/input' && init?.method === 'POST') return jsonResponse({ error: 'initial input failed' }, 500);
      if (url.endsWith('/transcript') || url.includes('/transcript?')) return jsonResponse({ events: [] });
      return jsonResponse({ ok: true });
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Change project context' }));
    fireEvent.change(screen.getByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Start prompt'), { target: { value: 'This send will fail' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(await screen.findByText('initial input failed')).toBeInTheDocument();
  });
```

- [ ] **Step 7: Update remaining old-heading assertions**

Replace these expected headings/texts:

```tsx
expect(screen.getByRole('main', { name: 'Conversation workspace' })).toHaveTextContent('Where should Claude work?');
expect(await screen.findByRole('heading', { name: 'Where should Claude work?' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: 'Where should Claude work?' })).toBeInTheDocument();
expect(screen.queryByRole('heading', { name: 'Where should Claude work?' })).not.toBeInTheDocument();
```

with:

```tsx
expect(screen.getByRole('main', { name: 'Conversation workspace' })).toHaveTextContent('What would you like Claude to do?');
expect(await screen.findByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
expect(screen.getByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
expect(screen.queryByRole('heading', { name: 'What would you like Claude to do?' })).not.toBeInTheDocument();
```

- [ ] **Step 8: Run the focused tests and verify they fail**

Run:

```bash
npm --prefix web test -- App.test.tsx --run
```

Expected: FAIL. Failures should mention missing heading “What would you like Claude to do?”, missing label “Start prompt”, or missing `/api/sessions/s6/input` call.

- [ ] **Step 9: Commit failing tests**

```bash
git add web/src/App.test.tsx
git commit -m "test: cover Claude start surface"
```

---

### Task 2: Implement session creation plus initial prompt submission

**Files:**
- Modify: `web/src/useSessions.ts:1-280`
- Modify: `web/src/App.tsx:316-319`
- Modify: `web/src/App.tsx:675-687`

- [ ] **Step 1: Import `sendInput` in `useSessions.ts`**

Change the API import at the top of `web/src/useSessions.ts` to include `sendInput`:

```ts
import {
  archiveSession,
  createSession,
  createSessionGroup,
  deleteSession,
  deleteSessionGroup,
  getWorktreeStatus,
  listSessionGroups,
  listSessions,
  restartSession,
  resumeSession,
  sendInput,
  stopAndRemoveWorktree,
  stopSession,
  unarchiveSession,
  updateSession,
  updateSessionGroup
} from './api';
```

- [ ] **Step 2: Add a helper that opens a newly created session**

Insert this helper immediately before the existing `async function onCreateSession(event: FormEvent)`:

```ts
  function openCreatedSession(created: SessionInfo) {
    if (listModeState === 'archived') {
      skipNextListRefresh.current = true;
      setListModeState('active');
      setSessions([created]);
    } else {
      setSessions((current) => [created, ...current]);
    }
    isStartSurfaceOpenRef.current = false;
    setActiveId(created.id);
    setIsStartSurfaceOpen(false);
    setCwd('');
    setUseWorktree(true);
    callbacksRef.current.onTasksChanged?.();
    callbacksRef.current.onSessionTasksChanged?.(created.id);
  }
```

- [ ] **Step 3: Refactor `onCreateSession` to use the helper**

Replace the body of `onCreateSession` with:

```ts
  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      openCreatedSession(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
```

- [ ] **Step 4: Add `onStartSession(initialPrompt)`**

Insert this function immediately after `onCreateSession`:

```ts
  async function onStartSession(initialPrompt: string) {
    const launchCwd = cwd.trim();
    const prompt = initialPrompt.trim();
    if (!launchCwd || !prompt) return;
    setError(null);
    try {
      const created = await createSession({
        cwd: launchCwd,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      openCreatedSession(created);
      try {
        const updated = await sendInput(created.id, prompt);
        if (updated) {
          setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
```

- [ ] **Step 5: Return `onStartSession` from `useSessions`**

In the return object near `onCreateSession`, add:

```ts
    onStartSession,
```

The surrounding block should read:

```ts
    visibleSessions,
    onArchive,
    onCreateSession,
    onStartSession,
    onCreateGroup,
```

- [ ] **Step 6: Update the App-level wrapper**

In `web/src/App.tsx`, replace:

```ts
  async function onCreateSession(event: FormEvent) {
    shouldFocusComposerAfterCreateRef.current = true;
    await sessionState.onCreateSession(event);
  }
```

with:

```ts
  async function onStartSession(initialPrompt: string) {
    shouldFocusComposerAfterCreateRef.current = true;
    await sessionState.onStartSession(initialPrompt);
  }
```

If `FormEvent` is now unused in `App.tsx`, remove it from the React type import at the top of the file.

- [ ] **Step 7: Pass `onStartSession` to `ProjectHome`**

In the `ProjectHome` props in `web/src/App.tsx`, replace:

```tsx
              onCreateSession={onCreateSession}
```

with:

```tsx
              onStartSession={onStartSession}
```

- [ ] **Step 8: Run type-aware tests and verify behavior is not complete yet**

Run:

```bash
npm --prefix web test -- App.test.tsx --run
```

Expected: still FAIL because `ProjectHome` props and UI have not been updated yet. There should be TypeScript or runtime failures around `onStartSession` / old start page labels.

- [ ] **Step 9: Commit session flow changes**

```bash
git add web/src/useSessions.ts web/src/App.tsx
git commit -m "feat: send initial prompt when starting chat"
```

---

### Task 3: Replace `ProjectHome` with the Claude start surface

**Files:**
- Modify: `web/src/ProjectHome.tsx:1-220`

- [ ] **Step 1: Update imports and props**

At the top of `web/src/ProjectHome.tsx`, replace the React import and prop type with:

```tsx
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { runtimeStatusLabels } from './AppShell';
import type { RecentProject } from './useSessions';
import type { SessionInfo } from './types';

type Props = {
  cwd: string;
  permissionMode: string;
  recentProjects: RecentProject[];
  recentSessions: SessionInfo[];
  useWorktree: boolean;
  onStartSession: (initialPrompt: string) => Promise<void> | void;
  onSelectSession: (sessionId: string) => void;
  onSetCwd: (cwd: string) => void;
  onSetPermissionMode: (mode: string) => void;
  onSetUseWorktree: (useWorktree: boolean) => void;
};
```

- [ ] **Step 2: Add start suggestion data**

After `permissionModeDescriptions`, add:

```tsx
const startSuggestions = [
  'Explain this repo',
  'Fix a bug',
  'Review changes',
  'Run tests',
  'Implement a feature'
];
```

- [ ] **Step 3: Replace the component signature and state setup**

Replace the start of `ProjectHome(...)` through `const launchCopy = ...` with:

```tsx
export default function ProjectHome({
  cwd,
  permissionMode,
  recentProjects,
  recentSessions,
  useWorktree,
  onStartSession,
  onSelectSession,
  onSetCwd,
  onSetPermissionMode,
  onSetUseWorktree
}: Props) {
  const [initialPrompt, setInitialPrompt] = useState('');
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const launchCwd = cwd.trim();
  const canStart = Boolean(launchCwd && initialPrompt.trim());
  const projectLabel = launchCwd ? pathBasename(launchCwd) : 'Choose project';

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canStart) return;
    void onStartSession(initialPrompt);
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canStart) void onStartSession(initialPrompt);
  }
```

- [ ] **Step 4: Replace the returned JSX with the new surface**

Replace the full `return (...)` block with:

```tsx
  return (
    <section className="project-home" aria-label="Project home">
      <div className="project-home-inner">
        <header className="project-home-hero">
          <span className="empty-eyebrow">New chat</span>
          <h2>What would you like Claude to do?</h2>
          <p>Start with a task. Claude will use your selected project context when the chat begins.</p>
        </header>

        <form className="start-composer-card" onSubmit={onSubmit} aria-label="Start a new Claude session">
          <label className="sr-only" htmlFor="project-home-prompt">Start prompt</label>
          <div className="start-composer-input">
            <textarea
              id="project-home-prompt"
              ref={promptRef}
              value={initialPrompt}
              aria-label="Start prompt"
              placeholder="Ask Claude to explain, edit, test, review…"
              onChange={(event) => setInitialPrompt(event.target.value)}
              onKeyDown={onPromptKeyDown}
              rows={4}
            />
            <button className="primary-action" type="submit" disabled={!canStart}>Send</button>
          </div>

          <div className="start-context-row" aria-label="Project context summary">
            <span className="start-context-chip" title={launchCwd || 'Choose a repo path on the devbox'}>Project: {projectLabel}</span>
            <span className="start-context-chip">Worktree: {useWorktree ? 'On' : 'Off'}</span>
            <span className="start-context-chip">Permission: {permissionMode}</span>
            <details className="project-context-panel">
              <summary aria-label="Change project context">Change</summary>
              <div className="project-context-body">
                <label className="field-stack" htmlFor="project-home-cwd">
                  <span>Workspace context</span>
                  <input
                    id="project-home-cwd"
                    value={cwd}
                    onChange={(event) => onSetCwd(event.target.value)}
                    placeholder="Choose a repo path on the devbox"
                    required
                  />
                </label>

                {recentProjects.length > 0 && (
                  <div className="project-home-section context-projects" aria-label="Recent projects">
                    <div className="project-section-heading">
                      <h3>Recent projects</h3>
                      <p>Switch the context Claude will use.</p>
                    </div>
                    <div className="project-card-grid">
                      {recentProjects.map((project) => (
                        <button
                          key={project.cwd}
                          type="button"
                          className="project-card"
                          onClick={() => onSetCwd(project.cwd)}
                          aria-label={`Use ${project.cwd} as project context`}
                        >
                          <strong>{pathBasename(project.cwd)}</strong>
                          <span title={project.cwd}>{parentPath(project.cwd)}</span>
                          <small>
                            {countLabel(project.sessionCount, 'chat')}
                            {project.runningCount > 0 ? ` · ${project.runningCount} active` : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="advanced-session-grid">
                  <label className="checkbox-label option-line">
                    <input
                      type="checkbox"
                      checked={useWorktree}
                      onChange={(event) => onSetUseWorktree(event.target.checked)}
                      aria-label="Use git worktree"
                    />
                    <span>
                      <strong>Use git worktree</strong>
                      <small>Start from an isolated checkout when available.</small>
                    </span>
                  </label>
                  <label className="field-stack" htmlFor="project-home-permission-mode">
                    <span>Permission mode</span>
                    <select
                      id="project-home-permission-mode"
                      value={permissionMode}
                      onChange={(event) => onSetPermissionMode(event.target.value)}
                      aria-describedby="project-home-permission-help"
                    >
                      <option value="bypassPermissions">bypassPermissions</option>
                      <option value="acceptEdits">acceptEdits</option>
                      <option value="auto">auto</option>
                      <option value="default">default</option>
                    </select>
                    <span id="project-home-permission-help">{permissionModeDescriptions[permissionMode] ?? 'Use the selected Claude permission policy.'}</span>
                  </label>
                </div>
              </div>
            </details>
          </div>
        </form>

        <div className="start-suggestion-grid" aria-label="Start prompt suggestions">
          {startSuggestions.map((suggestion) => (
            <button key={suggestion} type="button" onClick={() => setInitialPrompt(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>

        {recentSessions.length > 0 && (
          <section className="project-home-section" aria-label="Recent sessions">
            <div className="project-section-heading">
              <h3>Recent chats</h3>
              <p>Resume where you left off.</p>
            </div>
            <div className="recent-session-grid">
              {recentSessions.map((session) => {
                const runtimeStatus = session.runtimeStatus ?? session.status;
                const statusLabel = runtimeStatusLabels[runtimeStatus];
                const projectCwd = sessionProjectCwd(session);
                return (
                  <button
                    key={session.id}
                    type="button"
                    className="recent-session-card"
                    onClick={() => onSelectSession(session.id)}
                    aria-label={`Open ${sessionTitle(session)}`}
                  >
                    <span className="session-main-row">
                      <strong>{sessionTitle(session)}</strong>
                      <em className={`status status-${runtimeStatus}`}>{statusLabel}</em>
                    </span>
                    <span className="session-path" title={projectCwd}>{projectCwd}</span>
                    {session.worktree && (
                      <span className="session-worktree-row">
                        <span>Worktree</span>
                        <span className="session-branch" title={session.worktree.branch}>{session.worktree.branch}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run focused tests and verify remaining failures are style-independent**

Run:

```bash
npm --prefix web test -- App.test.tsx --run
```

Expected: Most start-surface behavior tests should now PASS. If failures remain, they should identify exact behavior issues such as focus timing, button labels, or input call ordering.

- [ ] **Step 6: Commit ProjectHome behavior**

```bash
git add web/src/ProjectHome.tsx
git commit -m "feat: add Claude-style start composer"
```

---

### Task 4: Replace project-home styling with composer-first hierarchy

**Files:**
- Modify: `web/src/App.css:1829-2050`

- [ ] **Step 1: Replace `.project-home` through responsive project-home rules**

In `web/src/App.css`, replace the existing block from `.project-home {` through the end of the `@media (max-width: 640px)` block that currently adjusts `.project-cwd-row` with:

```css
.project-home {
  min-height: 0;
  overflow: auto;
  padding: clamp(32px, 7vh, 72px) 24px 44px;
}

.project-home-inner {
  display: grid;
  gap: 18px;
  width: min(100%, 860px);
  margin: 0 auto;
}

.project-home-hero {
  display: grid;
  justify-items: center;
  gap: 8px;
  text-align: center;
}

.project-home-hero h2,
.project-home-hero p,
.project-section-heading h3,
.project-section-heading p {
  margin: 0;
}

.project-home-hero h2 {
  color: var(--text);
  font-size: clamp(31px, 4.8vw, 46px);
  font-weight: 760;
  letter-spacing: -0.04em;
  line-height: 1.04;
}

.project-home-hero p {
  max-width: 610px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.55;
}

.start-composer-card {
  display: grid;
  gap: 12px;
  border: 1px solid var(--border-strong);
  border-radius: 22px;
  background: linear-gradient(180deg, rgb(255 253 250 / 0.96), rgb(250 246 239 / 0.9));
  padding: 13px;
  box-shadow: var(--shadow-soft);
}

.start-composer-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
}

.start-composer-input textarea {
  min-height: 126px;
  resize: vertical;
  border-color: transparent;
  border-radius: 17px;
  background: rgb(255 253 250 / 0.72);
  padding: 16px;
  font-size: 16px;
  line-height: 1.5;
  box-shadow: inset 0 0 0 1px rgb(45 42 38 / 0.07);
}

.start-composer-input textarea:focus {
  border-color: #ca9073;
  background: var(--surface);
}

.start-composer-input .primary-action {
  min-height: 42px;
  border-radius: 999px;
  padding-inline: 18px;
}

.start-context-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 0 4px 2px;
}

.start-context-chip {
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted);
  background: rgb(255 253 250 / 0.7);
  padding: 4px 9px;
  font-size: 12px;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-context-panel {
  position: relative;
  color: var(--muted);
  font-size: 12px;
}

.project-context-panel summary {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--accent-strong);
  background: rgb(246 232 222 / 0.72);
  padding: 4px 10px;
  font-weight: 700;
  line-height: 1.25;
  list-style: none;
  cursor: pointer;
}

.project-context-panel summary::-webkit-details-marker {
  display: none;
}

.project-context-panel summary:hover {
  border-color: #d7b8a9;
  background: var(--accent-soft);
}

.project-context-body {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 25;
  display: grid;
  gap: 14px;
  width: min(720px, calc(100vw - 56px));
  border: 1px solid var(--border-strong);
  border-radius: 18px;
  background: var(--surface);
  padding: 16px;
  box-shadow: var(--shadow-popover);
}

.project-context-body .field-stack > span:first-child {
  color: var(--muted);
  font-size: 12px;
  font-weight: 720;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.project-context-body input,
.project-context-body select {
  min-height: 40px;
  background: var(--surface);
  font-size: 14px;
}

.project-home-section {
  display: grid;
  gap: 10px;
}

.project-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.project-section-heading h3 {
  color: var(--text);
  font-size: 13px;
  font-weight: 740;
}

.project-section-heading p {
  color: var(--muted);
  font-size: 12px;
}

.project-card-grid,
.recent-session-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.start-suggestion-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.start-suggestion-grid button {
  border-color: var(--border);
  border-radius: 999px;
  color: var(--text-soft);
  background: rgb(255 253 250 / 0.66);
  padding: 8px 12px;
  font-size: 13px;
}

.start-suggestion-grid button:hover {
  border-color: #d7b8a9;
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.project-card,
.recent-session-card {
  display: grid;
  gap: 5px;
  min-width: 0;
  border-color: var(--border);
  background: rgb(255 253 250 / 0.68);
  padding: 11px 12px;
  text-align: left;
}

.project-card:hover,
.recent-session-card:hover {
  border-color: #d7b8a9;
  background: var(--accent-soft);
}

.project-card strong,
.recent-session-card strong {
  min-width: 0;
  color: var(--text);
  font-size: 13px;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.project-card span,
.project-card small {
  min-width: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card small {
  color: var(--muted-soft);
}

.advanced-session-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.recent-session-card {
  min-height: 92px;
}

.recent-session-card .status {
  margin-top: -1px;
}

@media (max-width: 900px) {
  .conversation-header {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .conversation-title-row,
  .worktree-status-heading {
    flex-wrap: wrap;
  }

  .project-card-grid,
  .recent-session-grid,
  .advanced-session-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .project-home {
    padding: 28px 14px;
  }

  .start-composer-input,
  .project-card-grid,
  .recent-session-grid,
  .advanced-session-grid {
    grid-template-columns: 1fr;
  }

  .start-composer-input .primary-action {
    justify-self: end;
  }

  .project-context-body {
    left: auto;
    right: 0;
    width: calc(100vw - 28px);
  }

  .project-section-heading {
    display: grid;
    gap: 3px;
  }
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm --prefix web test -- App.test.tsx --run
```

Expected: PASS for `App.test.tsx`.

- [ ] **Step 3: Commit styling**

```bash
git add web/src/App.css
git commit -m "style: polish Claude start surface"
```

---

### Task 5: Review docs and run full frontend verification

**Files:**
- Review: `README.md`
- Review: `CLAUDE.md`
- Possibly modify: `README.md`
- Possibly modify: `CLAUDE.md`

- [ ] **Step 1: Check whether docs mention the old new-chat form**

Run:

```bash
grep -R "Where should Claude work\|Workspace context\|Start chat\|new chat" -n README.md CLAUDE.md docs | head -80
```

Expected: Any hits in `docs/superpowers/specs/2026-06-14-claude-start-surface-design.md` are fine. If `README.md` or `CLAUDE.md` describes the old start form, update it in Step 2.

- [ ] **Step 2: Update README/CLAUDE only if stale user-facing wording exists**

If `README.md` contains old new-chat wording, replace it with:

```md
The new chat surface starts with a Claude-style prompt composer. Project path, worktree, and permission mode are available from Project context so the user can start with the task first and adjust launch context only when needed.
```

If `CLAUDE.md` contains old new-chat wording, replace it with:

```md
The new chat surface should stay task-first: lead with what the user wants Claude to do, and keep cwd/worktree/permission controls as project context rather than primary launch fields.
```

If neither file has stale wording, do not edit either file.

- [ ] **Step 3: Run frontend tests**

Run:

```bash
npm --prefix web test
```

Expected: PASS.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 5: Commit documentation updates if any were made**

If `README.md` or `CLAUDE.md` changed:

```bash
git add README.md CLAUDE.md
git commit -m "docs: note task-first start surface"
```

If neither file changed, do not create a commit.

---

### Task 6: Manual UI verification in the browser

**Files:**
- Modify only if verification finds a bug: `web/src/ProjectHome.tsx`, `web/src/App.css`, `web/src/useSessions.ts`, `web/src/App.tsx`, `web/src/App.test.tsx`

- [ ] **Step 1: Start the app with the project preview tool**

Use the app's normal preview launch configuration. If `.claude/launch.json` is missing, create a minimal launch config for the web dev server before starting preview.

Expected: preview opens the local web UI without build errors.

- [ ] **Step 2: Verify first impression**

In the browser, open the new chat/start surface.

Expected:
- The heading is “What would you like Claude to do?”
- The focused control is the large prompt composer.
- The cwd input is not visible until `Change` is opened.
- Context chips show project, worktree, and permission.

- [ ] **Step 3: Verify suggestions**

Click `Review changes`.

Expected:
- The start prompt becomes `Review changes`.
- No session is created until Send is clicked.

- [ ] **Step 4: Verify project context disclosure**

Click `Change`.

Expected:
- `Workspace context`, recent projects, `Use git worktree`, and `Permission mode` are visible.
- Clicking a recent project updates the `Project: ...` chip.
- The disclosure works on narrow/mobile viewport without clipping critical controls.

- [ ] **Step 5: Verify session creation with initial prompt**

Enter a valid prompt and project context, then click Send.

Expected:
- A session opens.
- The first prompt is sent to Claude.
- The app does not show the old “Where should Claude work?” heading.

- [ ] **Step 6: Fix any manual verification bug with a focused test first**

For each bug found, add or update a failing test in `web/src/App.test.tsx`, run:

```bash
npm --prefix web test -- App.test.tsx --run
```

Expected: FAIL for the bug. Then fix the smallest relevant code or CSS and rerun the same test until PASS.

- [ ] **Step 7: Commit manual-verification fixes if any were needed**

If verification required changes:

```bash
git add web/src/App.test.tsx web/src/ProjectHome.tsx web/src/App.css web/src/useSessions.ts web/src/App.tsx
git commit -m "fix: refine Claude start surface"
```

If no changes were needed, do not create a commit.

---

## Final Verification

- [ ] Run all frontend checks:

```bash
npm --prefix web test
npm --prefix web run build
```

Expected: both PASS.

- [ ] Check working tree status:

```bash
git status --short
```

Expected: clean, unless the user asked to leave changes uncommitted.

- [ ] Confirm README/CLAUDE review result in the final response: either list the docs updated, or state that both were reviewed and no updates were needed.
