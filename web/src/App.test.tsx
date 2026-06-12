import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  }
];

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
      return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url === '/api/sessions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      if (body.cwd === '~') {
        return new Response(JSON.stringify({ error: 'invalid request: cwd does not exist: ~' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ...sessions[0], id: 's4', name: body.name ?? 'New Repo', cwd: body.cwd }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/input')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/stop') || url.endsWith('/restart')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('WebSocket', FakeWebSocket);
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

  it('sends user input to the active session', async () => {
    render(<App />);

    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'do work' } });
    fireEvent.click(screen.getByText('Send'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/input', expect.objectContaining({ method: 'POST' })));
  });
});
