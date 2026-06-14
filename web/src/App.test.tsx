import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { SessionInfo, SessionStatus, UiEvent } from './types';

const baseSession = {
  permissionMode: 'acceptEdits',
  claudeSessionId: null,
  deletedAt: null,
  createdAt: '2026-06-11T00:00:00Z',
  updatedAt: '2026-06-11T00:00:00Z'
};

const defaultSessions: SessionInfo[] = [
  {
    ...baseSession,
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    status: 'running',
    runtimeStatus: 'waiting',
    updatedAt: '2026-06-11T02:00:00Z'
  },
  {
    ...baseSession,
    id: 's2',
    name: 'Stopped Repo',
    cwd: '/repo/stopped',
    status: 'exited',
    runtimeStatus: 'ended',
    claudeSessionId: 'claude-s2',
    updatedAt: '2026-06-11T01:00:00Z'
  },
  {
    ...baseSession,
    id: 's4',
    name: 'Worktree Repo',
    cwd: '/repo/one/.claude/worktrees/abc123',
    status: 'running',
    runtimeStatus: 'running',
    worktree: {
      sourceCwd: '/repo/one',
      worktreeCwd: '/repo/one/.claude/worktrees/abc123',
      branch: 'pin/abc123',
      baseRef: 'HEAD',
      createdByClaudeRemoteWeb: true
    },
    updatedAt: '2026-06-11T03:00:00Z'
  },
  {
    ...baseSession,
    id: 's5',
    name: 'External Worktree Repo',
    cwd: '/repo/external-worktree',
    status: 'running',
    runtimeStatus: 'running',
    worktree: {
      sourceCwd: '/repo/external',
      worktreeCwd: '/repo/external-worktree',
      branch: 'feature/external',
      createdByClaudeRemoteWeb: false
    },
    updatedAt: '2026-06-11T04:00:00Z'
  }
];

const defaultDeletedSessions: SessionInfo[] = [
  {
    ...baseSession,
    id: 's3',
    name: 'Archived Repo',
    cwd: '/repo/archived',
    status: 'stopped',
    runtimeStatus: 'stopped',
    claudeSessionId: 'claude-s3',
    deletedAt: '2026-06-12T00:00:00Z',
    updatedAt: '2026-06-12T00:00:00Z'
  }
];

const taskGroups = {
  background: [
    {
      id: 's2:toolu_1',
      sessionId: 's2',
      sessionName: 'Stopped Repo',
      sessionCwd: '/repo/stopped',
      toolKind: 'Agent',
      title: 'Agent: Check stopped repo',
      status: 'background',
      startedAt: '2026-06-12T00:00:00Z',
      finishedAt: null,
      startEventId: 3,
      finishEventId: null,
      summary: null
    }
  ],
  finished: [
    {
      id: 's1:toolu_2',
      sessionId: 's1',
      sessionName: 'Repo One',
      sessionCwd: '/repo/one',
      toolKind: 'Agent',
      title: 'Agent: Review branch',
      status: 'completed',
      startedAt: '2026-06-12T00:00:00Z',
      finishedAt: '2026-06-12T00:01:00Z',
      startEventId: 5,
      finishEventId: 6,
      summary: 'No issues found'
    }
  ]
};

const emptyTaskGroups = { background: [], finished: [] };

const defaultEventsBySession: Record<string, UiEvent[]> = {};

let sessions: SessionInfo[] = defaultSessions;
let deletedSessions: SessionInfo[] = defaultDeletedSessions;
let eventsBySession: Record<string, UiEvent[]> = defaultEventsBySession;
let dirtyWorktreeStatus = false;
let fetchMock: ReturnType<typeof vi.fn>;
let scrollIntoViewMock: ReturnType<typeof vi.fn>;

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (response?: Response) => void;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function createDeferredResponse(body: unknown): DeferredResponse {
  let resolve!: (response?: Response) => void;
  const promise = new Promise<Response>((deferredResolve) => {
    resolve = (response?: Response) => deferredResolve(response ?? jsonResponse(body));
  });
  return { promise, resolve };
}

function taskGroupsWithTitle(title: string, sessionId = 's1') {
  return {
    background: [],
    finished: [
      {
        ...taskGroups.finished[0],
        id: `${sessionId}:${title}`,
        sessionId,
        sessionName: sessionId === 's2' ? 'Stopped Repo' : 'Repo One',
        sessionCwd: sessionId === 's2' ? '/repo/stopped' : '/repo/one',
        title
      }
    ]
  };
}

