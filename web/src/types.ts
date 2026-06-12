export type SessionStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';

export type WorktreeInfo = {
  sourceCwd: string;
  worktreeCwd: string;
  branch: string;
  createdByClaudeRemoteWeb: boolean;
};

export type SessionInfo = {
  id: string;
  name?: string | null;
  cwd: string;
  permissionMode: string;
  status: SessionStatus;
  claudeSessionId?: string | null;
  worktree?: WorktreeInfo | null;
  deletedAt?: string | null;
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
  worktree?: {
    enabled: boolean;
  };
};

export type TaskStatus = 'background' | 'completed' | 'failed' | 'interrupted';

export type TaskInfo = {
  id: string;
  sessionId: string;
  sessionName?: string | null;
  sessionCwd: string;
  toolKind: string;
  title: string;
  status: TaskStatus;
  startedAt: string;
  finishedAt?: string | null;
  startEventId: number;
  finishEventId?: number | null;
  summary?: string | null;
};

export type TaskGroups = {
  background: TaskInfo[];
  finished: TaskInfo[];
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
