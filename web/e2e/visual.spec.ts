import { expect, test, type Locator, type Page } from '@playwright/test';

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const baseSession = {
  permissionMode: 'acceptEdits',
  claudeSessionId: 'claude-visual-session',
  deletedAt: null,
  createdAt: '2026-06-11T00:00:00Z',
  updatedAt: '2026-06-11T03:00:00Z'
};

const sessions = [
  {
    ...baseSession,
    id: 's1',
    name: 'Visual Regression Session',
    cwd: '/Users/example/repos/claude-web-remote/packages/web-with-a-very-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  },
  {
    ...baseSession,
    id: 's2',
    name: 'Worktree With Long Branch',
    cwd: '/Users/example/repos/claude-web-remote/.claude/worktrees/visual-long-path',
    status: 'running',
    runtimeStatus: 'running',
    worktree: {
      sourceCwd: '/Users/example/repos/claude-web-remote',
      worktreeCwd: '/Users/example/repos/claude-web-remote/.claude/worktrees/visual-long-path',
      branch: 'pin/visual-responsive-layout-validation-with-long-branch-name',
      createdByClaudeRemoteWeb: true
    }
  },
  {
    ...baseSession,
    id: 's3',
    name: 'Stopped Session',
    cwd: '/Users/example/repos/stopped-project-with-a-long-directory-name',
    status: 'stopped',
    runtimeStatus: 'stopped',
    claudeSessionId: 'claude-visual-stopped-session'
  },
  {
    ...baseSession,
    id: 's4',
    name: 'Empty Conversation Starter',
    cwd: '/Users/example/repos/empty-state-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  },
  {
    ...baseSession,
    id: 's5',
    name: 'No Tasks Session',
    cwd: '/Users/example/repos/no-task-state-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  },
  {
    ...baseSession,
    id: 's6',
    name: 'Failed Tool Session',
    cwd: '/Users/example/repos/failed-tool-output-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  }
];

const archivedSessions = [
  {
    ...baseSession,
    id: 'archived-1',
    name: 'Archived Visual Session With A Long Name',
    cwd: '/Users/example/repos/archived-project-with-a-very-long-directory-name',
    status: 'stopped',
    runtimeStatus: 'stopped',
    claudeSessionId: 'claude-visual-archived-session',
    deletedAt: '2026-06-12T01:00:00Z',
    updatedAt: '2026-06-12T01:00:00Z'
  }
];

const taskGroups = {
  background: [
    {
      id: 's1:bg-bash',
      sessionId: 's1',
      sessionName: 'Visual Regression Session',
      sessionCwd: sessions[0].cwd,
      toolKind: 'Bash',
      title: 'Bash: npm --prefix web run test:visual -- --project=wide-desktop',
      status: 'background',
      startedAt: '2026-06-12T00:00:00Z',
      finishedAt: null,
      startEventId: 5,
      finishEventId: null,
      summary: 'Running visual smoke checks in the background'
    }
  ],
  finished: [
    {
      id: 's1:agent-review',
      sessionId: 's1',
      sessionName: 'Visual Regression Session',
      sessionCwd: sessions[0].cwd,
      toolKind: 'Agent',
      title: 'Agent: inspect responsive Claude-like output rendering for overlap and overflow with a deliberately long task title',
      status: 'completed',
      startedAt: '2026-06-12T00:01:00Z',
      finishedAt: '2026-06-12T00:02:00Z',
      startEventId: 7,
      finishEventId: 8,
      summary: 'Checked sidebar, inspector, composer, conversation blocks, task cards, and long summaries that must wrap without widening the inspector.'
    },
    {
      id: 's6:failed-bash',
      sessionId: 's6',
      sessionName: 'Failed Tool Session',
      sessionCwd: sessions[5].cwd,
      toolKind: 'Bash',
      title: 'Bash: npm --prefix web run build -- --simulate-failure-with-a-long-command-title',
      status: 'failed',
      startedAt: '2026-06-12T00:03:00Z',
      finishedAt: '2026-06-12T00:03:30Z',
      startEventId: 20,
      finishEventId: 21,
      summary: 'Command failed with exit code 1 after emitting a long diagnostic line that should wrap without expanding the task inspector.'
    }
  ]
};

const longToken = 'supercalifragilisticexpialidocious'.repeat(8);

const visualEvents = [
  {
    id: 1,
    sessionId: 's1',
    time: '2026-06-12T00:00:00Z',
    kind: 'user',
    payload: { type: 'text', text: 'Please validate the Claude-like output rendering across breakpoints.' }
  },
  {
    id: 2,
    sessionId: 's1',
    time: '2026-06-12T00:00:01Z',
    kind: 'assistant',
    payload: {
      message:
        `I will inspect the session timeline, run browser layout checks, and keep raw event details collapsed for replay. A long token should wrap safely: ${longToken}.`
    }
  },
  {
    id: 3,
    sessionId: 's1',
    time: '2026-06-12T00:00:02Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-bash',
      name: 'Bash',
      input: {
        command: 'git status --short',
        description: 'Inspect working tree state'
      }
    }
  },
  {
    id: 4,
    sessionId: 's1',
    time: '2026-06-12T00:00:03Z',
    kind: 'tool',
    payload: {
      type: 'tool_result',
      tool_use_id: 'tool-bash',
      content: ' M web/e2e/visual.spec.ts\n M web/src/App.css'
    }
  },
  {
    id: 5,
    sessionId: 's1',
    time: '2026-06-12T00:00:04Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-bash-bg',
      name: 'Bash',
      input: {
        command: 'npm --prefix web run test:visual -- --project=wide-desktop',
        description: 'Run browser visual layout verification',
        run_in_background: true
      }
    }
  },
  {
    id: 6,
    sessionId: 's1',
    time: '2026-06-12T00:00:05Z',
    kind: 'tool',
    payload: {
      type: 'tool_result',
      tool_use_id: 'tool-bash-bg',
      content: 'Task started in background with ID visual-layout. Output file: /tmp/visual-layout-output.log'
    }
  },
  {
    id: 7,
    sessionId: 's1',
    time: '2026-06-12T00:00:06Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-agent',
      name: 'Agent',
      input: {
        description: 'Inspect responsive UI affordances with long task summaries',
        subagent_type: 'reviewer'
      }
    }
  },
  {
    id: 8,
    sessionId: 's1',
    time: '2026-06-12T00:00:07Z',
    kind: 'tool',
    payload: {
      type: 'tool_result',
      tool_use_id: 'tool-agent',
      content:
        'No blocking issues found. The inspector and conversation can scroll independently when content gets tall.'
    }
  },
  {
    id: 9,
    sessionId: 's1',
    time: '2026-06-12T00:00:08Z',
    kind: 'assistant',
    payload: {
      message:
        'The visible conversation now includes ordinary text, compact tool activity, background Bash activity, Agent task activity, and a deliberately long token: /Users/example/repos/claude-web-remote/web/src/components/really-long-path/branch-pin-visual-responsive-layout-validation-with-long-branch-name.tsx'
    }
  },
  {
    id: 20,
    sessionId: 's6',
    time: '2026-06-12T00:03:00Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-failed-bash',
      name: 'Bash',
      input: {
        command:
          'npm --prefix web run build -- --simulate-failure-with-a-long-command-title-and-a-path=/Users/example/repos/claude-web-remote/web/src/components/really-long-path/failure-case.tsx',
        description: 'Run a command that returns a visible failure block'
      }
    }
  },
  {
    id: 21,
    sessionId: 's6',
    time: '2026-06-12T00:03:01Z',
    kind: 'tool',
    payload: {
      type: 'tool_result',
      tool_use_id: 'tool-failed-bash',
      is_error: true,
      content:
        'Error: command failed with exit code 1\nstderr: missing file /Users/example/repos/claude-web-remote/web/src/components/really-long-path/failure-case.tsx\n' +
        longToken
    }
  }
];

