import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfigView from './ConfigView';

let fetchMock: ReturnType<typeof vi.fn>;

const configResponse = {
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
};

beforeEach(() => {
  cleanup();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/config' && !init) {
      return new Response(JSON.stringify(configResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url === '/api/config' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      if (body.bind === 'bad-bind') {
        return new Response(JSON.stringify({ error: 'invalid request: invalid bind address' }), {
          status: 400,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ ...configResponse, file: body, exists: true, restartRequired: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ error: 'unexpected request' }), { status: 500 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('ConfigView', () => {
  it('loads and renders config values', async () => {
    render(<ConfigView />);

    expect(await screen.findByDisplayValue('127.0.0.1:8787')).toBeInTheDocument();
    expect(screen.getByText('/home/user/.claude-remote-web/config.toml')).toBeInTheDocument();
    expect(screen.getByDisplayValue('claude')).toBeInTheDocument();
  });

  it('saves edited values and shows restart message', async () => {
    render(<ConfigView />);

    fireEvent.change(await screen.findByLabelText('Bind address'), { target: { value: '127.0.0.1:8789' } });
    fireEvent.change(screen.getByLabelText('Launcher argv'), { target: { value: 'ttadk\nclaude\n-a' } });
    fireEvent.change(screen.getByLabelText('Default permission mode'), { target: { value: 'auto' } });
    fireEvent.click(screen.getByText('Save config'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/config', expect.objectContaining({ method: 'PUT' })));
    const [, init] = fetchMock.mock.calls.find(([url, requestInit]) => String(url) === '/api/config' && requestInit?.method === 'PUT')!;
    expect(JSON.parse(String(init.body))).toEqual({
      bind: '127.0.0.1:8789',
      dataDir: '/home/user/.claude-remote-web',
      launcher: ['ttadk', 'claude', '-a'],
      webDir: null,
      defaultPermissionMode: 'auto'
    });
    expect(await screen.findByText('Config saved. Restart the daemon for changes to take effect.')).toBeInTheDocument();
  });

  it('rejects empty launcher before saving', async () => {
    render(<ConfigView />);

    fireEvent.change(await screen.findByLabelText('Launcher argv'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save config'));

    expect(await screen.findByText('Launcher must contain at least one value.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows API save errors', async () => {
    render(<ConfigView />);

    fireEvent.change(await screen.findByLabelText('Bind address'), { target: { value: 'bad-bind' } });
    fireEvent.click(screen.getByText('Save config'));

    expect(await screen.findByText('invalid request: invalid bind address')).toBeInTheDocument();
  });
});
