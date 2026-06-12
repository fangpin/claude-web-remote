export type SessionStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';

export type SessionInfo = {
  id: string;
  name?: string | null;
  cwd: string;
  permissionMode: string;
  status: SessionStatus;
  claudeSessionId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EventKind = 'assistant' | 'user' | 'tool' | 'system' | 'error' | 'raw';

export type UiEvent = {
  id: number;
  sessionId: string;
  time: string;
  kind: EventKind;
  payload: unknown;
};

export type CreateSessionInput = {
  cwd: string;
  name?: string;
  permissionMode?: string;
};

export type ConfigValues = {
  bind: string;
  dataDir: string;
  launcher: string[];
  webDir?: string | null;
  defaultPermissionMode: string;
};

export type ManagedConfig = {
  path: string;
  exists: boolean;
  current: ConfigValues;
  file: ConfigValues;
  restartRequired: boolean;
};
