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
    cwd: '/Users/example/repos/other-project',
    status: 'exited',
    runtimeStatus: 'ended'
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
      title: 'Agent: inspect responsive Claude-like output rendering for overlap and overflow',
      status: 'completed',
      startedAt: '2026-06-12T00:01:00Z',
      finishedAt: '2026-06-12T00:02:00Z',
      startEventId: 7,
      finishEventId: 8,
      summary: 'Checked sidebar, inspector, composer, conversation blocks, and task cards.'
    }
  ]
};

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
        'I will inspect the session timeline, run browser layout checks, and keep raw event details collapsed for replay.'
    }
  },
  {
    id: 3,
    sessionId: 's1',
    time: '2026-06-12T00:00:02Z',
    kind: 'tool',
    payload: {
      type: 'tool_use',
      id: 'tool-read',
      name: 'Read',
      input: {
        file_path:
          '/Users/example/repos/claude-web-remote/web/src/App.css'
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
      tool_use_id: 'tool-read',
      content: 'Read 420 lines from App.css. Result should stay compact and collapsed when useful.'
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
        'The visible conversation now includes ordinary text, compact tool activity, background Bash activity, and Agent task activity.'
    }
  }
];

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
      return json({ sessions });
    }
    if (path === '/api/tasks') {
      return json(taskGroups);
    }
    if (path === '/api/sessions/s1/tasks') {
      return json(taskGroups);
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
          for (const event of events as unknown[]) {
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

test.beforeEach(async ({ page }) => {
  await installWebSocketMock(page);
  await installApiMocks(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Visual Regression Session' })).toBeVisible();
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
  await boxFor(inspector, 'session inspector');
  await boxFor(events, 'conversation event stream');
  await boxFor(composer, 'composer');
  await expect(page.locator('.message-block.assistant').first()).toContainText('browser layout checks');
  await expect(page.locator('.tool-block.completed')).toContainText('Read');
  await expect(page.locator('.task-block.running')).toContainText('Run browser visual layout verification');
  await expect(page.locator('.task-block.completed')).toContainText('Inspect responsive UI affordances');
  await expect(page.getByRole('tabpanel', { name: 'Session tasks' })).toContainText('visual smoke checks');

  await expectNoHorizontalPageOverflow(page);
  await expectViewportContains(composer, 'composer');
  await expectNoMeaningfulOverlap(events, composer, 'event stream and composer');

  const viewport = test.info().project.use.viewport!;
  if (viewport.width > 760) {
    await expectNoMeaningfulOverlap(sidebar, workspace, 'sidebar and workspace');
  }
  if (viewport.width > 1020) {
    await expectNoMeaningfulOverlap(workspace, inspector, 'workspace and inspector');
  }
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
