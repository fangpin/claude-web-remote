import type { PendingPermissionRequest, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;

function isObject(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function permissionFromPayload(payload: unknown): PendingPermissionRequest | null {
  if (!isObject(payload) || !isObject(payload.permission)) return null;
  const permission = payload.permission as Partial<PendingPermissionRequest>;
  if (typeof permission.requestId !== 'string') return null;
  if (typeof permission.sessionId !== 'string') return null;
  if (typeof permission.toolName !== 'string') return null;
  if (typeof permission.summary !== 'string') return null;
  if (typeof permission.status !== 'string') return null;
  if (typeof permission.createdAt !== 'string') return null;
  return permission as PendingPermissionRequest;
}

export function permissionsFromEvents(events: UiEvent[]): PendingPermissionRequest[] {
  const pending = new Map<string, PendingPermissionRequest>();
  for (const event of events) {
    if (!isObject(event.payload)) continue;
    const type = event.payload.type;
    const permission = permissionFromPayload(event.payload);
    if (!permission) continue;
    if (type === 'permission_request' && permission.status === 'pending') {
      pending.set(permission.requestId, permission);
      continue;
    }
    if (type === 'permission_resolved' || type === 'permission_expired') {
      pending.delete(permission.requestId);
    }
  }
  return Array.from(pending.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function mergePendingPermissions(
  fromEvents: PendingPermissionRequest[],
  fromApi: PendingPermissionRequest[]
): PendingPermissionRequest[] {
  const byId = new Map<string, PendingPermissionRequest>();
  for (const permission of fromEvents) byId.set(permission.requestId, permission);
  for (const permission of fromApi) byId.set(permission.requestId, permission);
  return Array.from(byId.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
