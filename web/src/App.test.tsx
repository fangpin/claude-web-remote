import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    status: 'running'
  },
  {
    ...baseSession,
    id: 's2',
    name: 'Stopped Repo',
    cwd: '/repo/stopped',
    status: 'stopped',
    claudeSessionId: 'claude-s2'
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

let sessions = defaultSessions;
let deletedSessions = defaultDeletedSessions;
let fetchMock: ReturnType<typeof vi.fn>;

function createDeferredResponse(body: unknown) {
  let resolve!: () => void;
  const promise = new Promise<Response>((deferredResolve) => {
    resolve = () => deferredResolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  return { promise, resolve };
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
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/sessions' && !init) {
      return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions?deletedOnly=true' && !init) {
      return new Response(JSON.stringify({ sessions: deletedSessions }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (body.cwd === '~') {
        return new Response(JSON.stringify({ error: 'invalid request: cwd does not exist: ~' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ...sessions[0], id: 's4', name: 'New Repo', cwd: '/repo/two' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s1' && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ ...sessions[0], deletedAt: '2026-06-12T00:00:00Z', updatedAt: '2026-06-12T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s2/resume' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ...sessions[1], status: 'running', updatedAt: '2026-06-12T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s3/restore' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ...deletedSessions[0], deletedAt: null, updatedAt: '2026-06-12T01:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions/s3?permanent=true' && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/input')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/restart')) {
      const session = sessions.find((item) => url.includes(item.id)) ?? sessions[0];
      return new Response(JSON.stringify({ ...session, status: 'running', updatedAt: '2026-06-12T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/stop')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('confirm', vi.fn(() => true));
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

  it('renders actions by active session status', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/restart', expect.objectContaining({ method: 'POST' })));

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/stop', expect.objectContaining({ method: 'POST' })));

    fireEvent.click(screen.getByRole('button', { name: /Stopped Repo/ }));

    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.queryByRole('button', { name: /Repo One/ })).not.toBeInTheDocument());
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

  it('resumes a stopped session and updates the selected session', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Stopped Repo/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s2/resume', expect.objectContaining({ method: 'POST' })));
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });

  it('ignores stale active list responses after switching to deleted mode', async () => {
    const activeList = createDeferredResponse({ sessions: defaultSessions });
    const deletedList = createDeferredResponse({ sessions: defaultDeletedSessions });
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') return activeList.promise;
      if (url === '/api/sessions?deletedOnly=true') return deletedList.promise;
      return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 }));
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

  it('clears active session actions while deleted sessions are loading', async () => {
    const deletedList = createDeferredResponse({ sessions: defaultDeletedSessions });
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/sessions') {
        return Promise.resolve(new Response(JSON.stringify({ sessions: defaultSessions }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url === '/api/sessions?deletedOnly=true') return deletedList.promise;
      return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));

    expect(screen.queryByRole('heading', { name: 'Repo One' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Permanently delete' })).not.toBeInTheDocument();

    await act(async () => {
      deletedList.resolve();
      await deletedList.promise;
    });

    expect(await screen.findByRole('heading', { name: 'Deleted Repo' })).toBeInTheDocument();
  });

  it('only shows the composer for running active sessions', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Stopped Repo/ }));

    expect(await screen.findByRole('heading', { name: 'Stopped Repo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('shows send errors and preserves the unsent message', async () => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) {
        return new Response(JSON.stringify({ sessions: defaultSessions }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === '/api/sessions/s1/input' && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'input failed' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    expect(await screen.findByRole('alert')).toHaveTextContent('input failed');
    expect(screen.getByLabelText('Message')).toHaveValue('do work');
  });

  it('keeps a newer valid selection when delete completes', async () => {
    const threeSessions = [
      ...defaultSessions,
      {
        ...baseSession,
        id: 's5',
        name: 'Newest Repo',
        cwd: '/repo/newest',
        status: 'running'
      }
    ];
    let resolveDelete!: () => void;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = () => resolve(new Response(JSON.stringify({ ...threeSessions[0], deletedAt: '2026-06-12T00:00:00Z' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
    fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/sessions' && !init) {
        return Promise.resolve(new Response(JSON.stringify({ sessions: threeSessions }), { status: 200, headers: { 'content-type': 'application/json' } }));
      }
      if (url === '/api/sessions/s1' && init?.method === 'DELETE') return deletePromise;
      return Promise.resolve(new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Repo One' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: /Newest Repo/ }));

    await act(async () => {
      resolveDelete();
      await deletePromise;
    });

    await waitFor(() => expect(screen.queryByRole('button', { name: /Repo One/ })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Newest Repo' })).toBeInTheDocument();
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
});