const configResponse = {
  path: '/Users/example/.claude-remote-web/config.toml',
  exists: true,
  current: {
    bind: '127.0.0.1:8787',
    dataDir: '/Users/example/.claude-remote-web',
    launcher: ['ttadk', 'claude', '-m', 'gpt-5.5', '--skip-check', '-a'],
    webDir: '/Users/example/repos/claude-web-remote/web/dist',
    defaultPermissionMode: 'acceptEdits',
    worktreesDir: '/Users/example/repos/claude-web-remote/.claude/worktrees',
    worktreeBranchPrefix: 'pin',
    worktreeBaseRef: 'fresh'
  },
  file: {
    bind: '127.0.0.1:8787',
    dataDir: '/Users/example/.claude-remote-web',
    launcher: ['ttadk', 'claude', '-m', 'gpt-5.5', '--skip-check', '-a'],
    webDir: '/Users/example/repos/claude-web-remote/web/dist',
    defaultPermissionMode: 'acceptEdits',
    worktreesDir: '/Users/example/repos/claude-web-remote/.claude/worktrees',
    worktreeBranchPrefix: 'pin',
    worktreeBaseRef: 'fresh'
  },
  restartRequired: false
};

async function installApiMocks(page: Page) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body)
      });

    if (path === '/api/sessions' && request.method() === 'GET') {
      if (url.searchParams.get('deletedOnly') === 'true') {
        return json({ sessions: archivedSessions });
      }
      return json({ sessions });
    }
    if (path === '/api/tasks') {
      return json(taskGroups);
    }
    if (path === '/api/sessions/s1/tasks') {
      return json({ background: taskGroups.background, finished: [taskGroups.finished[0]] });
    }
    if (path === '/api/sessions/s6/tasks') {
      return json({ background: [], finished: [taskGroups.finished[1]] });
    }
    if (path === '/api/config') {
      return json(configResponse);
    }
    if (path.endsWith('/tasks')) {
      return json({ background: [], finished: [] });
    }
    if (path.endsWith('/input') && request.method() === 'POST') {
      return json({ ok: true, session: null });
    }
    if (path.endsWith('/stop') && request.method() === 'POST') {
      return json({ ok: true });
    }
    return json({ error: `unexpected visual test request: ${request.method()} ${path}` }, 500);
  });
}

