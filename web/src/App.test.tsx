import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const sessions = [
  {
    id: 's1',
    name: 'Repo One',
    cwd: '/repo/one',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T02:00:00Z'
  },
  {
    id: 's2',
    name: 'Repo Two',
    cwd: '/repo/two',
    permissionMode: 'acceptEdits',
    status: 'stopped',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T01:00:00Z'
  },
  {
    id: 's3',
    name: 'Repo One Old',
    cwd: '/repo/one',
    permissionMode: 'acceptEdits',
    status: 'stopped',
    claudeSessionId: null,
    createdAt: '2026-06-10T00:00:00Z',
    updatedAt: '2026-06-10T00:00:00Z'
  },
  {
    id: 's4',
    name: 'Worktree Repo',
    cwd: '/repo/one/.claude/worktrees/abc123',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    worktree: {
      sourceCwd: '/repo/one',
      worktreeCwd: '/repo/one/.claude/worktrees/abc123',
      branch: 'pin/abc123',
      createdByClaudeRemoteWeb: true
    },
    createdAt: '2026-06-11T03:00:00Z',
    updatedAt: '2026-06-11T03:00:00Z'
  },
  {
    id: 's5',
    name: 'External Worktree Repo',
    cwd: '/repo/external-worktree',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    worktree: {
      sourceCwd: '/repo/external',
      worktreeCwd: '/repo/external-worktree',
      branch: 'feature/external',
      createdByClaudeRemoteWeb: false
    },
    createdAt: '2026-06-11T04:00:00Z',
    updatedAt: '2026-06-11T04:00:00Z'
  },
  {
    id: 's6',
    name: 'Long Path Repo',
    cwd: '/data00/home/user/repos/very/long/path/that/should/still/be/available/in/full',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T05:00:00Z',
    updatedAt: '2026-06-11T05:00:00Z'
  }
];

