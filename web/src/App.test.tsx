import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    updatedAt: '2026-06-11T00:00:00Z'
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
      return new Response(JSON.stringify({ ...sessions[0], id: 's2', name: 'New Repo', cwd: '/repo/two' }), { status: 200, headers: { 'content-type': 'application/json' } });
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
});
