import { runtimeStatusLabels } from './AppShell';
import type { SessionInfo, SessionListMode, SessionRuntimeStatus, SessionStatus } from './types';

type RuntimeStatusKey = SessionRuntimeStatus | SessionStatus;

type ContinuityState = 'can-resume' | 'will-start-fresh' | 'cannot-resume' | 'active';

const restorableStatuses: RuntimeStatusKey[] = ['ended', 'exited', 'stopped', 'failed'];

export function getRuntimeStatus(session: SessionInfo): RuntimeStatusKey {
  return session.runtimeStatus ?? session.status;
}

export function getSessionRuntimeLabel(session: SessionInfo, listMode: SessionListMode): string {
  if (listMode === 'archived' || session.deletedAt) return 'Archived';
  return runtimeStatusLabels[getRuntimeStatus(session)];
}

export function getContinuityState(session: SessionInfo, listMode: SessionListMode): ContinuityState {
  if (listMode === 'archived' || session.deletedAt) return 'cannot-resume';
  if (!restorableStatuses.includes(getRuntimeStatus(session))) return 'active';
  return session.claudeSessionId ? 'can-resume' : 'will-start-fresh';
}

export function getContinuityLabel(session: SessionInfo, listMode: SessionListMode): string | null {
  const state = getContinuityState(session, listMode);
  if (state === 'can-resume') return 'Can resume';
  if (state === 'will-start-fresh') return 'Will start fresh';
  if (state === 'cannot-resume') return 'Cannot resume';
  return null;
}

export function getContinueActionLabel(session: SessionInfo): string {
  return session.claudeSessionId ? 'Resume conversation' : 'Start fresh from this workspace';
}

export function getComposerDisabledReason(session: SessionInfo | null, listMode: SessionListMode): string {
  if (!session) return 'Select a session to send a message.';
  if (listMode === 'archived' || session.deletedAt) return 'Archived sessions are read-only. Unarchive to continue.';
  if (session.status === 'starting') return 'Claude is starting. You can send once the session is ready.';
  if (session.status === 'running') return '';
  if (session.claudeSessionId) return 'This session is stopped. Resume the conversation to continue.';
  return 'This session cannot resume its Claude context. Start fresh from this workspace to continue.';
}