const taskGroups = {
  background: [
    {
      id: 's2:toolu_1',
      sessionId: 's2',
      sessionName: 'Repo Two',
      sessionCwd: '/repo/two',
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

type DeferredResponse = {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deferredResponse(): DeferredResponse {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
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
        sessionName: sessionId === 's2' ? 'Repo Two' : 'Repo One',
        sessionCwd: sessionId === 's2' ? '/repo/two' : '/repo/one',
        title
      }
    ]
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let scrollIntoViewMock: ReturnType<typeof vi.fn>;

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
        updatedAt: '2026-06-11T05:00:00Z'
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
    if (url.endsWith('/input')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/stop-and-remove-worktree')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/stop')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/restart')) {
      return jsonResponse(sessions[0]);
    }
    return jsonResponse({ error: 'unexpected request' }, 500);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('loads sessions and renders active event stream', async () => {
    render(<App />);

    expect((await screen.findAllByText('Repo One')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('/repo/one').length).toBeGreaterThan(0);
    expect(screen.getByText('Remote Claude session')).toBeInTheDocument();

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

  it('renders background Bash tool use as a running task block', async () => {
    render(<App />);

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 2,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'assistant',
      payload: {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Bash',
        input: {
          command: 'npm --prefix web test',
          description: 'Run frontend tests',
          run_in_background: true
        }
      }
    });
    FakeWebSocket.instances[0].emit({
      id: 3,
      sessionId: 's1',
      time: '2026-06-11T00:00:01Z',
      kind: 'user',
      payload: {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: 'Task started in background\nOutput file: /tmp/test.log'
      }
    });

    expect(await screen.findByText('Run frontend tests')).toBeInTheDocument();
    expect(screen.getAllByText('running').length).toBeGreaterThan(1);
    expect(screen.getByText('/tmp/test.log')).toBeInTheDocument();
  });

  it('keeps the full working directory available on long session labels', async () => {
    render(<App />);

    expect(
      (await screen.findAllByTitle('/data00/home/user/repos/very/long/path/that/should/still/be/available/in/full')).length
    ).toBeGreaterThan(0);
  });

  it('only renders the most recent events for long streams', async () => {
    render(<App />);

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    for (let id = 1; id <= 90; id += 1) {
      FakeWebSocket.instances[0].emit({
        id,
        sessionId: 's1',
        time: '2026-06-11T00:00:00Z',
        kind: 'assistant',
        payload: { message: `event ${id}` }
      });
    }

    expect((await screen.findAllByText(/event 90/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^event 1$/)).not.toBeInTheDocument();
    expect(screen.getByText(/Showing latest 80 events/)).toBeInTheDocument();
  });

  it('scrolls to the composer when selecting a session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Repo Two'));

    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
  });

  it('only renders the most recent tasks in long task lists', async () => {
    const longTasks = Array.from({ length: 10 }, (_, index) => ({
      ...taskGroups.finished[0],
      id: `s1:task-${index + 1}`,
      title: `Finished task ${index + 1}`
    }));
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') return jsonResponse({ sessions });
      if (url === '/api/tasks' || url.endsWith('/tasks')) {
        return jsonResponse({ background: [], finished: longTasks });
      }
      return jsonResponse({ ok: true });
    });

    render(<App />);

    expect(await screen.findByText('Finished task 10')).toBeInTheDocument();
    expect(screen.queryByText('Finished task 1')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Showing latest 8/).length).toBeGreaterThan(0);
  });

  it('creates a session from the form', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Repo' } });
    fireEvent.click(screen.getByText('Create session'));

    expect((await screen.findAllByText('New Repo')).length).toBeGreaterThan(0);
  });

  it('shows create session errors', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '~' } });
    fireEvent.click(screen.getByText('Create session'));

    expect(await screen.findByText('invalid request: cwd does not exist: ~')).toBeInTheDocument();
  });

  it('shows slash command suggestions while typing a command prefix', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });

    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /\/help/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /\/status/ })).not.toBeInTheDocument();
  });

  it('completes the active slash command with Tab without sending input', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
    fireEvent.keyDown(messageInput, { key: 'Tab' });

    expect(messageInput.value).toBe('/help ');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.anything());
  });

  it('completes the active slash command with Enter while suggestions are open', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });
    fireEvent.keyDown(messageInput, { key: 'Enter' });

    expect(messageInput.value).toBe('/help ');
    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.anything());
  });

  it('closes slash command suggestions with Escape', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/', selectionStart: 1 } });
    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();

    fireEvent.keyDown(messageInput, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Claude command suggestions' })).not.toBeInTheDocument();
  });

  it('moves the active suggestion with arrow keys', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/', selectionStart: 1 } });

    const listbox = await screen.findByRole('listbox', { name: 'Claude command suggestions' });
    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(messageInput, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(messageInput, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('completes a clicked slash command suggestion', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message') as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: '/sta', selectionStart: 4 } });
    fireEvent.click(await screen.findByRole('option', { name: /\/status/ }));

    expect(messageInput.value).toBe('/status ');
  });

  it('shows recent working directory suggestions and fills the input', async () => {
    render(<App />);

    const suggestions = await screen.findByLabelText('Recent working directories');
    expect(within(suggestions).getByText('/repo/one')).toBeInTheDocument();
    expect(within(suggestions).getByText('/repo/two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use /repo/two' }));

    expect(screen.getByLabelText('Working directory')).toHaveValue('/repo/two');
  });

  it('sends worktree enabled when the switch is selected', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByLabelText('Use git worktree'));
    fireEvent.click(screen.getByText('Create session'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' })));
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      cwd: '/repo/two',
      worktree: { enabled: true }
    });
  });

  it('omits worktree when the switch is not selected', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Working directory'), { target: { value: '/repo/two' } });
    fireEvent.click(screen.getByText('Create session'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.objectContaining({ method: 'POST' })));
    const createCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/sessions' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body)).worktree).toBeUndefined();
  });

  it('renders worktree source and branch metadata', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));

    expect(screen.getByText('Source: /repo/one')).toBeInTheDocument();
    expect(screen.getByText('Branch: pin/abc123')).toBeInTheDocument();
  });

  it('offers stop and remove for worktree sessions', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));
    fireEvent.click(screen.getByText('Stop and remove worktree'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop-and-remove-worktree', expect.objectContaining({ method: 'POST' })));
  });

  it('keeps stop-only behavior for worktree sessions', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));
    fireEvent.click(screen.getByText('Stop only'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s4/stop', expect.objectContaining({ method: 'POST' })));
  });

  it('updates local worktree state after stop and remove succeeds', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));
    fireEvent.click(screen.getByText('Stop and remove worktree'));

    await waitFor(() => expect(screen.queryByText('Branch: pin/abc123')).not.toBeInTheDocument());
    const activeHeader = screen.getByRole('heading', { name: 'Worktree Repo' }).closest('header');
    expect(activeHeader).not.toBeNull();
    expect(within(activeHeader as HTMLElement).getByText('/repo/one')).toBeInTheDocument();
    expect(within(activeHeader as HTMLElement).getByText('Stop')).toBeInTheDocument();
  });

  it('marks worktree sessions stopped when stop succeeds but removal fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') {
        return jsonResponse({ sessions });
      }
      if (url === '/api/tasks' || url.endsWith('/tasks')) {
        return jsonResponse(emptyTaskGroups);
      }
      if (url.endsWith('/stop-and-remove-worktree')) {
        return jsonResponse({ error: 'worktree has uncommitted changes' }, 400);
      }
      return jsonResponse({ ok: true });
    });
    render(<App />);

    fireEvent.click(await screen.findByText('Worktree Repo'));
    fireEvent.click(screen.getByText('Stop and remove worktree'));

    expect(await screen.findByRole('alert')).toHaveTextContent('worktree has uncommitted changes');
    const activeHeader = screen.getByRole('heading', { name: 'Worktree Repo' }).closest('header');
    expect(activeHeader).not.toBeNull();
    expect(within(activeHeader as HTMLElement).getByText('/repo/one/.claude/worktrees/abc123')).toBeInTheDocument();
    expect(within(activeHeader as HTMLElement).getByText('Branch: pin/abc123')).toBeInTheDocument();
    const activeSessionButton = screen.getByRole('button', { name: /^Worktree Repo/ });
    expect(within(activeSessionButton).getByText('stopped')).toBeInTheDocument();
  });

  it('hides remove action for worktrees not created by this app', async () => {
    render(<App />);

    fireEvent.click(await screen.findByText('External Worktree Repo'));

    expect(screen.queryByText('Stop and remove worktree')).not.toBeInTheDocument();
    expect(screen.getByText('Stop only')).toBeInTheDocument();
  });

  it('sends user input to the active session', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
  });

  it('hides slash command suggestions after sending a command prefix', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: '/he', selectionStart: 3 } });

    expect(await screen.findByRole('listbox', { name: 'Claude command suggestions' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    expect(screen.queryByRole('listbox', { name: 'Claude command suggestions' })).not.toBeInTheDocument();
  });

  it('sends user input when Enter is pressed in the composer', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: 'do keyboard work' } });
    fireEvent.keyDown(messageInput, { key: 'Enter', code: 'Enter', charCode: 13 });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: 'do keyboard work' })
    }));
    expect(messageInput).toHaveValue('');
  });

  it('keeps Shift+Enter as multiline input in the composer', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: 'line one' } });
    const shiftEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    messageInput.dispatchEvent(shiftEnterEvent);
    expect(shiftEnterEvent.defaultPrevented).toBe(false);
    fireEvent.change(messageInput, { target: { value: 'line one\nline two' } });

    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' }));
    expect(messageInput).toHaveValue('line one\nline two');
  });

  it('leaves composing Enter to the IME in the composer', async () => {
    render(<App />);

    const messageInput = await screen.findByLabelText('Message');
    fireEvent.change(messageInput, { target: { value: 'composing text' } });
    const composingEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    });
    Object.defineProperty(composingEnterEvent, 'isComposing', { value: true });
    messageInput.dispatchEvent(composingEnterEvent);

    expect(fetchMock).not.toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' }));
    expect(composingEnterEvent.defaultPrevented).toBe(false);
  });

  it('renders global and active-session task panels', async () => {
    render(<App />);

    expect(await screen.findByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Bash: sleep 10')).toBeInTheDocument();
    expect(screen.getByText('Agent: Review branch')).toBeInTheDocument();
    expect(await screen.findByText('Session tasks')).toBeInTheDocument();
    expect(screen.getAllByText('No issues found').length).toBeGreaterThan(0);
  });

  it('selects the owning session and refreshes global tasks when a task is clicked', async () => {
    render(<App />);

    await screen.findByText('Bash: sleep 10');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/tasks', undefined));
    const taskListCallsBeforeSelection = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;

    fireEvent.click(screen.getByText('Bash: sleep 10'));

    await waitFor(() => expect(screen.getAllByText('Repo Two').length).toBeGreaterThan(0));
    await waitFor(() => expect(FakeWebSocket.instances.at(-1)?.url).toContain('/api/sessions/s2/events'));
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
        const request = deferredResponse();
        taskRequests.push(request);
        return request.promise;
      }
      if (url === '/api/sessions/s1/tasks') return Promise.resolve(jsonResponse(emptyTaskGroups));
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });

    render(<App />);

    await waitFor(() => expect(taskRequests.length).toBeGreaterThanOrEqual(3));

    await act(async () => {
      taskRequests[2].resolve(jsonResponse(taskGroupsWithTitle('Fresh global task')));
    });
    expect(await screen.findByText('Fresh global task')).toBeInTheDocument();

    await act(async () => {
      taskRequests[0].resolve(jsonResponse(taskGroupsWithTitle('Stale global task')));
    });

    expect(screen.getByText('Fresh global task')).toBeInTheDocument();
    expect(screen.queryByText('Stale global task')).not.toBeInTheDocument();
  });

  it('keeps active-session tasks from the selected session when older requests resolve later', async () => {
    const s1TaskRequests: DeferredResponse[] = [];
    const s2TaskRequests: DeferredResponse[] = [];
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') return Promise.resolve(jsonResponse({ sessions }));
      if (url === '/api/tasks') return Promise.resolve(jsonResponse(emptyTaskGroups));
      if (url === '/api/sessions/s1/tasks') {
        const request = deferredResponse();
        s1TaskRequests.push(request);
        return request.promise;
      }
      if (url === '/api/sessions/s2/tasks') {
        const request = deferredResponse();
        s2TaskRequests.push(request);
        return request.promise;
      }
      return Promise.resolve(jsonResponse({ error: 'unexpected request' }, 500));
    });

    render(<App />);

    await screen.findByText('Repo Two');
    await waitFor(() => expect(s1TaskRequests.length).toBe(1));
    fireEvent.click(screen.getByText('Repo Two'));
    await waitFor(() => expect(s2TaskRequests.length).toBe(1));

    await act(async () => {
      s2TaskRequests[0].resolve(jsonResponse(taskGroupsWithTitle('Session task for s2', 's2')));
    });
    expect(await screen.findByText('Session task for s2')).toBeInTheDocument();

    await act(async () => {
      s1TaskRequests[0].resolve(jsonResponse(taskGroupsWithTitle('Session task for s1', 's1')));
    });

    expect(screen.getByText('Session task for s2')).toBeInTheDocument();
    expect(screen.queryByText('Session task for s1')).not.toBeInTheDocument();
  });

  it('polls global tasks while mounted and stops polling after unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<App />);
    await act(async () => {});

    const callsBeforePolling = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const callsAfterPolling = fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length;
    expect(callsAfterPolling).toBeGreaterThan(callsBeforePolling);

    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/tasks').length).toBe(callsAfterPolling);
  });

  it('scrolls to and highlights a task start event when the task is clicked', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView
    });

    render(<App />);

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 5,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'assistant',
      payload: { message: 'target event' }
    });
    expect(await screen.findByText('target event')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Agent: Review branch')[0]);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' }));
    expect(document.getElementById('event-5')).toHaveClass('event-highlight');
  });
});
