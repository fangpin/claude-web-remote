import type {
  ConfigValues,
  CreateSessionInput,
  DiagnosticsResponse,
  ManagedConfig,
  SessionDiagnosticsResponse,
  SessionGroup,
  SessionInfo,
  TaskGroups,
  UiEvent,
  WorktreeDiff,
  WorktreeStatus
} from './types';

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

export async function listSessions(options: { archivedOnly?: boolean; deletedOnly?: boolean; includeDeleted?: boolean } = {}): Promise<SessionInfo[]> {
  const params = new URLSearchParams();
  if (options.archivedOnly || options.deletedOnly) params.set('deletedOnly', 'true');
  if (options.includeDeleted) params.set('includeDeleted', 'true');
  const query = params.toString();
  const result = await request<{ sessions: SessionInfo[] }>(`/api/sessions${query ? `?${query}` : ''}`);
  return result.sessions;
}

export async function listTasks(): Promise<TaskGroups> {
  return request<TaskGroups>('/api/tasks');
}

export async function listSessionGroups(): Promise<SessionGroup[]> {
  const result = await request<{ groups?: SessionGroup[] }>('/api/session-groups');
  return Array.isArray(result.groups) ? result.groups : [];
}

export async function createSessionGroup(input: { name: string }): Promise<SessionGroup> {
  return request<SessionGroup>('/api/session-groups', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function updateSessionGroup(groupId: string, input: { name?: string; sortOrder?: number }): Promise<SessionGroup> {
  return request<SessionGroup>(`/api/session-groups/${groupId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function deleteSessionGroup(groupId: string): Promise<void> {
  await request<{ ok: true }>(`/api/session-groups/${groupId}`, { method: 'DELETE' });
}

export async function listSessionTasks(sessionId: string): Promise<TaskGroups> {
  return request<TaskGroups>(`/api/sessions/${sessionId}/tasks`);
}

export async function listSessionEvents(sessionId: string, afterId = 0, limit?: number, beforeId?: number): Promise<UiEvent[]> {
  const params = new URLSearchParams();
  if (afterId > 0) params.set('afterId', String(afterId));
  if (beforeId && beforeId > 0) params.set('beforeId', String(beforeId));
  if (limit && limit > 0) params.set('limit', String(limit));
  const query = params.toString();
  const result = await request<{ events: UiEvent[] }>(`/api/sessions/${sessionId}/transcript${query ? `?${query}` : ''}`);
  return Array.isArray(result.events) ? result.events : [];
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

export async function getDiagnostics(): Promise<DiagnosticsResponse> {
  return request<DiagnosticsResponse>('/api/diagnostics');
}

export async function getSessionDiagnostics(sessionId: string): Promise<SessionDiagnosticsResponse> {
  return request<SessionDiagnosticsResponse>(`/api/sessions/${sessionId}/diagnostics`);
}

export async function updateSession(sessionId: string, input: { name?: string | null; groupId?: string | null }): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  });
}

export async function sendInput(sessionId: string, text: string): Promise<SessionInfo | null> {
  const result = await request<{ ok: true; session?: SessionInfo }>(`/api/sessions/${sessionId}/input`, {
    method: 'POST',
    body: JSON.stringify({ text })
  });
  return result.session ?? null;
}

export async function stopSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}/stop`, { method: 'POST' });
}

export async function getWorktreeStatus(sessionId: string): Promise<WorktreeStatus> {
  return request<WorktreeStatus>(`/api/sessions/${sessionId}/worktree-status`);
}

export async function getWorktreeDiff(sessionId: string): Promise<WorktreeDiff> {
  return request<WorktreeDiff>(`/api/sessions/${sessionId}/worktree-diff`);
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

export async function archiveSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/archive`, { method: 'POST' });
}

export async function unarchiveSession(sessionId: string): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/sessions/${sessionId}/unarchive`, { method: 'POST' });
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request<{ ok: true }>(`/api/sessions/${sessionId}?permanent=true`, { method: 'DELETE' });
}

export function eventsUrl(sessionId: string, afterId = 0): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/sessions/${sessionId}/events?afterId=${afterId}`;
}
