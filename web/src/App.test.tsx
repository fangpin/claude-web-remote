import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { SessionInfo, SessionStatus } from './types';

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

let sessions: SessionInfo[] = defaultSessions;
let deletedSessions: SessionInfo[] = defaultDeletedSessions;
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
  sessions = defaultSessions;
  deletedSessions = defaultDeletedSessions;
  window.localStorage.clear();
  FakeWebSocket.instances = [];
  scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoViewMock
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
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
              createdByClaudeRemoteWeb: true
            }
          : null,
        updatedAt: '2026-06-12T00:00:00Z'
      });
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
    if (url === '/api/sessions/s1/archive' && init?.method === 'POST') {
      return jsonResponse({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/sessions/s2/resume' && init?.method === 'POST') {
      return jsonResponse({ ...sessions[1], status: 'running', runtimeStatus: 'waiting', updatedAt: '2026-06-12T00:00:00Z' });
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
    expect(within(primaryNavigation).getByRole('button', { name: 'Config' })).toHaveAttribute('aria-current', 'false');
    expect(screen.getByRole('complementary', { name: 'Session navigation' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Conversation workspace' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Session inspector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Working directory')).not.toBeInTheDocument();
  });

  it('loads sessions, tasks, and renders active event stream as conversation blocks', async () => {
    render(<App />);

    expect((await screen.findAllByText('Repo One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('/repo/one').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Running' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent stopped' })).toBeInTheDocument();
    expect(screen.getByText('Ready for your reply')).toBeInTheDocument();
    expectSessionStatus('Repo One', 'Waiting for you');
    expectSessionStatus('Worktree Repo', 'Running');
    expectSessionStatus('Stopped Repo', 'Ended');
    expect(screen.getByText('Remote Claude session')).toBeInTheDocument();
    const inspector = screen.getByRole('complementary', { name: 'Session inspector' });
    expect(within(inspector).getByRole('tab', { name: 'Session tasks' })).toBeInTheDocument();
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

  it('hides raw and system events without rendering conversation cards', async () => {
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
    expect(screen.queryByText('raw event should stay hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('system event should stay hidden')).not.toBeInTheDocument();
    expect(screen.getAllByText('Raw events')).toHaveLength(1);
  });

  it('creates a session from the form and can include worktree request data', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    expect(await screen.findByRole('heading', { name: 'Start a session' })).toBeInTheDocument();
    expect(screen.getByText('Pick a repo, isolation style, and permission mode.')).toBeInTheDocument();
    expect(screen.getByText('Skip prompts for trusted local repos.')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByLabelText('Use git worktree'));
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByRole('heading', { name: '/repo/two' })).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByRole('heading', { name: '/repo/two' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Archived' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument();
  });

  it('shows create session errors', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '~' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByText('invalid request: cwd does not exist: ~')).toBeInTheDocument();
  });

  it('shows recent working directory suggestions and fills the input', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    const suggestions = await screen.findByLabelText('Recent working directories');
    expect(within(suggestions).getByText('one')).toBeInTheDocument();
    expect(within(suggestions).getAllByText('/repo').length).toBeGreaterThan(0);
    expect(within(suggestions).getByText('stopped')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use /repo/stopped' }));

    expect(screen.getByLabelText('Working directory')).toHaveValue('/repo/stopped');
  });

  it('shows a calmer empty state for search misses', async () => {
    render(<App />);

    await screen.findAllByText('Repo One');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sessions' }), { target: { value: 'missing-branch' } });

    expect(screen.getByRole('heading', { name: 'Search results' })).toBeInTheDocument();
    expect(screen.getByText('No sessions match "missing-branch".')).toBeInTheDocument();
    expect(screen.getByText('Try a repo name, branch, path, or status.')).toBeInTheDocument();
  });

  it('shows slash command autocomplete and completes without sending input', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/', selectionStart: 1 } });

    const palette = await screen.findByRole('listbox', { name: 'Claude command suggestions' });
    expect(palette).toBeInTheDocument();
    expect(palette).toHaveTextContent('Command palette');
    expect(within(palette).getAllByText('Help').length).toBeGreaterThan(0);

    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
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

  it('sends user input to the active session and preserves text on send failure', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('heading', { name: 'Do work' })).toBeInTheDocument();

    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') return jsonResponse({ error: 'input failed' }, 500);
      return jsonResponse({ ok: true });
    });
    cleanup();
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'retry work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('input failed');
    expect(screen.getByLabelText('Message')).toHaveValue('retry work');
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
  });

  it('disables send for empty input and prevents duplicate sends while pending', async () => {
    const inputDeferred = createDeferredResponse({ ok: true });
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') return inputDeferred.promise;
      return jsonResponse({ ok: true });
    });

    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    fireEvent.change(messageInput, { target: { value: 'do work' } });
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(sendButton);

    expect(screen.getByRole('button', { name: /Sending/ })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/sessions/s1/input')).toHaveLength(1);

    await act(async () => inputDeferred.resolve());
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('stores successful prompts and recalls them with arrow keys without stealing multiline editing', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;

    fireEvent.change(messageInput, { target: { value: 'first prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));

    fireEvent.change(messageInput, { target: { value: 'second prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/sessions/s1/input')).toHaveLength(2);
    });

    expect(JSON.parse(window.localStorage.getItem('claude-remote-web:prompt-history') ?? '[]')).toEqual([
      'second prompt',
      'first prompt'
    ]);

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('second prompt');

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('first prompt');

    messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
    fireEvent.keyDown(messageInput, { key: 'ArrowDown' });
    expect(messageInput).toHaveValue('second prompt');

    fireEvent.change(messageInput, { target: { value: 'line one\nline two', selectionStart: 8 } });
    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(messageInput).toHaveValue('line one\nline two');
  });

  it('stops the active session from the composer', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop session' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/stop', expect.objectContaining({ method: 'POST' })));
  });

  it('shows composer context hints for cwd, permission, status, and worktree metadata', async () => {
    render(<App />);

    const context = await screen.findByLabelText('Composer context');
    expect(within(context).getByText('cwd: /repo/one')).toBeInTheDocument();
    expect(within(context).getByText('permission: acceptEdits')).toBeInTheDocument();
    expect(context).toHaveTextContent('status: Waiting for you');
    expect(screen.getByRole('button', { name: 'Attach file context coming soon' })).toBeDisabled();

    fireEvent.click(sessionButton('Worktree Repo'));

    const worktreeContext = await screen.findByLabelText('Composer context');
    expect(within(worktreeContext).getByText('branch: pin/abc123')).toBeInTheDocument();
    expect(within(worktreeContext).getByText('source: /repo/one')).toBeInTheDocument();
  });

  it('shows an empty conversation state and fills suggestions without sending', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) return jsonResponse({ sessions: defaultSessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) return jsonResponse(emptyTaskGroups);
      if (url.endsWith('/input')) return jsonResponse({ ok: true });
      return jsonResponse({ ok: true });
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'What would you like Claude to do?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Run the relevant tests' }));

    expect(screen.getByLabelText('Message')).toHaveValue('Run the relevant tests');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/sessions/s1/input')).toBe(false);
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

    expect(await screen.findByRole('heading', { name: '/repo/one' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Name this chat from the first prompt please' } });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByRole('heading', { name: 'Name this chat from the...' })).toBeInTheDocument();
  });

  it('renders actions by active session status and resumes stopped sessions', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();

    fireEvent.click(sessionButton('Stopped Repo'));
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();

    const socketsBeforeResume = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s2/resume', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(socketsBeforeResume + 1));
    expect(FakeWebSocket.instances.at(-1)?.url).toContain('/api/sessions/s2/events?afterId=0');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByText('Claude is starting. You can send once the session is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it.each<SessionStatus>(['exited', 'failed'])('renders Resume and Archive actions for %s sessions', async (status) => {
    const name = `${status[0].toUpperCase()}${status.slice(1)} Repo`;
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name,
        cwd: `/repo/${status}`,
        status,
        runtimeStatus: status === 'exited' ? 'ended' : status
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
  });

  it('archives an active session and removes it from the active list', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/archive', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(querySessionButton('Repo One')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
  });

  it('loads archived sessions without opening a WebSocket or composer and unarchives them', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Repo One' });
    FakeWebSocket.instances = [];

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));

    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions?deletedOnly=true', undefined);
    expect(screen.getByLabelText('Message')).toBeDisabled();
    const inspector = screen.getByRole('complementary', { name: 'Session inspector' });
    const sessionPanel = within(inspector).getByRole('tabpanel', { name: 'Session tasks' });
    expect(within(sessionPanel).queryByText('Agent: Review branch')).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3/unarchive', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'No archived sessions.' })).toBeInTheDocument();
  });

  it('deletes archived session data from the archived list', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Archived' }));
    expect(await screen.findByRole('heading', { name: 'Archived Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3?permanent=true', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Archived Repo/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'No archived sessions.' })).toBeInTheDocument();
  });

  it('ignores stale active list responses after switching to archived mode', async () => {
    const activeList = createDeferredResponse({ sessions: defaultSessions });
    const deletedList = createDeferredResponse({ sessions: defaultDeletedSessions });
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
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
      if (url === '/api/sessions' && !init) return Promise.resolve(jsonResponse({ sessions: threeSessions }));
      if (url === '/api/tasks' || url.endsWith('/tasks')) return Promise.resolve(jsonResponse(emptyTaskGroups));
      if (url === '/api/sessions/s1/archive' && init?.method === 'POST') return archivePromise;
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(sessionButton('Newest Repo'));

    await act(async () => {
      resolveArchive();
      await archivePromise;
    });

    await waitFor(() => expect(querySessionButton('Repo One')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Newest Repo' })).toBeInTheDocument();
  });

  it('renders worktree metadata and stop/remove actions', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));

    expect(screen.getByText('Source: /repo/one')).toBeInTheDocument();
    expect(screen.getByText('Branch: pin/abc123')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Stop and remove worktree'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop-and-remove-worktree', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByText('Branch: pin/abc123')).not.toBeInTheDocument());
    const activeHeader = screen.getByRole('heading', { name: 'Worktree Repo' }).closest('header');
    expect(activeHeader).not.toBeNull();
    expect(within(activeHeader as HTMLElement).getByText('/repo/one')).toBeInTheDocument();
  });

  it('hides remove action for worktrees not created by this app', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('External Worktree Repo'));

    expect(screen.queryByText('Stop and remove worktree')).not.toBeInTheDocument();
    expect(screen.getByText('Stop only')).toBeInTheDocument();
  });

  it('shows session tasks in the inspector and can switch to all tasks and plan', async () => {
    render(<App />);

    const inspector = await screen.findByRole('complementary', { name: 'Session inspector' });
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

  it('opens the config view from the sidebar', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Config' }));

    expect(await screen.findByText('Daemon config')).toBeInTheDocument();
  });
});
