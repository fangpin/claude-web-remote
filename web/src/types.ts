export type SessionStatus = 'starting' | 'running' | 'exited' | 'stopped' | 'failed';
export type SessionRuntimeStatus = 'starting' | 'running' | 'waiting' | 'ended' | 'stopped' | 'failed';
export type SessionListMode = 'active' | 'archived';

export type PermissionCapabilityStatus = 'available' | 'unavailable';

export type PermissionCapability = {
  status: PermissionCapabilityStatus;
  reason?: string | null;
};

export type PermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired' | 'failed';
export type PermissionEditable = 'bashCommand';

export type PermissionDecision =
  | { behavior: 'allow'; updatedInput?: unknown | null }
  | { behavior: 'deny'; message: string };

export type PendingPermissionRequest = {
  requestId: string;
  sessionId: string;
  hookSessionId?: string | null;
  toolName: string;
  toolInput: unknown;
  summary: string;
  cwd?: string | null;
  permissionMode?: string | null;
  status: PermissionStatus;
  editable?: PermissionEditable | null;
  decision?: PermissionDecision | null;
  createdAt: string;
  resolvedAt?: string | null;
};

export type PendingPermissionsResponse = {
  capability: PermissionCapability;
  pending: PendingPermissionRequest[];
};

export type WorktreeInfo = {
  sourceCwd: string;
  worktreeCwd: string;
  branch: string;
  baseRef?: string | null;
  createdByClaudeRemoteWeb: boolean;
};

export type WorktreeFileStatus = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  originalPath?: string | null;
};

export type WorktreeStatus = {
  sourceCwd: string;
  worktreeCwd: string;
  branch: string;
  baseRef?: string | null;
  dirty: boolean;
  changedFileCount: number;
  files: WorktreeFileStatus[];
  shortStatus: string[];
};

export type WorktreeDiffFile = {
  path: string;
  status: string;
  additions?: number | null;
  deletions?: number | null;
};

export type WorktreeDiff = {
  diff: string;
  files: WorktreeDiffFile[];
  truncated: boolean;
  limitBytes: number;
};

export type PreviewReferenceKind = 'read' | 'edited' | 'written' | 'searched' | 'mentioned';

export type PreviewFileReference = {
  path: string;
  kind: PreviewReferenceKind;
  eventId: number;
  title: string;
  snippet?: string;
};

export type SessionInfo = {
  id: string;
  name?: string | null;
  cwd: string;
  permissionMode: string;
  status: SessionStatus;
  runtimeStatus?: SessionRuntimeStatus;
  permissionCapability?: PermissionCapability;
  claudeSessionId?: string | null;
  groupId?: string | null;
  worktree?: WorktreeInfo | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionGroup = {
  id: string;
  name: string;
  sortOrder: number;
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
  permissionMode?: string;
  worktree?: {
    enabled: boolean;
  };
};

export type ComposerContextAttachment =
  | {
      id: string;
      type: 'path';
      path: string;
    }
  | {
      id: string;
      type: 'text';
      name: string;
      content: string;
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
  worktreesDir?: string | null;
  worktreeBranchPrefix: string;
  worktreeBaseRef: 'fresh' | 'head';
};

export type ManagedConfig = {
  path: string;
  exists: boolean;
  current: ConfigValues;
  file: ConfigValues;
  restartRequired: boolean;
};

export type DiagnosticStatus = 'healthy' | 'warning' | 'error';

export type PathDiagnostics = {
  status: DiagnosticStatus;
  path?: string | null;
  mode?: string | null;
  exists: boolean;
  isDirectory: boolean;
  writable?: boolean | null;
  hasIndexHtml?: boolean | null;
  message: string;
};

export type LauncherDiagnostics = {
  argv: string[];
  nativeArgsPreview: string[];
  fullArgvPreview: string[];
  status: DiagnosticStatus;
  issues: string[];
};

export type ConfigDiagnostics = {
  configPath: string;
  configFileExists: boolean;
  restartRequired: boolean;
  bind: string;
  defaultPermissionMode: string;
  worktreesDir?: string | null;
  worktreeBranchPrefix: string;
  worktreeBaseRef: 'fresh' | 'head';
};

export type SessionFailureSummary = {
  sessionId: string;
  sessionName?: string | null;
  cwd: string;
  status: SessionStatus;
  updatedAt: string;
  message: string;
  stderr: string[];
};

export type DiagnosticsResponse = {
  status: DiagnosticStatus;
  config: ConfigDiagnostics;
  launcher: LauncherDiagnostics;
  webDir: PathDiagnostics;
  dataDir: PathDiagnostics;
  recentSessionFailures: SessionFailureSummary[];
};

export type DiagnosticEventSummary = {
  id: number;
  time: string;
  kind: EventKind;
  message: string;
};

export type SessionDiagnosticMeta = {
  id: string;
  name?: string | null;
  cwd: string;
  status: SessionStatus;
  permissionMode: string;
  claudeSessionIdPresent: boolean;
  updatedAt: string;
};

export type SessionDiagnosticsResponse = {
  session: SessionDiagnosticMeta;
  status: DiagnosticStatus;
  summary: string;
  recentStderr: string[];
  recentErrors: DiagnosticEventSummary[];
  recentSystemEvents: DiagnosticEventSummary[];
  guidance: string[];
};
