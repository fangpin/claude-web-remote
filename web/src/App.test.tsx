import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    updatedAt: '2026-06-11T00:00:00Z'
  },
  {
    id: 's2',
    name: 'Repo Two',
    cwd: '/repo/two',
    permissionMode: 'acceptEdits',
    status: 'running',
    claudeSessionId: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z'
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
      return jsonResponse({ ...sessions[0], id: 's2', name: 'New Repo', cwd: '/repo/two' });
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
    if (url.endsWith('/input')) {
      return jsonResponse({ ok: true });
    }
    if (url.endsWith('/stop') || url.endsWith('/restart')) {
      return jsonResponse({ ok: true });
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

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    FakeWebSocket.instances[0].emit({
      id: 1,
      sessionId: 's1',
      time: '2026-06-11T00:00:00Z',
      kind: 'assistant',
      payload: { message: 'hello from claude' }
    });

    expect(await screen.findByText(/hello from claude/)).toBeInTheDocument();
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

  it('sends user input to the active session', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
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
