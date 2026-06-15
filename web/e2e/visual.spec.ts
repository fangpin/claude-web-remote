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
    id: 's-starting',
    name: 'Starting Session',
    cwd: '/Users/example/repos/starting-session-validation-with-long-directory-name',
    status: 'starting',
    runtimeStatus: 'starting',
    claudeSessionId: null
  },
  {
    ...baseSession,
    id: 's-markdown',
    name: 'Markdown Diff Review',
    cwd: '/Users/example/repos/markdown-rendering-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  },
  {
    ...baseSession,
    id: 's-risk',
    name: 'Waiting Risk Review',
    cwd: '/Users/example/repos/risk-review-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
  },
  {
    ...baseSession,
    id: 's-long',
    name: 'Long Conversation Scroll',
    cwd: '/Users/example/repos/long-conversation-scroll-validation-with-long-directory-name',
    status: 'running',
    runtimeStatus: 'waiting'
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
    status: 'failed',
    runtimeStatus: 'failed'
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
      sessionCwd: sessions.find((session) => session.id === 's6')!.cwd,
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

const markdownDiff = `diff --git a/web/src/App.css b/web/src/App.css
index 1d2c3a4..5e6f7b8 100644
--- a/web/src/App.css
+++ b/web/src/App.css
@@ -42,7 +42,9 @@
 .conversation-workspace {
-  background: var(--panel);
+  background: linear-gradient(180deg, var(--panel), var(--panel-muted));
+  border: 1px solid var(--hairline);
+  box-shadow: var(--native-shadow);
 }
`;

const longConversationEvents = Array.from({ length: 96 }, (_, index) => {
  const id = 1000 + index;
  const turn = index + 1;
  const role = index % 2 === 0 ? 'user' : 'assistant';
  return {
    id,
    sessionId: 's-long',
    time: `2026-06-12T01:${String(Math.floor(index / 2)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}Z`,
    kind: role,
    payload: {
      message:
        role === 'user'
          ? `Long scroll checkpoint ${turn}: verify the latest exchange remains reachable above the composer.`
          : `Claude response ${turn}: the conversation keeps a stable internal scroll position while older events are hidden.`
    }
  };
});

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
  },
  {
    id: 22,
    sessionId: 's6',
    time: '2026-06-12T00:03:02Z',
    kind: 'error',
    payload: {
      message: 'The daemon lost the Claude child process after the failed command. Restart from this checkpoint.'
    }
  },
  {
    id: 40,
    sessionId: 's-markdown',
    time: '2026-06-12T00:04:00Z',
    kind: 'user',
    payload: { message: 'Show the visual baseline diff and explain the markdown rendering.' }
  },
  {
    id: 41,
    sessionId: 's-markdown',
    time: '2026-06-12T00:04:01Z',
    kind: 'assistant',
    payload: {
      message:
        '## Visual baseline review\n\nThe chat surface should stay focused on the transcript while preserving rich rendering.\n\n- Markdown lists wrap inside the message bubble.\n- Inline `code` remains readable.\n- Fenced code uses the shared code frame.\n\n```tsx\nfunction BaselineCard() {\n  return <article className="conversation-block">Stable scene</article>;\n}\n```'
    }
  },
  {
    id: 42,
    sessionId: 's-markdown',
    time: '2026-06-12T00:04:02Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-edit-diff',
      name: 'Edit',
      input: {
        file_path: '/Users/example/repos/claude-web-remote/web/src/App.css',
        old_string: 'background: var(--panel);',
        new_string: 'background: linear-gradient(180deg, var(--panel), var(--panel-muted));'
      }
    }
  },
  {
    id: 43,
    sessionId: 's-markdown',
    time: '2026-06-12T00:04:03Z',
    kind: 'tool',
    payload: {
      type: 'tool_result',
      tool_use_id: 'tool-edit-diff',
      content: markdownDiff
    }
  },
  {
    id: 60,
    sessionId: 's-risk',
    time: '2026-06-12T00:05:00Z',
    kind: 'user',
    payload: { message: 'Pause here and review the risk before applying changes.' }
  },
  {
    id: 61,
    sessionId: 's-risk',
    time: '2026-06-12T00:05:01Z',
    kind: 'assistant',
    payload: {
      message:
        '## Risk review\n\nClaude is waiting for approval before touching shared state.\n\n1. Confirm no production UI mock branch is introduced.\n2. Keep snapshots deterministic and generated from fixture data.\n3. Run visual tests after updating baselines.'
    }
  },
  {
    id: 62,
    sessionId: 's-risk',
    time: '2026-06-12T00:05:02Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'risk-review-agent',
      name: 'Agent',
      input: {
        description: 'Review risk before applying visual baseline changes',
        subagent_type: 'code-reviewer'
      }
    }
  }
].concat(longConversationEvents);

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
    const transcriptMatch = path.match(/^\/api\/sessions\/([^/]+)\/transcript$/);
    if (transcriptMatch) {
      const sessionId = transcriptMatch[1];
      const afterId = Number(url.searchParams.get('afterId') ?? '0');
      const beforeId = Number(url.searchParams.get('beforeId') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '0');
      let events = visualEvents.filter((event) => event.sessionId === sessionId && event.id > afterId);
      if (beforeId > 0) events = events.filter((event) => event.id < beforeId);
      if (limit > 0 && events.length > limit) events = events.slice(-limit);
      return json({ events });
    }
    if (path === '/api/sessions/s1/tasks') {
      return json({ background: taskGroups.background, finished: [taskGroups.finished[0]] });
    }
    if (path === '/api/sessions/s6/tasks') {
      return json({ background: [], finished: [taskGroups.finished[1]] });
    }
    if (path === '/api/sessions/s-risk/tasks') {
      return json({
        background: [
          {
            id: 's-risk:agent-review',
            sessionId: 's-risk',
            sessionName: 'Waiting Risk Review',
            sessionCwd: '/Users/example/repos/risk-review-validation-with-long-directory-name',
            toolKind: 'Agent',
            title: 'Agent: Review risk before applying visual baseline changes',
            status: 'background',
            startedAt: '2026-06-12T00:05:02Z',
            finishedAt: null,
            startEventId: 62,
            finishEventId: null,
            summary: 'Waiting for human approval before applying visual fixture updates.'
          }
        ],
        finished: []
      });
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

function sessionRow(page: Page, name: string): Locator {
  return page.locator('button.session', { hasText: name });
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

async function expectCompactInspector(page: Page, name: string) {
  const inspector = page.getByRole('complementary', { name: 'Session inspector' });
  await boxFor(inspector, name);
  await expectViewportContains(inspector, name);
  await expect(inspector.getByRole('button', { name: 'Hide inspector' })).toBeVisible();
  return inspector;
}

async function prepareForScreenshot(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector<HTMLElement>('.events')?.style.setProperty('scroll-behavior', 'auto');
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function expectVisualSnapshot(page: Page, name: string) {
  await prepareForScreenshot(page);
  await expect(page).toHaveScreenshot(name);
}

async function selectSession(page: Page, name: RegExp | string) {
  await page.locator('button.session').filter({ hasText: name }).first().evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
}

function isProject(name: string) {
  return test.info().project.name === name;
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
  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const composer = page.getByRole('form', { name: 'Message composer' });
  const events = page.locator('.events');

  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
  await boxFor(sidebar, 'session sidebar');
  await boxFor(workspace, 'conversation workspace');
  await boxFor(events, 'conversation event stream');
  await boxFor(composer, 'composer');
  await expect(page.locator('.message-block.assistant').first()).toContainText('browser layout checks');
  await expect(page.locator('.tool-block.completed')).toContainText('Ran git status --short');
  await expect(page.locator('.tool-block.completed')).toContainText('git status --short');
  await expect(page.locator('.task-block.running')).toContainText('Run browser visual layout verification');
  await expect(page.locator('.task-block.completed')).toContainText('Inspect responsive UI affordances');
  await expect(sessionRow(page, 'Stopped Session')).toContainText('Stopped');

  await expectNoHorizontalPageOverflow(page);
  await expectViewportContains(composer, 'composer');
  await expectComposerPinnedBelowEvents(page);
  await expectNoHorizontalElementOverflow(events, 'event stream');

  await expectNoMeaningfulOverlap(sidebar, workspace, 'sidebar and workspace');
  const beforeOpenWorkspace = await boxFor(workspace, 'workspace before activity opens');
  await page.getByRole('button', { name: 'Open activity drawer' }).click();
  const activityDrawer = page.getByRole('complementary', { name: 'Activity drawer' });
  await boxFor(activityDrawer, 'activity drawer');
  await expect(activityDrawer.getByRole('button', { name: 'Close activity drawer' })).toBeVisible();
  await activityDrawer.getByRole('tab', { name: 'Tasks' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Tasks' })).toContainText('visual smoke checks');
  const afterOpenWorkspace = await boxFor(workspace, 'workspace after activity opens');
  expect(
    Math.abs(afterOpenWorkspace.width - beforeOpenWorkspace.width),
    'opening activity on current drawer implementation should not shrink the chat workspace'
  ).toBeLessThanOrEqual(1);
});

test('session actions live in the session row overflow menu', async ({ page }) => {
  const row = page.locator('.session-row', { hasText: 'Visual Regression Session' }).first();
  await expect(page.getByRole('main', { name: 'Conversation workspace' }).getByRole('button', { name: 'More session actions' })).toHaveCount(0);
  await row.getByRole('button', { name: 'More session actions' }).click();
  await expect(row.getByRole('menu', { name: 'Session actions' })).toBeVisible();
  await expect(row.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
  await expect(row.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
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
  await sessionRow(page, 'Empty Conversation Starter').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const starter = page.getByRole('region', { name: 'Conversation starter' });
  const composer = page.getByRole('form', { name: 'Message composer' });

  await expect(starter).toContainText('What would you like Claude to do?');
  await boxFor(starter, 'empty conversation starter');
  await expectViewportContains(composer, 'empty-state composer');
  await expectNoHorizontalPageOverflow(page);
  if (test.info().project.name !== 'narrow') {
    await expectNoMeaningfulOverlap(starter, composer, 'empty starter and composer');
  }
});

test('archived session view stays readable and read-only', async ({ page }) => {
  await page.getByRole('button', { name: 'Archived sessions' }).click();

  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  const workspace = page.getByRole('main', { name: 'Conversation workspace' });
  const archivedSession = sessionRow(page, 'Archived Visual Session');
  const composer = page.getByRole('form', { name: 'Message composer' });

  await expect(archivedSession).toBeVisible();
  await expect(archivedSession).toContainText('Stopped');
  await expect(workspace).toContainText('Archived Claude session');
  await expect(workspace).toContainText('This session is archived and read-only. Unarchive it before resuming work or sending messages.');
  await expect(composer.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  await expect(composer).toContainText('Archived sessions are read-only. Unarchive to continue.');
  await expect(page.getByRole('button', { name: 'Unarchive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

  await boxFor(sidebar, 'archived session sidebar');
  await boxFor(workspace, 'archived conversation workspace');
  await expectViewportContains(composer, 'archived composer');
  await expectNoHorizontalPageOverflow(page);
  await expectComposerPinnedBelowEvents(page);
});

test('config view fits without chat composer or inspector collisions', async ({ page }) => {
  await page.getByRole('button', { name: 'Config' }).click();

  const workspace = page.getByRole('main', { name: 'Configuration workspace' });
  const configPanel = page.locator('.settings-panel');
  const configForm = page.locator('.settings-form');

  await expect(workspace).toContainText('Daemon config');
  await expect(workspace).toContainText('Settings');
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
  await sessionRow(page, 'Failed Tool Session').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const failedTool = page.locator('.tool-block.failed');
  const events = page.locator('.events');

  await expect(failedTool).toContainText('Bash');
  await expect(failedTool).toContainText('failed');
  await expect(failedTool).toContainText('exit code 1');
  await expect(failedTool.locator('.visible-result')).toContainText('missing file');

  const viewport = test.info().project.use.viewport!;
  const inspector = viewport.width > 760
    ? await showInspectorIfNeeded(page)
    : await expectCompactInspector(page, 'failed compact inspector');
  if (viewport.width > 760) {
    const sessionTasks = page.getByRole('tabpanel', { name: 'Session tasks' });
    await expect(sessionTasks.locator('.task-card.failed')).toContainText('Command failed with exit code 1');
    await expect(sessionTasks).toContainText('failed');
  }

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

test.describe('screenshot baselines', () => {
  test('empty and starting chat states have stable baselines', async ({ page }) => {
    await selectSession(page, /Empty Conversation Starter/);
    await expect(page.getByRole('region', { name: 'Conversation starter' })).toContainText('What would you like Claude to do?');
    await expectVisualSnapshot(page, 'empty-start-conversation.png');

    if (!isProject('narrow')) {
      await selectSession(page, /Starting Session/);
      await expect(page.getByRole('form', { name: 'Message composer' })).toContainText(
        'Claude is starting. You can send once the session is ready.'
      );
      await expectVisualSnapshot(page, 'starting-session-disabled-composer.png');
    }
  });

  test('session list grouping, worktree pin branch, and archived mode have stable baselines', async ({ page }) => {
    const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
    await expect(sidebar).toContainText('Waiting');
    await expect(sidebar).toContainText('Running');
    await expect(sidebar).toContainText('Recent chats');
    await expect(sidebar).toContainText('pin/visual-responsive-layout-validation-with-long-branch-name');
    await expect(sidebar).toContainText('Failed');
    await expectVisualSnapshot(page, 'session-list-active-worktree-pin.png');

    await page.getByRole('button', { name: 'Archived sessions' }).click();
    await expect(sessionRow(page, 'Archived Visual Session')).toBeVisible();
    await expect(page.getByRole('main', { name: 'Conversation workspace' })).toContainText('Archived Claude session');
    await expectVisualSnapshot(page, 'session-list-archived-readonly.png');
  });

  test('active chat markdown, code, and diff rendering has a stable baseline', async ({ page }) => {
    test.skip(isProject('narrow'), 'covered by dedicated narrow composer and scroll baselines');

    await selectSession(page, /Markdown Diff Review/);
    await expect(page.getByRole('heading', { name: 'Visual baseline review' })).toBeVisible();
    await expect(page.locator('.message-code')).toContainText('BaselineCard');
    const diffDetails = page.locator('.tool-block.result-diff details.collapsed-result');
    await diffDetails.evaluate((element) => {
      (element as HTMLDetailsElement).open = true;
    });
    await expect(page.locator('.tool-result-pre.diff')).toContainText('native-shadow');
    await expectVisualSnapshot(page, 'active-chat-markdown-code-diff.png');
  });

  test('tool activity and inspector timelines have stable baselines', async ({ page }) => {
    test.skip(!isProject('wide-desktop'), 'inspector timeline baseline is kept to the widest stable viewport');

    const inspector = await showInspectorIfNeeded(page);
    await page.getByRole('tab', { name: 'Activity' }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByRole('tabpanel', { name: 'Activity' })).toContainText('Bash');
    await expect(page.getByRole('tabpanel', { name: 'Activity' })).toContainText('Agent');
    await expectVisualSnapshot(page, 'tool-activity-inspector-timeline.png');

    await page.getByRole('tab', { name: 'All tasks' }).evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByRole('tabpanel', { name: 'All tasks' })).toContainText('Running visual smoke checks');
    await expectViewportContains(inspector, 'all-tasks inspector');
    await expectVisualSnapshot(page, 'tool-activity-inspector-all-tasks.png');
  });

  test('waiting risk review state has a stable baseline', async ({ page }) => {
    test.skip(isProject('narrow'), 'narrow state is covered by mobile composer baselines');

    await selectSession(page, /Waiting Risk Review/);
    await expect(page.getByRole('heading', { name: 'Risk review', exact: true })).toBeVisible();
    await expect(page.locator('.task-block.running')).toContainText('Review risk before applying visual baseline changes');
    const inspector = await showInspectorIfNeeded(page);
    await expect(inspector).toContainText('Waiting for human approval');
    await expectVisualSnapshot(page, 'waiting-risk-review.png');
  });

  test('failed session and error state has a stable baseline', async ({ page }) => {
    test.skip(isProject('desktop'), 'failed state is covered on wide desktop and narrow breakpoints');

    await selectSession(page, /Failed Tool Session/);
    await expect(page.locator('.tool-block.failed')).toContainText('exit code 1');
    await expect(page.locator('.error-block')).toContainText('lost the Claude child process');
    if (isProject('narrow')) {
      await expectCompactInspector(page, 'failed compact inspector baseline');
    } else {
      await showInspectorIfNeeded(page);
    }
    await expectVisualSnapshot(page, 'failed-tool-and-error.png');
  });

  test('narrow multiline composer has a stable baseline', async ({ page }) => {
    test.skip(!isProject('narrow'), 'mobile composer baseline only runs in the narrow project');

    const message = page.getByRole('textbox', { name: 'Message' });
    const lines = Array.from({ length: 18 }, (_, index) => `Line ${index + 1}: keep the mobile composer native-like and scrollable.`);
    await message.fill(lines.join('\n'));
    await expect(page.getByRole('form', { name: 'Message composer' })).toContainText('Ready to send');
    await expectVisualSnapshot(page, 'narrow-composer-multiline.png');

    await message.fill('/he');
    await expect(page.getByRole('listbox', { name: 'Claude command suggestions' })).toContainText('/help');
    await expectVisualSnapshot(page, 'narrow-composer-autocomplete.png');
  });

  test('long conversation bottom scroll has a stable baseline', async ({ page }) => {
    await selectSession(page, /Long Conversation Scroll/);
    await expect(page.locator('.event-limit-note')).toContainText('Scroll up to load');
    const events = page.locator('.events');
    await events.evaluate((element) => {
      element.style.scrollBehavior = 'auto';
      element.scrollTop = element.scrollHeight;
    });
    await expect(page.locator('.message-block.assistant').last()).toContainText('stable internal scroll position');
    await expectComposerPinnedBelowEvents(page);
    await expectVisualSnapshot(page, 'long-conversation-bottom-scroll.png');
  });
});

test('empty search results and no-task inspector states stay stable', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search sessions' });
  await search.fill('definitely-no-session-matches-this-query');

  const sidebar = page.getByRole('complementary', { name: 'Session navigation' });
  await expect(sidebar).toContainText('No chats match "definitely-no-session-matches-this-query".');
  await expectNoHorizontalPageOverflow(page);
  await expectNoHorizontalElementOverflow(sidebar, 'empty search sidebar');

  await page.getByRole('button', { name: 'Clear' }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await sessionRow(page, 'No Tasks Session').evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const viewport = test.info().project.use.viewport!;
  const inspector = viewport.width > 760
    ? await showInspectorIfNeeded(page)
    : await expectCompactInspector(page, 'no-task compact inspector');
  if (viewport.width > 760) {
    const sessionTasks = page.getByRole('tabpanel', { name: 'Session tasks' });
    await expect(sessionTasks).toContainText('No agent activity yet');
    await expect(sessionTasks).toContainText('This session is quiet.');
    await boxFor(sessionTasks, 'empty session tasks panel');

    await page.getByRole('tab', { name: 'All tasks' }).click();
    await expect(page.getByRole('tabpanel', { name: 'All tasks' })).toContainText('Running visual smoke checks');
  }

  await expectViewportContains(inspector, 'no-task inspector');
  await expectNoHorizontalPageOverflow(page);
});
