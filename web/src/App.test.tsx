import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const baseSession = {
  permissionMode: 'acceptEdits',
  claudeSessionId: null,
  deletedAt: null,
  createdAt: '2026-06-11T00:00:00Z',
  updatedAt: '2026-06-11T00:00:00Z'
};

const defaultSessions = [
  {
    ...baseSession,
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    status: 'running',
    updatedAt: '2026-06-11T02:00:00Z'
  },
  {
    ...baseSession,
    id: 's2',
    name: 'Stopped Repo',
    cwd: '/repo/stopped',
    status: 'stopped',
    claudeSessionId: 'claude-s2',
    updatedAt: '2026-06-11T01:00:00Z'
  },
  {
    ...baseSession,
    id: 's4',
    name: 'Worktree Repo',
    cwd: '/repo/one/.claude/worktrees/abc123',
    status: 'running',
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
    worktree: {
      sourceCwd: '/repo/external',
      worktreeCwd: '/repo/external-worktree',
      branch: 'feature/external',
      createdByClaudeRemoteWeb: false
    },
    updatedAt: '2026-06-11T04:00:00Z'
  }
];

const defaultDeletedSessions = [
  {
    ...baseSession,
    id: 's3',
    name: 'Deleted Repo',
    cwd: '/repo/deleted',
    status: 'stopped',
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
      toolKind: 'Bash',
      title: 'Bash: sleep 10',
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

let sessions = defaultSessions;
let deletedSessions = defaultDeletedSessions;
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
        name: body.name ?? 'New Repo',
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
    if (url === '/api/sessions/s1' && init?.method === 'DELETE') {
      return jsonResponse({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/sessions/s2/resume' && init?.method === 'POST') {
      return jsonResponse({ ...sessions[1], status: 'running', updatedAt: '2026-06-12T00:00:00Z' });
    }
    if (url === '/api/sessions/s3/restore' && init?.method === 'POST') {
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
          defaultPermissionMode: 'acceptEdits'
        },
        file: {
          bind: '127.0.0.1:8787',
          dataDir: '/home/user/.claude-remote-web',
          launcher: ['claude'],
          webDir: null,
          defaultPermissionMode: 'acceptEdits'
        },
        restartRequired: false
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/input')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/stop-and-remove-worktree')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/restart')) {
      const session = sessions.find((item) => url.includes(item.id)) ?? sessions[0];
      return jsonResponse({ ...session, status: 'running', updatedAt: '2026-06-12T00:00:00Z' });
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
  it('loads sessions, tasks, and renders active event stream as conversation blocks', async () => {
    render(<App />);

    expect((await screen.findAllByText('Repo One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('/repo/one').length).toBeGreaterThan(0);
    expect(screen.getByText('Remote Claude session')).toBeInTheDocument();
    expect(await screen.findByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Bash: sleep 10')).toBeInTheDocument();
    expect(screen.getByText('Session tasks')).toBeInTheDocument();

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

  it('hides raw and system events from the event stream', async () => {
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
  });

  it('creates a session from the form and can include worktree request data', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByLabelText('Use git worktree'));
    fireEvent.click(screen.getByText('Create session'));

    expect((await screen.findAllByText('New Repo')).length).toBeGreaterThan(0);
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      cwd: '/repo/two',
      name: 'New Repo',
      worktree: { enabled: true }
    });
  });

  it('switches to active mode when creating from deleted mode', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Deleted' }));
    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByRole('heading', { name: 'New Repo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Deleted' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /Deleted Repo/ })).not.toBeInTheDocument();
  });

  it('shows create session errors', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '~' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByText('invalid request: cwd does not exist: ~')).toBeInTheDocument();
  });

  it('shows recent working directory suggestions and fills the input', async () => {
    render(<App />);

    const suggestions = await screen.findByLabelText('Recent working directories');
    expect(within(suggestions).getByText('/repo/one')).toBeInTheDocument();
    expect(within(suggestions).getByText('/repo/stopped')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use /repo/stopped' }));

    expect(screen.getByLabelText('Working directory')).toHaveValue('/repo/stopped');
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

  it('sends user input to the active session and preserves text on send failure', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));

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
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByRole('alert')).toHaveTextContent('input failed');
    expect(screen.getByLabelText('Message')).toHaveValue('retry work');
  });

  it('renders actions by active session status and resumes stopped sessions', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    fireEvent.click(sessionButton('Stopped Repo'));
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();

    const socketsBeforeResume = FakeWebSocket.instances.length;
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s2/resume', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(socketsBeforeResume + 1));
    expect(FakeWebSocket.instances.at(-1)?.url).toContain('/api/sessions/s2/events?afterId=0');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('renders Stop and Delete actions for starting sessions', async () => {
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name: 'Starting Repo',
        cwd: '/repo/starting',
        status: 'starting'
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Starting Repo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it.each(['exited', 'failed'])('renders Resume and Delete actions for %s sessions', async (status) => {
    const name = `${status[0].toUpperCase()}${status.slice(1)} Repo`;
    sessions = [
      {
        ...baseSession,
        id: 's1',
        name,
        cwd: `/repo/${status}`,
        status
      }
    ];

    render(<App />);

    expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
  });

  it('soft deletes an active session and removes it from the active list', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(querySessionButton('Repo One')).toBeNull());
    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
  });

  it('loads deleted sessions without opening a WebSocket or composer and restores them', async () => {
    render(<App />);

    await screen.findByRole('heading', { name: 'Repo One' });
    FakeWebSocket.instances = [];

    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));

    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions?deletedOnly=true', undefined);
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByText('Session tasks')).not.toBeInTheDocument();
    expect(FakeWebSocket.instances).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3/restore', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Deleted Repo/ })).not.toBeInTheDocument());
    expect(screen.getByText('No deleted sessions.')).toBeInTheDocument();
  });

  it('permanently deletes from the deleted list', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Deleted' }));
    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Permanently delete' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s3?permanent=true', expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Deleted Repo/ })).not.toBeInTheDocument());
    expect(screen.getByText('No deleted sessions.')).toBeInTheDocument();
  });

  it('ignores stale active list responses after switching to deleted mode', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));

    await act(async () => {
      deletedList.resolve();
      await deletedList.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();

    await act(async () => {
      activeList.resolve();
      await activeList.promise;
    });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Repo One' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();
  });

  it('keeps a newer valid selection when delete completes', async () => {
    const threeSessions = [
      ...defaultSessions,
      {
        ...baseSession,
        id: 's7',
        name: 'Newest Repo',
        cwd: '/repo/newest',
        status: 'running'
      }
    ];
    let resolveDelete!: () => void;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = () => resolve(jsonResponse({ ...threeSessions[0], deletedAt: '2026-06-12T00:00:00Z' }));
    });
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) return Promise.resolve(jsonResponse({ sessions: threeSessions }));
      if (url === '/api/tasks' || url.endsWith('/tasks')) return Promise.resolve(jsonResponse(emptyTaskGroups));
      if (url === '/api/sessions/s1' && init?.method === 'DELETE') return deletePromise;
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(sessionButton('Newest Repo'));

    await act(async () => {
      resolveDelete();
      await deletePromise;
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

  it('selects the owning session and refreshes tasks when a task is clicked', async () => {
    render(<App />);

    await screen.findByText('Bash: sleep 10');
    const taskListCallsBeforeSelection = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;

    fireEvent.click(screen.getAllByText('Bash: sleep 10')[0]);

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

    await waitFor(() => expect(taskRequests.length).toBeGreaterThanOrEqual(2));

    await act(async () => {
      taskRequests.at(-1)?.resolve(jsonResponse(taskGroupsWithTitle('Fresh global task')));
    });
    expect(await screen.findByText('Fresh global task')).toBeInTheDocument();

    await act(async () => {
      taskRequests[0].resolve(jsonResponse(taskGroupsWithTitle('Stale global task')));
    });

    expect(screen.getByText('Fresh global task')).toBeInTheDocument();
    expect(screen.queryByText('Stale global task')).not.toBeInTheDocument();
  });

  it('exposes selected state on the active and deleted list mode buttons', async () => {
    render(<App />);

    const activeButton = screen.getByRole('button', { name: 'Active' });
    const deletedButton = screen.getByRole('button', { name: 'Deleted' });

    expect(activeButton).toHaveAttribute('aria-pressed', 'true');
    expect(deletedButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(deletedButton);

    expect(activeButton).toHaveAttribute('aria-pressed', 'false');
    expect(deletedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the config view from the sidebar', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Config'));

    expect(await screen.findByText('Daemon config')).toBeInTheDocument();
  });
});