async function installWebSocketMock(page: Page) {
  await page.addInitScript((events) => {
    class VisualWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      url: string;
      readyState = VisualWebSocket.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        window.setTimeout(() => {
          this.readyState = VisualWebSocket.OPEN;
          this.onopen?.(new Event('open'));
          const url = new URL(this.url);
          const sessionMatch = url.pathname.match(/\/api\/sessions\/([^/]+)\/events/);
          const sessionId = sessionMatch?.[1];
          const visibleEvents = (events as { sessionId?: string }[]).filter((event) => event.sessionId === sessionId);
          for (const event of visibleEvents) {
            this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(event) }));
          }
        }, 25);
      }

      send() {}

      close() {
        this.readyState = VisualWebSocket.CLOSED;
        this.onclose?.(new CloseEvent('close'));
      }

      addEventListener(type: string, listener: EventListener) {
        if (type === 'open') this.onopen = listener as (event: Event) => void;
        if (type === 'message') this.onmessage = listener as (event: MessageEvent) => void;
        if (type === 'close') this.onclose = listener as (event: CloseEvent) => void;
        if (type === 'error') this.onerror = listener as (event: Event) => void;
      }

      removeEventListener() {}
    }

    window.WebSocket = VisualWebSocket as unknown as typeof WebSocket;
  }, visualEvents);
}

function intersectionArea(a: Box, b: Box) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

async function boxFor(locator: Locator, name: string): Promise<Box> {
  await expect(locator, `${name} should be attached`).toBeAttached();
  const visibility = await locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { display: style.display, visibility: style.visibility };
  });
  expect(visibility.display, `${name} should not be display:none`).not.toBe('none');
  expect(visibility.visibility, `${name} should not be hidden`).not.toBe('hidden');
  const box = await locator.boundingBox();
  expect(box, `${name} should have a rendered box`).not.toBeNull();
  expect(box!.width, `${name} width`).toBeGreaterThan(0);
  expect(box!.height, `${name} height`).toBeGreaterThan(0);
  return box!;
}

async function expectNoMeaningfulOverlap(first: Locator, second: Locator, label: string) {
  const firstBox = await boxFor(first, `${label} first`);
  const secondBox = await boxFor(second, `${label} second`);
  const overlap = intersectionArea(firstBox, secondBox);
  const allowed = Math.min(firstBox.width * firstBox.height, secondBox.width * secondBox.height) * 0.01;
  expect(overlap, label).toBeLessThanOrEqual(Math.max(1, allowed));
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth;
  });
  expect(overflow, 'page should not create horizontal viewport overflow').toBeLessThanOrEqual(1);
}

