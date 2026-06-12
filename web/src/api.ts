import type { CreateSessionInput, SessionInfo, TaskGroups } from './types';

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

export async function listSessions(options: { deletedOnly?: boolean; includeDeleted?: boolean } = {}): Promise<SessionInfo[]> {
  const params = new URLSearchParams();
  if (options.deletedOnly) params.set('deletedOnly', 'true');
  if (options.includeDeleted) params.set('includeDeleted', 'true');
  const query = params.toString();
  const result = await request<{ sessions: SessionInfo[] }>(`/api/sessions${query ? `?${query}` : ''}`);
  return result.sessions;
}

export async function listTasks(): Promise<TaskGroups> {
  return request<TaskGroups>('/api/tasks');
}

export async function listSessionTasks(sessionId: string): Promise<TaskGroups> {
  return request<TaskGroups>(`/api/sessions/${sessionId}/tasks`);
}

export async function createSession(input: CreateSessionInput): Promise<SessionInfo> {
  return request<SessionInfo>('/api/sessions', {
    method: 'POST',
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

export async function stopAndRemoveWorktree(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/stop-and-remove-worktree`, { method: 'POST' });
}

export async function restartSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/restart`, { method: 'POST' });
}

export async function resumeSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/resume`, { method: 'POST' });
}

export async function deleteSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function restoreSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/restore`, { method: 'POST' });
}

export async function permanentlyDeleteSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}?permanent=true`, { method: 'DELETE' });
}

export function eventsUrl(sessionId: string, afterId = 0): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/events?afterId=${afterId}`;
}
