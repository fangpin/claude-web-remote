import type { ConfigValues, CreateSessionInput, ManagedConfig, SessionInfo } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const requestInit: RequestInit | undefined = init
    ? {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers ?? {})
        }
      }
    : undefined;
  const response = await fetch(path, requestInit);

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(String(body.error ?? response.statusText));
  }

  return response.json() as Promise<T>;
}

export async function listSessions(): Promise<SessionInfo[]> {
  const result = await request<{ sessions: SessionInfo[] }>('/api/sessions');
  return result.sessions;
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  return request<SessionInfo>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function getConfig(): Promise<ManagedConfig> {
  return request<ManagedConfig>('/api/config');
}

export async function updateConfig(input: ConfigValues): Promise<ManagedConfig> {
  return request<ManagedConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export async function sendInput(sessionId: string, text: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/input`, {
    method: 'POST',
    body: JSON.stringify({ text })
  });
}

export async function stopSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
}

export async function restartSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/restart`, { method: 'POST' });
}

export function eventsUrl(sessionId: string, afterId = 0): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/events?afterId=${afterId}`;
}
