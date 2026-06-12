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