async function expectViewportContains(locator: Locator, name: string) {
  const box = await boxFor(locator, name);
  expect(box.x + box.width, `${name} should not render past the right viewport edge`).toBeLessThanOrEqual(
    test.info().project.use.viewport!.width + 1
  );
  expect(box.x, `${name} should not render past the left viewport edge`).toBeGreaterThanOrEqual(-1);
}

async function expectNoHorizontalElementOverflow(locator: Locator, name: string) {
  const overflow = await locator.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow, `${name} should not create horizontal element overflow`).toBeLessThanOrEqual(1);
}

async function expectComposerPinnedBelowEvents(page: Page) {
  const eventsBox = await boxFor(page.locator('.events'), 'conversation event stream');
  const composerBox = await boxFor(page.getByRole('form', { name: 'Message composer' }), 'composer');
  expect(composerBox.y, 'composer should sit below the scrollable event stream').toBeGreaterThanOrEqual(
    eventsBox.y + eventsBox.height - 1
  );
}

async function showInspectorIfNeeded(page: Page) {
  const inspector = page.getByRole('complementary', { name: 'Session inspector' });
  const showInspector = inspector.getByRole('button', { name: 'Show inspector' });
  if (await showInspector.isVisible()) {
    await showInspector.click();
  }
  await expect(inspector.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
  return inspector;
}

test.beforeEach(async ({ page }) => {
  await installWebSocketMock(page);
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.locator('button.session', { hasText: 'Visual Regression Session' })).toBeVisible();
  await expect(page.locator('.message-block.assistant').first()).toContainText('browser layout checks');
  await expect(page.locator('.tool-block')).toHaveCount(1);
  await expect(page.locator('.task-block')).toHaveCount(2);
});

