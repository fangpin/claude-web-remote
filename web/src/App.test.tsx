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
});