function eventsResponse(url: string): Response | null {
  const match = url.match(/\/api\/sessions\/([^/?]+)\/(?:events|transcript)(?:\?([^#]*))?/);
  if (!match) return null;
  const sessionId = match[1];
  const params = new URLSearchParams(match[2] ?? '');
  const afterId = Number(params.get('afterId') ?? 0);
  const events = (eventsBySession[sessionId] ?? []).filter((event) => event.id > afterId);
  return jsonResponse({ events });
}

function diagnosticsResponse() {
  return jsonResponse({
    status: 'healthy',
    config: {
      configPath: '/home/user/.claude-remote-web/config.toml',
      configFileExists: true,
      restartRequired: false,
      bind: '127.0.0.1:8787',
      defaultPermissionMode: 'bypassPermissions',
      worktreesDir: null,
      worktreeBranchPrefix: 'pin',
      worktreeBaseRef: 'fresh'
    },
    launcher: {
      argv: ['claude'],
      nativeArgsPreview: ['--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'bypassPermissions', '--verbose'],
      fullArgvPreview: ['claude', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'bypassPermissions', '--verbose'],
      status: 'healthy',
      issues: []
    },
    webDir: {
      status: 'healthy',
      path: null,
      mode: 'embedded',
      exists: true,
      isDirectory: true,
      writable: null,
      hasIndexHtml: true,
      message: 'Using embedded web assets.'
    },
    dataDir: {
      status: 'healthy',
      path: '/home/user/.claude-remote-web',
      mode: 'data',
      exists: true,
      isDirectory: true,
      writable: true,
      hasIndexHtml: null,
      message: 'Data directory exists and is writable.'
    },
    recentSessionFailures: []
  });
}

function worktreeStatusResponse(sessionId: string) {
  const session = sessions.find((item) => item.id === sessionId);
  if (!session?.worktree) return jsonResponse({ error: 'session has no worktree' }, 400);
  const files = dirtyWorktreeStatus
    ? [{ path: 'web/src/App.tsx', indexStatus: ' ', worktreeStatus: 'M', originalPath: null }]
    : [];
  return jsonResponse({
    sourceCwd: session.worktree.sourceCwd,
    worktreeCwd: session.worktree.worktreeCwd,
    branch: session.worktree.branch,
    baseRef: session.worktree.baseRef ?? null,
    dirty: dirtyWorktreeStatus,
    changedFileCount: files.length,
    files,
    shortStatus: dirtyWorktreeStatus ? [' M web/src/App.tsx'] : []
  });
}

function sessionDiagnosticsResponse(sessionId: string) {
  const session = [...sessions, ...deletedSessions].find((item) => item.id === sessionId) ?? sessions[0];
  return jsonResponse({
    session: {
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      status: session.status,
      permissionMode: session.permissionMode,
      claudeSessionIdPresent: Boolean(session.claudeSessionId),
      updatedAt: session.updatedAt
    },
    status: session.status === 'failed' ? 'error' : 'healthy',
    summary: 'No recent process errors recorded for this session.',
    recentStderr: [],
    recentErrors: [],
    recentSystemEvents: [],
    guidance: ['Review recent stderr and system events, then restart the session after correcting the cause.']
  });
}

function sessionButton(name: string): HTMLElement {
  const button = querySessionButton(name);
  if (!button) throw new Error(`session button not found: ${name}`);
  return button;
}

function querySessionButton(name: string): HTMLElement | null {
  const matches = screen.queryAllByText(name);
  return (matches.find((element) => element.closest('button.session'))?.closest('button') as HTMLElement | null) ?? null;
}

function expectSessionStatus(name: string, status: string) {
  expect(within(sessionButton(name)).getByText(status)).toBeInTheDocument();
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  close() {}
  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  sessions = defaultSessions;
  deletedSessions = defaultDeletedSessions;
  eventsBySession = defaultEventsBySession;
  dirtyWorktreeStatus = false;
  FakeWebSocket.instances = [];
  scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const eventResponse = !init ? eventsResponse(url) : null;
    if (eventResponse) return eventResponse;
    if (url === '/api/diagnostics' && !init) {
      return diagnosticsResponse();
    }
    const sessionDiagnosticsMatch = url.match(/^\/api\/sessions\/([^/?]+)\/diagnostics$/);
    if (sessionDiagnosticsMatch && !init) {
      return sessionDiagnosticsResponse(sessionDiagnosticsMatch[1]);
    }
    const worktreeStatusMatch = url.match(/^\/api\/sessions\/([^/?]+)\/worktree-status$/);
    if (worktreeStatusMatch && !init) {
      return worktreeStatusResponse(worktreeStatusMatch[1]);
    }
    const worktreeDiffMatch = url.match(/^\/api\/sessions\/([^/?]+)\/worktree-diff$/);
    if (worktreeDiffMatch && !init) {
      return jsonResponse({ diff: 'diff --git a/web/src/App.tsx b/web/src/App.tsx\n+changed' });
    }
    if (url === '/api/sessions' && !init) {
      return jsonResponse({ sessions });
    }
    if (url === '/api/sessions?deletedOnly=true' && !init) {
      return jsonResponse({ sessions: deletedSessions });
    }
    if (url === '/api/sessions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (body.cwd === '~') {
        return jsonResponse({ error: 'invalid request: cwd does not exist: ~' }, 400);
      }
      return jsonResponse({
        ...sessions[0],
        id: 's6',
        name: body.name ?? null,
        cwd: body.cwd,
        worktree: body.worktree?.enabled
          ? {
              sourceCwd: body.cwd,
              worktreeCwd: `${body.cwd}/.claude/worktrees/def456`,
              branch: 'pin/def456',
              baseRef: 'HEAD',
              createdByClaudeRemoteWeb: true
            }
          : null,
        updatedAt: '2026-06-12T00:00:00Z'
      });
    }
    const patchSessionMatch = url.match(/^\/api\/sessions\/([^/?]+)$/);
    if (patchSessionMatch && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      const session = sessions.find((item) => item.id === patchSessionMatch[1]) ?? sessions[0];
      return jsonResponse({ ...session, name: body.name, updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/tasks') {
      return jsonResponse(taskGroups);
    }
    if (url === '/api/sessions/s1/tasks') {
      return jsonResponse({ background: [], finished: [taskGroups.finished[0]] });
    }
    if (url === '/api/sessions/s2/tasks') {
      return jsonResponse({ background: [taskGroups.background[0]], finished: [] });
    }
    if (url.endsWith('/tasks')) {
      return jsonResponse(emptyTaskGroups);
    }
    if (url.endsWith('/transcript') || url.includes('/transcript?')) {
      return jsonResponse({ events: [] });
    }
    if (url === '/api/sessions/s1/archive' && init?.method === 'POST') {
      return jsonResponse({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/sessions/s2/resume' && init?.method === 'POST') {
      return jsonResponse({ ...sessions[1], status: 'running', runtimeStatus: 'waiting', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url.endsWith('/resume') && init?.method === 'POST') {
      const session = sessions.find((item) => url.includes(item.id)) ?? sessions[0];
      return jsonResponse({ ...session, status: 'running', runtimeStatus: 'waiting', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/sessions/s3/unarchive' && init?.method === 'POST') {
      return jsonResponse({ ...deletedSessions[0], deletedAt: null, updatedAt: '2026-06-12T01:00:00Z' });
    }
    if (url === '/api/sessions/s3?permanent=true' && init?.method === 'DELETE') {
      return jsonResponse({ ok: true });
    }
    if (url === '/api/config' && !init) {
      return new Response(JSON.stringify({
        path: '/home/user/.claude-remote-web/config.toml',
        exists: false,
        current: {
          bind: '127.0.0.1:8787',
          dataDir: '/home/user/.claude-remote-web',
          launcher: ['claude'],
          webDir: null,
          defaultPermissionMode: 'bypassPermissions',
          worktreesDir: null,
          worktreeBranchPrefix: 'pin',
          worktreeBaseRef: 'fresh'
        },
        file: {
          bind: '127.0.0.1:8787',
          dataDir: '/home/user/.claude-remote-web',
          launcher: ['claude'],
          webDir: null,
          defaultPermissionMode: 'bypassPermissions',
          worktreesDir: null,
          worktreeBranchPrefix: 'pin',
          worktreeBaseRef: 'fresh'
        },
        restartRequired: false
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s1/input' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      return jsonResponse({
        ok: true,
        session: {
          ...sessions[0],
          name: body.text === 'do work' ? 'Do work' : body.text === 'Name this chat from the first prompt please' ? 'Name this chat from the...' : sessions[0].name
        }
      });
    }
    if (url.endsWith('/input')) {
      return jsonResponse({ ok: true, session: null });
    }
    if (url.endsWith('/stop-and-remove-worktree')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/restart')) {
      const session = sessions.find((item) => url.includes(item.id)) ?? sessions[0];
      return jsonResponse({ ...session, status: 'running', runtimeStatus: 'waiting', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url.endsWith('/stop')) {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('confirm', vi.fn(() => true));
  vi.stubGlobal('prompt', vi.fn((_message: string, value?: string) => value ?? 'Renamed chat'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the Claude-like shell regions with conversation and inspector areas', async () => {
    render(<App />);

    const primaryNavigation = await screen.findByRole('navigation', { name: 'Primary navigation' });
    expect(primaryNavigation).toBeInTheDocument();
    expect(within(primaryNavigation).getByRole('button', { name: 'Sessions' })).toHaveAttribute('aria-current', 'page');
    expect(within(primaryNavigation).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Session navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Conversation workspace' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
  });

  it('loads sessions, tasks, and renders active event stream as conversation blocks', async () => {
    eventsBySession = {
      s1: [
        {
          id: 1,
          sessionId: 's1',
          time: '2026-06-11T00:00:00Z',
          kind: 'assistant',
          payload: { message: 'hello from history' }
        }
      ]
    };
    render(<App />);

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
    expect(screen.getByText('Claude chat')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude: Claude is waiting')).toBeInTheDocument();
    expect(screen.getByLabelText('Claude attention notification')).toHaveTextContent('Claude is waiting');
    expect(screen.getAllByLabelText('Claude needs your review')).toHaveLength(2);
    expect(screen.getAllByRole('heading', { name: 'Claude is waiting' })).toHaveLength(2);
    expect(screen.getAllByText('Web approval controls are not available in this build.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: 'Session inspector' });
    expect(within(inspector).getByRole('tab', { name: 'Session tasks' })).toBeInTheDocument();
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Session tasks' }));
    const sessionPanel = within(inspector).getByRole('tabpanel', { name: 'Session tasks' });
    expect(await within(sessionPanel).findByText('Agent: Review branch')).toBeInTheDocument();

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'assistant',
      payload: { message: 'hello from claude' }
    });

    expect(await screen.findByText('hello from claude')).toBeInTheDocument();
  });

  it('filters sessions locally by name, cwd, status, and worktree branch', async () => {
    render(<App />);

    await screen.findAllByText('Repo One');
    const search = screen.getByRole('searchbox', { name: 'Search sessions' });

    fireEvent.change(search, { target: { value: 'pin/abc123' } });

    expect(sessionButton('Worktree Repo')).toBeInTheDocument();
    expect(querySessionButton('Repo One')).toBeNull();
    expect(querySessionButton('Stopped Repo')).toBeNull();
    expect(screen.getByText('1 of 4 matches for "pin/abc123"')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'ended' } });

    expect(sessionButton('Stopped Repo')).toBeInTheDocument();
    expect(querySessionButton('Worktree Repo')).toBeNull();
    expect(screen.getByText('1 of 4 matches for "ended"')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByRole('searchbox', { name: 'Search sessions' })).toHaveValue('');
    expect(querySessionButton('Repo One')).toBeInTheDocument();
  });

  it('pins sessions locally and keeps the favorite section after remounting', async () => {
    const { unmount } = render(<App />);

    await screen.findAllByText('Repo One');
    fireEvent.click(screen.getByRole('button', { name: 'Pin Stopped Repo' }));

    expect(screen.getByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin Stopped Repo' })).toHaveAttribute('aria-pressed', 'true');

    unmount();
    cleanup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin Stopped Repo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('surfaces destructive command review without flagging ordinary tool activity', async () => {
    eventsBySession = {
      s1: [
        {
          id: 1,
          sessionId: 's1',
          time: '2026-06-11T00:00:00Z',
          kind: 'tool',
          payload: { type: 'tool_use', id: 'toolu_safe', name: 'Bash', input: { command: 'npm test', description: 'Run tests' } }
        },
        {
          id: 2,
          sessionId: 's1',
          time: '2026-06-11T00:00:01Z',
          kind: 'tool',
          payload: { type: 'tool_result', tool_use_id: 'toolu_safe', content: 'passed' }
        },
        {
          id: 3,
          sessionId: 's1',
          time: '2026-06-11T00:00:02Z',
          kind: 'tool',
          payload: { type: 'tool_use', id: 'toolu_risky', name: 'Bash', input: { command: 'rm -rf dist', description: 'Remove dist' } }
        }
      ]
    };

    render(<App />);

    expect(await screen.findAllByText('Claude requested an action that may be destructive or affect shared state.')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Review' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copy review' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bash').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deletes files recursively or forcefully.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Remove dist · $ rm -rf dist').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Run tests · $ npm test').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
  });

  it('renders raw fallback cards and hides system events', async () => {
    render(<App />);

    await screen.findAllByText('Repo One');
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));

    FakeWebSocket.instances[0].emit({
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'raw',
      payload: { message: 'raw event should stay hidden' }
    });
    FakeWebSocket.instances[0].emit({
      id: 2,
      sessionId: 's1',
      time: '2026-06-11T00:00:01Z',
      kind: 'system',
      payload: { message: 'system event should stay hidden' }
    });
    FakeWebSocket.instances[0].emit({
      id: 3,
      sessionId: 's1',
      time: '2026-06-11T00:00:02Z',
      kind: 'error',
      payload: { error: 'visible error event' }
    });

    expect(await screen.findByText('visible error event')).toBeInTheDocument();
    expect(screen.getByText('Raw')).toBeInTheDocument();
    expect(screen.queryByText('raw event should stay hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('system event should stay hidden')).not.toBeInTheDocument();
    expect(screen.getAllByText('Raw events')).toHaveLength(2);
  });

  it('creates a session from the form and can include worktree request data', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    expect(screen.getByText('Choose a workspace context, then ask Claude to inspect, change, explain, or ship code.')).toBeInTheDocument();
    expect(screen.getByText('Advanced options').closest('details')).not.toHaveAttribute('open');
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Advanced options'));
    expect(screen.getByText('Skip prompts for trusted local repos.')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Use git worktree'));
    fireEvent.click(screen.getByText('Start chat'));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      cwd: '/repo/two',
      permissionMode: 'bypassPermissions',
      worktree: { enabled: true }
    });
    expect(JSON.parse(String(createCall?.[1]?.body))).not.toHaveProperty('name');
  });

  it('switches to active mode when creating from archived mode', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Start chat'));

    expect(await screen.findByRole('heading', { name: 'two', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument();
  });

  it('shows create session errors', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '~' } });
    fireEvent.click(screen.getByText('Start chat'));

    expect(await screen.findByText('invalid request: cwd does not exist: ~')).toBeInTheDocument();
  });

  it('shows recent projects and fills the launch directory', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    const recentProjects = await screen.findByLabelText('Recent projects');
    expect(within(recentProjects).getByText('external')).toBeInTheDocument();
    expect(within(recentProjects).getAllByText('/repo').length).toBeGreaterThan(0);
    expect(within(recentProjects).getByText('stopped')).toBeInTheDocument();
    expect(within(recentProjects).getByText('one')).toBeInTheDocument();
    expect(within(recentProjects).queryByText('external-worktree')).not.toBeInTheDocument();
    expect(within(recentProjects).queryByText('abc123')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use /repo/stopped as working directory' }));

    expect(screen.getByLabelText('Workspace context')).toHaveValue('/repo/stopped');
    expect(screen.getByText('Claude will start in /repo/stopped.')).toBeInTheDocument();
  });

  it('shows a calmer empty state for search misses', async () => {
    render(<App />);

    await screen.findAllByText('Repo One');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), { target: { value: 'missing-branch' } });

    expect(screen.getByRole('heading', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByText('No chats match "missing-branch".')).toBeInTheDocument();
    expect(screen.getByText('Try a repo name, branch, path, or status.')).toBeInTheDocument();
  });

  it('keeps session list failures inside the sidebar with retry details', async () => {
    let shouldFail = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') {
        if (shouldFail) return jsonResponse({ error: 'database unavailable' }, 503);
        return jsonResponse({ sessions: defaultSessions });
      }
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url.endsWith('/transcript')) return jsonResponse({ events: [] });
      return jsonResponse({ ok: true });
    });

    render(<App />);

    const sidebar = await screen.findByRole('complementary', { name: 'Session navigation' });
    expect(within(sidebar).getByText('Could not load chats.')).toBeInTheDocument();
    expect(within(sidebar).getByText('Details')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Conversation workspace' })).toHaveTextContent('What can I help with?');

    shouldFail = false;
    fireEvent.click(within(sidebar).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
  });

  it('shows transcript failures with details and reload affordance', async () => {
    let shouldFailTranscript = true;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/transcript' || url === '/api/sessions/s1/transcript?limit=80') {
        if (shouldFailTranscript) return jsonResponse({ error: 'transcript store unavailable' }, 500);
        return jsonResponse({
          events: [
            {
              id: 7,
              sessionId: 's1',
              time: '2026-06-11T00:00:00Z',
              kind: 'assistant',
              payload: { message: 'Recovered transcript' }
            }
          ]
        });
      }
      if (url.endsWith('/transcript')) return jsonResponse({ events: [] });
      return jsonResponse({ ok: true });
    });

    render(<App />);

    expect(await screen.findByText('Conversation connection interrupted')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();

    shouldFailTranscript = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Recovered transcript')).toBeInTheDocument();
  });

  it('shows slash command autocomplete and completes without sending input', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });

    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/help/ })).toBeInTheDocument();

    fireEvent.keyDown(messageInput, { key: 'Tab' });

    expect(messageInput.value).toBe('/help ');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.anything());
  });

  it('keeps composer keyboard behavior for send, newline, IME, and autocomplete selection', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;

    fireEvent.change(messageInput, { target: { value: 'line one' } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => String(url) === '/api/sessions/s1/input')?.[1]?.body))).toMatchObject({
      text: 'line one'
    });
    const inputCallCount = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/sessions/s1/input').length;
    const sentBeforeKeyboardChecks = inputCallCount();

    fireEvent.change(messageInput, { target: { value: 'line one' } });
    fireEvent.keyDown(messageInput, { key: 'Enter', shiftKey: true });
    expect(inputCallCount()).toBe(sentBeforeKeyboardChecks);

    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composingEnter, 'isComposing', { configurable: true, value: true });
    fireEvent(messageInput, composingEnter);
    expect(inputCallCount()).toBe(sentBeforeKeyboardChecks);

    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });

    expect(messageInput).toHaveValue('/help ');
    expect(inputCallCount()).toBe(sentBeforeKeyboardChecks);
  });

  it('handles app-level composer shortcuts without stealing editable input', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;

    fireEvent.keyDown(window, { key: '/' });
    await waitFor(() => expect(messageInput).toHaveFocus());
    expect(messageInput).toHaveValue('/');
    expect(screen.getByLabelText('Composer shortcuts')).toHaveTextContent('/ for commands');
    expect(screen.getByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'Claude command suggestions' })).not.toBeInTheDocument();

    fireEvent.change(messageInput, { target: { value: 'keep draft' } });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(messageInput).toHaveFocus());
    expect(messageInput).toHaveValue('keep draft');

    fireEvent.keyDown(window, { key: 'n', ctrlKey: true });
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Search sessions' });
    fireEvent.change(search, { target: { value: '/' } });
    fireEvent.keyDown(search, { key: '/' });
    expect(search).toHaveValue('/');
    expect(messageInput).toHaveValue('keep draft');
  });

  it('opens the command palette with quick actions', async () => {
    render(<App />);

    await screen.findAllByText('Repo One');
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });

    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveFocus();
    expect(palette).toHaveTextContent('New chat');
    expect(palette).toHaveTextContent('Open slash commands');
    expect(palette).toHaveTextContent('Repo One');
    expect(palette).toHaveTextContent('Open settings');
    expect(palette).toHaveTextContent('Hide inspector');
  });

  it('toggles panels and cycles sessions with app-level shortcuts', async () => {
    render(<App />);

    expect(await screen.findByRole('complementary', { name: 'Session navigation' })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Show inspector' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Hide inspector' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    await waitFor(() => expect(sessionButton('Stopped Repo')).toHaveFocus());

    const messageInput = screen.getByLabelText('Message');
    fireEvent.keyDown(messageInput, { key: 'ArrowDown', altKey: true });
    expect(screen.getByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
  });

  it('closes app popovers with Escape and focuses composer after creating a session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keys' }));
    expect(screen.getByLabelText('Keyboard shortcuts')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Keyboard shortcuts')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('heading', { name: 'What can I help with?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show inspector' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'i', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Hide inspector' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Show inspector' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Workspace context'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Start chat'));

    const messageInput = await screen.findByLabelText('Message');
    await waitFor(() => expect(messageInput).toHaveFocus());
  });

  it('stores successful prompts and recalls them with Up and Down without stealing multiline editing', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;

    fireEvent.change(messageInput, { target: { value: 'first prompt' } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));

    fireEvent.change(messageInput, { target: { value: 'second prompt' } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });
    await waitFor(() => {
      const sent = fetchMock.mock.calls.filter(([url]) => String(url) === '/api/sessions/s1/input');
      expect(sent).toHaveLength(2);
    });

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('second prompt');

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('first prompt');

    fireEvent.keyDown(messageInput, { key: 'ArrowDown' });
    expect(messageInput).toHaveValue('second prompt');

    fireEvent.change(messageInput, { target: { value: 'line one\nline two', selectionStart: 9, selectionEnd: 9 } });
    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('line one\nline two');
  });

  it('auto-resizes the message textarea for multi-line drafts and caps tall content', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    Object.defineProperty(messageInput, 'scrollHeight', {
      configurable: true,
      value: 96
    });

    fireEvent.change(messageInput, { target: { value: 'first line\nsecond line\nthird line' } });

    expect(messageInput.style.height).toBe('96px');
    expect(messageInput.style.overflowY).toBe('hidden');

    Object.defineProperty(messageInput, 'scrollHeight', {
      configurable: true,
      value: 360
    });

    fireEvent.change(messageInput, { target: { value: Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') } });

    expect(messageInput.style.height).toBe('220px');
    expect(messageInput.style.overflowY).toBe('auto');
  });

  it('adds path and pasted text context, removes chips, and sends formatted prompt context', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add context reference' }));
    fireEvent.change(screen.getByLabelText('Repo path'), { target: { value: 'web/src/Composer.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    expect(await screen.findByLabelText('Context attachments')).toHaveTextContent('@web/src/Composer.tsx');

    fireEvent.click(screen.getByRole('button', { name: 'Add context reference' }));
    fireEvent.change(screen.getByLabelText('Repo path'), { target: { value: 'README.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add path' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove @README.md' }));

    expect(screen.queryByText('@README.md')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add context reference' }));
    fireEvent.change(screen.getByLabelText('Text context name'), { target: { value: 'Stack trace' } });
    fireEvent.change(screen.getByLabelText('Pasted text'), { target: { value: 'TypeError: failed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add pasted text' }));

    expect(screen.getByLabelText('Context attachments')).toHaveTextContent('Stack trace');

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please investigate' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    const sentBody = JSON.parse(String(fetchMock.mock.calls.find(([url]) => String(url) === '/api/sessions/s1/input')?.[1]?.body));
    expect(sentBody.text).toContain('Please investigate');
    expect(sentBody.text).toContain('Path 1: @web/src/Composer.tsx');
    expect(sentBody.text).toContain('Text 2: Stack trace');
    expect(sentBody.text).toContain('TypeError: failed');
    expect(screen.queryByLabelText('Context attachments')).not.toBeInTheDocument();
  });

  it('sends attachment-only prompts and restores context on send failure', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = init?.method === undefined ? eventsResponse(url) : null;
      if (eventResponse) return eventResponse;
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') return jsonResponse({ error: 'input failed' }, 500);
      return jsonResponse({ ok: true });
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Add context reference' }));
    fireEvent.change(screen.getByLabelText('Repo path'), { target: { value: '@web/src/App.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add path' }));

    const sendButton = screen.getByRole('button', { name: /Send/ });
    expect(sendButton).not.toBeDisabled();
    fireEvent.click(sendButton);

    expect(await screen.findByText('input failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Context attachments')).toHaveTextContent('@web/src/App.tsx');
  });

  it('sends user input to the active session and preserves text on send failure', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('heading', { name: 'Do work' })).toBeInTheDocument();

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = init?.method === undefined ? eventsResponse(url) : null;
      if (eventResponse) return eventResponse;
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') return jsonResponse({ error: 'input failed' }, 500);
      return jsonResponse({ ok: true });
    });
    cleanup();
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'retry work' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));

    expect(await screen.findByText('input failed')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toHaveValue('retry work');
    expect(screen.getByRole('button', { name: /Send/ })).not.toBeDisabled();
  });

  it('disables send for empty input and prevents duplicate sends while pending', async () => {
    const inputDeferred = createDeferredResponse({ ok: true });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = init?.method === undefined ? eventsResponse(url) : null;
      if (eventResponse) return eventResponse;
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') return inputDeferred.promise;
      return jsonResponse({ ok: true });
    });

    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    const sendButton = screen.getByRole('button', { name: /Send/ });
    expect(sendButton).toBeDisabled();

    fireEvent.change(messageInput, { target: { value: 'do work' } });
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(sendButton);

    expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/sessions/s1/input')).toHaveLength(1);

    await act(async () => inputDeferred.resolve());
    expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled();
  });

  it('keeps end session in the header overflow instead of the composer', async () => {
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Stop session' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/stop', expect.objectContaining({ method: 'POST' })));
  });

  it('shows composer context hints for cwd, permission, status, and worktree metadata', async () => {
    render(<App />);

    const context = await screen.findByLabelText('Composer context');
    expect(context).toHaveTextContent('status: Waiting for you');
    fireEvent.click(within(context).getByText('Context'));
    expect(within(context).getByText('/repo/one')).toBeInTheDocument();
    expect(within(context).getByText('acceptEdits')).toBeInTheDocument();

    fireEvent.click(sessionButton('Worktree Repo'));

    const worktreeContext = await screen.findByLabelText('Composer context');
    fireEvent.click(within(worktreeContext).getByText('Context'));
    expect(within(worktreeContext).getByText('pin/abc123')).toBeInTheDocument();
    expect(within(worktreeContext).getByText('/repo/one')).toBeInTheDocument();
  });

  it('shows an empty conversation state and fills suggestions without sending', async () => {
    eventsBySession = {};
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = init?.method === undefined ? eventsResponse(url) : null;
      if (eventResponse) return eventResponse;
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url.endsWith('/input')) return jsonResponse({ ok: true });
      return jsonResponse({ ok: true });
    });

    render(<App />);

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    act(() => FakeWebSocket.instances[0].onopen?.());
    expect(await screen.findByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/transcript?limit=80', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Run the relevant tests' }));

    expect(screen.getByLabelText('Message')).toHaveValue('Run the relevant tests');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/sessions/s1/input')).toBe(false);
  });

  it('renames the active chat from the header', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    vi.mocked(window.prompt).mockReturnValueOnce('Renamed Repo');
    fireEvent.click(screen.getByRole('button', { name: 'Rename chat' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'PATCH' })));
    expect(await screen.findByRole('heading', { name: 'Renamed Repo' })).toBeInTheDocument();
  });

  it('updates an unnamed chat with an auto-generated title after the first message', async () => {
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name: null,
        cwd: '/repo/one',
        status: 'running',
        runtimeStatus: 'waiting'
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'one', level: 2 })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Name this chat from the first prompt please' } });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByRole('heading', { name: 'Name this chat from the...' })).toBeInTheDocument();
  });

  it('renders continuity-aware actions and resumes stopped sessions', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Waiting for you')).toBeInTheDocument();

    fireEvent.click(sessionButton('Stopped Repo'));
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Ended')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Can resume')).toBeInTheDocument();
    expect(screen.getByText('This session is stopped. Resume the conversation to continue.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();

    const socketsBeforeResume = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Resume conversation' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s2/resume', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(socketsBeforeResume + 1));
    expect(FakeWebSocket.instances.at(-1)?.url).toContain('/api/sessions/s2/events?afterId=0');
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
  });

  it.each<SessionStatus>(['stopped', 'exited', 'failed'])('explains fresh-start continuation for %s sessions without Claude context', async (status) => {
    const name = `${status[0].toUpperCase()}${status.slice(1)} Fresh Repo`;
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name,
        cwd: `/repo/${status}-fresh`,
        status,
        runtimeStatus: status === 'exited' ? 'ended' : status
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Will start fresh')).toBeInTheDocument();
    expect(screen.getByText('This session cannot resume its Claude context. Start fresh from this workspace to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start fresh from this workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start fresh from this workspace' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/resume', expect.objectContaining({ method: 'POST' })));
  });

  it('renders Stop and Archive actions for starting sessions', async () => {
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name: 'Starting Repo',
        cwd: '/repo/starting',
        status: 'starting',
        runtimeStatus: 'starting'
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Starting Repo' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText('Claude is starting. You can send once the session is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it.each<SessionStatus>(['exited', 'failed'])('renders resumable continue actions for %s sessions with Claude context', async (status) => {
    const name = `${status[0].toUpperCase()}${status.slice(1)} Repo`;
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name,
        cwd: `/repo/${status}`,
        status,
        runtimeStatus: status === 'exited' ? 'ended' : status,
        claudeSessionId: `claude-${status}`
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Can resume')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume conversation' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
  });

  it('archives an active session and removes it from the active list', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/archive', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(querySessionButton('Repo One')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
  });

  it('loads archived sessions without opening a WebSocket or composer and unarchives them', async () => {
    eventsBySession = {
      s3: [
        {
          id: 1,
          sessionId: 's3',
          time: '2026-06-11T00:00:00Z',
          kind: 'assistant',
          payload: { message: 'archived session history' }
        }
      ]
    };
    render(<App />);

    await screen.findByRole('heading', { name: 'Repo One' });
    FakeWebSocket.instances = [];

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions?deletedOnly=true', undefined);
    expect(within(screen.getByLabelText('Session continuity')).getByText('Archived')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Session continuity')).getByText('Cannot resume')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume conversation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start fresh from this workspace' })).not.toBeInTheDocument();
    expect(await screen.findByText('archived session history')).toBeInTheDocument();
    expect(screen.getByText('This session is archived and read-only. Unarchive it before resuming work or sending messages.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    const inspector = screen.getByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Session tasks' }));
    const sessionPanel = within(inspector).getByRole('tabpanel', { name: 'Session tasks' });
    expect(within(sessionPanel).queryByText('Agent: Review branch')).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3/unarchive', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'No archived chats.' })).toBeInTheDocument();
  });

  it('loads stopped session history without opening a WebSocket until resumed', async () => {
    eventsBySession = {
      s2: [
        {
          id: 7,
          sessionId: 's2',
          time: '2026-06-11T00:00:00Z',
          kind: 'assistant',
          payload: { message: 'stopped session history' }
        }
      ]
    };
    render(<App />);

    await screen.findByRole('heading', { name: 'Repo One' });
    FakeWebSocket.instances = [];
    fireEvent.click(sessionButton('Stopped Repo'));

    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(await screen.findByText('stopped session history')).toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Resume conversation' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s2/resume', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    expect(FakeWebSocket.instances[0].url).toContain('/api/sessions/s2/events?afterId=7');
  });

  it('deletes archived session data from the archived list', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3?permanent=true', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'No archived chats.' })).toBeInTheDocument();
  });

  it('keeps the archived empty workspace separate from the project home', async () => {
    deletedSessions = [];
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));

    expect(await screen.findByRole('heading', { name: 'No archived chat selected.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'What can I help with?' })).not.toBeInTheDocument();
  });

  it('ignores stale active list responses after switching to archived mode', async () => {
    const activeList = createDeferredResponse({ sessions: defaultSessions });
    const deletedList = createDeferredResponse({ sessions: defaultDeletedSessions });
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const eventResponse = eventsResponse(url);
      if (eventResponse) return Promise.resolve(eventResponse);
      if (url === '/api/sessions') return activeList.promise;
      if (url === '/api/sessions?deletedOnly=true') return deletedList.promise;
      if (url === '/api/tasks' || url.endsWith('/tasks')) return Promise.resolve(jsonResponse(emptyTaskGroups));
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    await act(async () => {
      deletedList.resolve();
      await deletedList.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    await act(async () => {
      activeList.resolve();
      await activeList.promise;
    });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Repo One' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();
  });

  it('keeps a newer valid selection when archive completes', async () => {
    const threeSessions = [
      ...defaultSessions,
      {
        ...baseSession,
        id: 's7',
        name: 'Newest Repo',
        cwd: '/repo/newest',
        status: 'running',
        runtimeStatus: 'waiting'
      }
    ];
    let resolveArchive!: () => void;
    const archivePromise = new Promise<Response>((resolve) => {
      resolveArchive = () => resolve(jsonResponse({ ...threeSessions[0], deletedAt: '2026-06-12T00:00:00Z' }));
    });
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const eventResponse = !init ? eventsResponse(url) : null;
      if (eventResponse) return Promise.resolve(eventResponse);
      if (url === '/api/sessions' && !init) return Promise.resolve(jsonResponse({ sessions: threeSessions }));
      if (url === '/api/tasks' || url.endsWith('/tasks')) return Promise.resolve(jsonResponse(emptyTaskGroups));
      if (url === '/api/sessions/s1/archive' && init?.method === 'POST') return archivePromise;
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(sessionButton('Newest Repo'));

    await act(async () => {
      resolveArchive();
      await archivePromise;
    });

    await waitFor(() => expect(querySessionButton('Repo One')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Newest Repo' })).toBeInTheDocument();
  });

  it('renders worktree metadata, clean status, and stop/remove actions', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));

    const activeHeaderBeforeStop = screen.getByRole('heading', { name: 'Worktree Repo' }).closest('header');
    expect(activeHeaderBeforeStop).not.toBeNull();
    fireEvent.click(within(activeHeaderBeforeStop as HTMLElement).getByText('Chat details'));
    expect(within(activeHeaderBeforeStop as HTMLElement).getAllByText('/repo/one/.claude/worktrees/abc123').length).toBeGreaterThan(0);
    expect(within(activeHeaderBeforeStop as HTMLElement).getByText('/repo/one')).toBeInTheDocument();
    expect(within(activeHeaderBeforeStop as HTMLElement).getByText('pin/abc123')).toBeInTheDocument();
    expect(await screen.findByText('Clean')).toBeInTheDocument();
    expect(screen.getByText('Base: HEAD')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy delivery context' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('More'));
    fireEvent.click(screen.getByText('Stop and remove worktree'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop-and-remove-worktree', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByText('pin/abc123')).not.toBeInTheDocument());
    const activeHeader = screen.getByRole('heading', { name: 'Worktree Repo' }).closest('header');
    expect(activeHeader).not.toBeNull();
    expect(within(activeHeader as HTMLElement).getByText('/repo/one')).toBeInTheDocument();
  });

  it('shows dirty worktree files and blocks destructive cleanup by default', async () => {
    dirtyWorktreeStatus = true;
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));

    expect(await screen.findByText('1 changed file')).toBeInTheDocument();
    expect(screen.getByText('web/src/App.tsx')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByLabelText('Context attachments')).toHaveTextContent('@web/src/App.tsx');
    fireEvent.click(screen.getByRole('button', { name: 'View diff' }));
    expect(await screen.findByText('Worktree diff')).toBeInTheDocument();
    expect(screen.getByText(/diff --git a\/web\/src\/App\.tsx/)).toBeInTheDocument();
    expect(screen.getByText(/cleanup is blocked until you commit, stash, or clean/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review dirty worktree first' })).toBeDisabled();
    expect(screen.getByText('Stop only')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/sessions/s4/stop-and-remove-worktree')).toBe(false);
  });

  it('does not fetch worktree status for non-worktree sessions', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Repo One' });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/worktree-status'))).toBe(false);
    expect(screen.queryByLabelText('Worktree status')).not.toBeInTheDocument();
  });

  it('hides remove action for worktrees not created by this app', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('External Worktree Repo'));

    fireEvent.click(screen.getByText('More'));
    expect(screen.queryByText('Stop and remove worktree')).not.toBeInTheDocument();
    expect(screen.getByText('Stop only')).toBeInTheDocument();
  });

  it('shows session tasks in the inspector and can switch to all tasks and plan', async () => {
    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Session tasks' }));
    const sessionPanel = within(inspector).getByRole('tabpanel', { name: 'Session tasks' });
    expect(within(sessionPanel).getByRole('heading', { name: 'Session tasks' })).toBeInTheDocument();
    expect(await within(sessionPanel).findByText('Agent: Review branch')).toBeInTheDocument();
    expect(within(inspector).queryByRole('tab', { name: 'Details' })).not.toBeInTheDocument();
    expect(within(inspector).getByRole('tab', { name: 'Session tasks' })).toHaveAttribute('tabIndex', '0');
    expect(within(inspector).getByRole('tab', { name: 'All tasks' })).toHaveAttribute('tabIndex', '-1');
    expect(within(inspector).getByRole('tab', { name: 'Plan' })).toHaveAttribute('tabIndex', '-1');

    fireEvent.keyDown(within(inspector).getByRole('tab', { name: 'Session tasks' }), { key: 'ArrowRight' });
    expect(within(inspector).getByRole('tab', { name: 'All tasks' })).toHaveAttribute('aria-selected', 'true');
    expect(within(inspector).getByRole('tab', { name: 'All tasks' })).toHaveFocus();
    expect(within(inspector).getByRole('tab', { name: 'Session tasks' })).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    const allTasksPanel = within(inspector).getByRole('tabpanel', { name: 'All tasks' });
    expect(await within(allTasksPanel).findByText('Agent: Check stopped repo')).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole('tab', { name: 'Plan' }));
    const planPanel = within(inspector).getByRole('tabpanel', { name: 'Plan' });
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

  it('shows runtime diagnostics in the inspector', async () => {
    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Diagnostics' }));

    const diagnosticsPanel = within(inspector).getByRole('tabpanel', { name: 'Diagnostics' });
    expect(await within(diagnosticsPanel).findByText('Daemon health checks are passing.')).toBeInTheDocument();
    expect(within(diagnosticsPanel).getByText('Data directory exists and is writable.')).toBeInTheDocument();
    expect(within(diagnosticsPanel).getByText('claude --input-format stream-json --output-format stream-json --permission-mode bypassPermissions --verbose')).toBeInTheDocument();
    expect(within(diagnosticsPanel).getByText('No recent process errors recorded for this session.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/diagnostics', undefined);
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/diagnostics', undefined);
  });

  it('selects the owning session and refreshes tasks when a task is clicked', async () => {
    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    const allTasksPanel = within(inspector).getByRole('tabpanel', { name: 'All tasks' });
    const task = await within(allTasksPanel).findByText('Agent: Check stopped repo');
    const taskListCallsBeforeSelection = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;

    fireEvent.click(task);

    await waitFor(() => expect(screen.getAllByText('Stopped Repo').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    await waitFor(() => {
      const taskListCallsAfterSelection = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;
      expect(taskListCallsAfterSelection).toBeGreaterThan(taskListCallsBeforeSelection);
    });
  });

  it('keeps the latest global task refresh when older requests resolve later', async () => {
    const taskRequests: DeferredResponse[] = [];
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const eventResponse = eventsResponse(url);
      if (eventResponse) return Promise.resolve(eventResponse);
      if (url === '/api/sessions') return Promise.resolve(jsonResponse({ sessions }));
      if (url === '/api/tasks') {
        const request = createDeferredResponse(emptyTaskGroups);
        taskRequests.push(request);
        return request.promise;
      }
      if (url === '/api/sessions/s1/tasks') return Promise.resolve(jsonResponse(emptyTaskGroups));
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });

    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
    fireEvent.click(within(inspector).getByRole('tab', { name: 'All tasks' }));
    const allTasksPanel = within(inspector).getByRole('tabpanel', { name: 'All tasks' });

    await waitFor(() => expect(taskRequests.length).toBeGreaterThanOrEqual(2));

    await act(async () => {
      taskRequests.at(-1)?.resolve(jsonResponse(taskGroupsWithTitle('Fresh global task')));
    });
    expect(await within(allTasksPanel).findByText('Fresh global task')).toBeInTheDocument();

    await act(async () => {
      taskRequests[0].resolve(jsonResponse(taskGroupsWithTitle('Stale global task')));
    });

    expect(within(allTasksPanel).getByText('Fresh global task')).toBeInTheDocument();
    expect(within(allTasksPanel).queryByText('Stale global task')).not.toBeInTheDocument();
  });

  it('exposes selected state on the active and archived list mode buttons', async () => {
    render(<App />);

    const activeButton = screen.getByRole('button', { name: 'Active' });
    const archivedButton = screen.getByRole('button', { name: 'Archived' });

    expect(activeButton).toHaveAttribute('aria-pressed', 'true');
    expect(archivedButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(archivedButton);

    expect(activeButton).toHaveAttribute('aria-pressed', 'false');
    expect(archivedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps settings accessible from the command palette', async () => {
    render(<App />);

    fireEvent.keyDown(window, { key: 'p', ctrlKey: true });
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });

    expect(palette).toHaveTextContent('Open settings');
    expect(palette).toHaveTextContent('View app and runtime configuration');
  });
});