test('Claude-like UI stays readable across key viewports', async ({ page }) => {
  const rail = page.getByRole('navigation', { name: 'Primary navigation' });
  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const inspector = page.getByRole('complementary', { name: 'Session inspector' });
  const composer = page.getByRole('form', { name: 'Message composer' });
  const events = page.locator('.events');

  await boxFor(rail, 'primary rail');
  await boxFor(sidebar, 'session sidebar');
  await boxFor(workspace, 'conversation workspace');
  await boxFor(events, 'conversation event stream');
  await boxFor(composer, 'composer');
  await expect(page.locator('.message-block.assistant').first()).toContainText('browser layout checks');
  await expect(page.locator('.tool-block.completed')).toContainText('Bash');
  await expect(page.locator('.tool-block.completed')).toContainText('git status --short');
  await expect(page.locator('.task-block.running')).toContainText('Run browser visual layout verification');
  await expect(page.locator('.task-block.completed')).toContainText('Inspect responsive UI affordances');
  await expect(page.getByRole('button', { name: /Stopped Session/ })).toContainText('Stopped');

  await expectNoHorizontalPageOverflow(page);
  await expectViewportContains(composer, 'composer');
  await expectComposerPinnedBelowEvents(page);
  await expectNoHorizontalElementOverflow(events, 'event stream');

  const viewport = test.info().project.use.viewport!;
  if (viewport.width > 1020) {
    await boxFor(inspector, 'session inspector');
    await expect(inspector.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Session tasks' })).toContainText('visual smoke checks');
    await expectNoMeaningfulOverlap(sidebar, workspace, 'sidebar and workspace');
    await expectNoMeaningfulOverlap(workspace, inspector, 'workspace and inspector');
  } else {
    await expectNoMeaningfulOverlap(sidebar, workspace, 'sidebar and workspace');

    const beforeOpenWorkspace = await boxFor(workspace, 'workspace before inspector opens');
    const showInspector = inspector.getByRole('button', { name: 'Show inspector' });
    if (await showInspector.isVisible()) {
      await showInspector.click();
    }
    await expect(inspector.getByRole('button', { name: 'Hide', exact: true })).toBeVisible();
    await expect(page.getByRole('tabpanel', { name: 'Session tasks' })).toContainText('visual smoke checks');
    const afterOpenWorkspace = await boxFor(workspace, 'workspace after inspector opens');
    expect(
      Math.abs(afterOpenWorkspace.width - beforeOpenWorkspace.width),
      'opening inspector on constrained viewports should not shrink the chat workspace'
    ).toBeLessThanOrEqual(1);
    await expectViewportContains(inspector, 'inspector drawer');
  }
});

test('conversation content can scroll to the final block without composer obstruction', async ({ page }) => {
  const events = page.locator('.events');
  const finalMessage = page.locator('.message-block.assistant').last();
  await events.evaluate((element) => {
    element.style.scrollBehavior = 'auto';
    element.scrollTop = element.scrollHeight;
  });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  const finalBox = await boxFor(finalMessage, 'final assistant message');
  const eventsBox = await boxFor(events, 'event stream');
  const composerBox = await boxFor(page.getByRole('form', { name: 'Message composer' }), 'composer');

  expect(finalBox.y + finalBox.height, 'final block should remain within the scrollable event viewport').toBeLessThanOrEqual(
    eventsBox.y + eventsBox.height + 1
  );
  expect(intersectionArea(finalBox, composerBox), 'composer should not cover the final conversation block').toBeLessThanOrEqual(1);
});

test('autocomplete remains within the composer and viewport', async ({ page }) => {
  const message = page.getByRole('textbox', { name: 'Message' });
  await message.fill('/he');
  const autocomplete = page.getByRole('listbox', { name: 'Claude command suggestions' });
  await expect(autocomplete).toContainText('/help');

  await expectViewportContains(autocomplete, 'autocomplete');
  await expectNoHorizontalPageOverflow(page);

  const composerBox = await boxFor(page.getByRole('form', { name: 'Message composer' }), 'composer');
  const autocompleteBox = await boxFor(autocomplete, 'autocomplete');
  expect(autocompleteBox.x, 'autocomplete should align with composer left edge').toBeGreaterThanOrEqual(composerBox.x - 1);
  expect(
    autocompleteBox.x + autocompleteBox.width,
    'autocomplete should align with composer right edge'
  ).toBeLessThanOrEqual(composerBox.x + composerBox.width + 1);
  expect(
    autocompleteBox.y + autocompleteBox.height,
    'autocomplete should stay above the textarea instead of covering typed text'
  ).toBeLessThanOrEqual(composerBox.y + composerBox.height);
});

test('empty conversation starter stays visible without colliding with composer', async ({ page }) => {
  await page.getByRole('button', { name: /Empty Conversation Starter/ }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const starter = page.getByRole('region', { name: 'Conversation starter' });
  const composer = page.getByRole('form', { name: 'Message composer' });

  await expect(starter).toContainText('What would you like Claude to do?');
  await boxFor(starter, 'empty conversation starter');
  await expectViewportContains(composer, 'empty-state composer');
  await expectNoHorizontalPageOverflow(page);
  await expectNoMeaningfulOverlap(starter, composer, 'empty starter and composer');
});

test('archived session view stays readable and read-only', async ({ page }) => {
  await page.getByRole('button', { name: 'Archived sessions' }).click();

  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const archivedSession = page.getByRole('button', { name: /Archived Visual Session/ });
  const composer = page.getByRole('form', { name: 'Message composer' });

  await expect(archivedSession).toBeVisible();
  await expect(archivedSession).toContainText('Stopped');
  await expect(workspace).toContainText('Archived Claude session');
  await expect(workspace).toContainText('This session is archived. Unarchive it before resuming work or sending messages.');
  await expect(composer.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(composer).toContainText('Archived sessions are read-only. Unarchive to continue.');
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

  await boxFor(sidebar, 'archived session sidebar');
  await boxFor(workspace, 'archived conversation workspace');
  await expectViewportContains(composer, 'archived composer');
  await expectNoHorizontalPageOverflow(page);
  await expectComposerPinnedBelowEvents(page);
});

test('config view fits without chat composer or inspector collisions', async ({ page }) => {
  await page.getByRole('button', { name: 'Config' }).click();

  const workspace = page.getByRole('main', { name: 'Configuration workspace' });
  const configPanel = page.locator('.config-panel');
  const configForm = page.locator('.config-form');

  await expect(workspace).toContainText('Daemon config');
  await expect(workspace).toContainText('/Users/example/.claude-remote-web/config.toml');
  await expect(page.getByLabel('Bind address')).toHaveValue('127.0.0.1:8787');
  await expect(page.getByLabel('Launcher argv')).toHaveValue('ttadk\nclaude\n-m\ngpt-5.5\n--skip-check\n-a');
  await expect(page.getByLabel('Worktrees directory')).toHaveValue(
    '/Users/example/repos/claude-web-remote/.claude/worktrees'
  );
  await expect(page.getByRole('button', { name: 'Save config' })).toBeVisible();

  await boxFor(workspace, 'config workspace');
  await boxFor(configPanel, 'config panel');
  await boxFor(configForm, 'config form');
  await expectNoHorizontalPageOverflow(page);
  await expectNoHorizontalElementOverflow(workspace, 'config workspace');
  await expect(page.getByRole('form', { name: 'Message composer' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Session inspector' })).toHaveCount(0);
});

test('failed tool output stays diagnosable without widening layout', async ({ page }) => {
  await page.getByRole('button', { name: /Failed Tool Session/ }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const failedTool = page.locator('.tool-block.failed');
  const events = page.locator('.events');
  const inspector = await showInspectorIfNeeded(page);

  await expect(failedTool).toContainText('Bash');
  await expect(failedTool).toContainText('failed');
  await expect(failedTool).toContainText('exit code 1');
  await expect(failedTool.locator('.visible-result')).toContainText('missing file');
  const sessionTasks = page.getByRole('tabpanel', { name: 'Session tasks' });
  await expect(sessionTasks.locator('.task-card.failed')).toContainText('Command failed with exit code 1');
  await expect(sessionTasks).toContainText('failed');

  await boxFor(failedTool, 'failed tool block');
  await expectNoHorizontalPageOverflow(page);
  await expectNoHorizontalElementOverflow(events, 'failed event stream');
  await expectViewportContains(inspector, 'failed inspector');
  await expectComposerPinnedBelowEvents(page);
});

test('long multiline composer drafts cap height and stay inside the viewport', async ({ page }) => {
  const message = page.getByRole('textbox', { name: 'Message' });
  const composer = page.getByRole('form', { name: 'Message composer' });
  const lines = Array.from({ length: 24 }, (_, index) => {
    return `Line ${index + 1}: please keep this multiline composer draft readable with ${longToken}`;
  });

  await message.fill(lines.join('\n'));
  await expect(composer).toContainText('Ready to send');
  await expect(message).toHaveValue(lines.join('\n'));

  const textareaBox = await boxFor(message, 'long multiline textarea');
  expect(textareaBox.height, 'textarea should cap tall multiline drafts').toBeLessThanOrEqual(221);
  const overflow = await message.evaluate((element) => ({
    verticalOverflow: element.scrollHeight - element.clientHeight,
    overflowY: window.getComputedStyle(element).overflowY
  }));
  expect(overflow.verticalOverflow, 'textarea should have internal vertical overflow for long drafts').toBeGreaterThan(0);
  expect(overflow.overflowY, 'textarea should scroll internally once capped').toBe('auto');

  await expectViewportContains(composer, 'long multiline composer');
  await expectNoHorizontalPageOverflow(page);
});

test('empty search results and no-task inspector states stay stable', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  await search.fill('definitely-no-session-matches-this-query');

  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  await expect(sidebar).toContainText('No sessions match "definitely-no-session-matches-this-query".');
  await expectNoHorizontalPageOverflow(page);
  await expectNoHorizontalElementOverflow(sidebar, 'empty search sidebar');

  await page.getByRole('button', { name: 'Clear' }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await page.getByRole('button', { name: /No Tasks Session/ }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const inspector = await showInspectorIfNeeded(page);
  const sessionTasks = page.getByRole('tabpanel', { name: 'Session tasks' });
  await expect(sessionTasks).toContainText('No tasks yet.');
  await boxFor(sessionTasks, 'empty session tasks panel');

  await page.getByRole('tab', { name: 'All tasks' }).click();
  await expect(page.getByRole('tabpanel', { name: 'All tasks' })).toContainText('Running visual smoke checks');

  await expectViewportContains(inspector, 'no-task inspector');
  await expectNoHorizontalPageOverflow(page);
});
