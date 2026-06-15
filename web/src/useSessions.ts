import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveSession,
  createSession,
  createSessionGroup,
  deleteSession,
  deleteSessionGroup,
  getWorktreeStatus,
  listSessionGroups,
  listSessions,
  restartSession,
  resumeSession,
  sendInput,
  stopAndRemoveWorktree,
  stopSession,
  unarchiveSession,
  updateSession,
  updateSessionGroup
} from './api';
import { runtimeStatusLabels } from './AppShell';
import type { SessionGroup, SessionInfo, SessionListMode, WorktreeStatus } from './types';

type UseSessionsOptions = {
  setError: (error: string | null) => void;
  onTasksChanged?: () => void;
  onSessionTasksChanged?: (sessionId: string) => void;
  onDeleteSessionEvents?: (sessionId: string) => void;
};

export type RecentProject = {
  cwd: string;
  latestSession: SessionInfo;
  sessionCount: number;
  runningCount: number;
};

function projectCwdForSession(session: SessionInfo): string {
  return session.worktree?.sourceCwd ?? session.cwd;
}

function isLiveRuntime(session: SessionInfo): boolean {
  return ['starting', 'running', 'waiting'].includes(session.runtimeStatus ?? session.status);
}

function defaultStartCwd(recentSessions: SessionInfo[], recentProjects: RecentProject[]): string {
  const waitingSession = recentSessions.find((session) => (session.runtimeStatus ?? session.status) === 'waiting');
  const runningSession = recentSessions.find((session) => !session.worktree && (session.runtimeStatus ?? session.status) === 'running');
  const directSession = recentSessions.find((session) => !session.worktree);
  return waitingSession ? projectCwdForSession(waitingSession) : runningSession?.cwd ?? directSession?.cwd ?? recentProjects[0]?.cwd ?? '';
}

export function useSessions({
  setError,
  onTasksChanged,
  onSessionTasksChanged,
  onDeleteSessionEvents
}: UseSessionsOptions) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionGroups, setSessionGroups] = useState<SessionGroup[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listModeState, setListModeState] = useState<SessionListMode>('active');
  const [sessionSearch, setSessionSearch] = useState('');
  const [isStartSurfaceOpen, setIsStartSurfaceOpen] = useState(false);
  const [cwd, setCwd] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const [useWorktree, setUseWorktree] = useState(true);
  const [isListLoading, setIsListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [activeWorktreeStatus, setActiveWorktreeStatus] = useState<WorktreeStatus | null>(null);
  const [activeWorktreeStatusError, setActiveWorktreeStatusError] = useState<string | null>(null);
  const [isWorktreeStatusLoading, setIsWorktreeStatusLoading] = useState(false);
  const listRefreshIdRef = useRef(0);
  const worktreeStatusRefreshIdRef = useRef(0);
  const skipNextListRefresh = useRef(false);
  const isStartSurfaceOpenRef = useRef(false);
  const callbacksRef = useRef({
    setError,
    onTasksChanged,
    onSessionTasksChanged,
    onDeleteSessionEvents
  });
  callbacksRef.current = { setError, onTasksChanged, onSessionTasksChanged, onDeleteSessionEvents };
  isStartSurfaceOpenRef.current = isStartSurfaceOpen;

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  const recentProjects = useMemo<RecentProject[]>(() => {
    const byCwd = new Map<string, RecentProject>();
    [...sessions]
      .filter((session) => !session.deletedAt)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .forEach((session) => {
        const projectCwd = projectCwdForSession(session);
        const existing = byCwd.get(projectCwd);
        if (existing) {
          existing.sessionCount += 1;
          if (isLiveRuntime(session)) existing.runningCount += 1;
          return;
        }
        byCwd.set(projectCwd, {
          cwd: projectCwd,
          latestSession: session,
          sessionCount: 1,
          runningCount: isLiveRuntime(session) ? 1 : 0
        });
      });
    return [...byCwd.values()].slice(0, 6);
  }, [sessions]);

  const recentSessions = useMemo(() => [...sessions]
    .filter((session) => !session.deletedAt)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 6), [sessions]);

  const visibleSessions = useMemo(() => {
    const query = sessionSearch.trim().toLocaleLowerCase();
    if (!query) return sessions;
    return sessions.filter((session) => {
      const runtimeStatus = session.runtimeStatus ?? session.status;
      const searchable = [
        session.name,
        session.cwd,
        session.status,
        runtimeStatus,
        runtimeStatusLabels[runtimeStatus],
        session.permissionMode,
        session.worktree?.branch,
        session.worktree?.sourceCwd,
        session.worktree?.worktreeCwd
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [sessionSearch, sessions]);

  const isActiveSessionMode = listModeState === 'active' && !activeSession?.deletedAt;

  const refreshSessions = useCallback(async (mode: SessionListMode, options: { reset?: boolean } = {}) => {
    const refreshId = ++listRefreshIdRef.current;
    if (options.reset) {
      setIsListLoading(true);
      setSessions([]);
      setActiveId(null);
    }
    try {
      const loaded = await listSessions({ archivedOnly: mode === 'archived' });
      const loadedGroups = await listSessionGroups().catch(() => []);
      if (refreshId !== listRefreshIdRef.current) return;
      setListError(null);
      setSessions(loaded);
      setSessionGroups(loadedGroups);
      if (options.reset) {
        if (isStartSurfaceOpenRef.current) {
          setActiveId(null);
          setIsStartSurfaceOpen(mode === 'active');
        } else {
          setActiveId(loaded[0]?.id ?? null);
          setIsStartSurfaceOpen(loaded.length === 0 && mode === 'active');
        }
      } else {
        setActiveId((currentActiveId) => {
          if (isStartSurfaceOpenRef.current) return currentActiveId;
          if (!currentActiveId) return loaded[0]?.id ?? null;
          return loaded.some((session) => session.id === currentActiveId) ? currentActiveId : loaded[0]?.id ?? null;
        });
      }
      if (mode === 'active') callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      if (refreshId !== listRefreshIdRef.current) return;
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshId !== listRefreshIdRef.current) return;
      if (options.reset) setIsListLoading(false);
    }
  }, []);

  const setListMode = useCallback((mode: SessionListMode) => {
    skipNextListRefresh.current = false;
    setListError(null);
    setListModeState(mode);
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    isStartSurfaceOpenRef.current = false;
    setActiveId(sessionId);
    setIsStartSurfaceOpen(false);
  }, []);

  const openStartSurface = useCallback((defaultCwd?: string) => {
    isStartSurfaceOpenRef.current = true;
    setListError(null);
    setListModeState('active');
    setActiveId(null);
    setIsStartSurfaceOpen(true);
    setCwd((currentCwd) => defaultCwd ?? (currentCwd || defaultStartCwd(recentSessions, recentProjects)));
  }, [recentProjects, recentSessions]);

  const removeSessionFromCurrentList = useCallback((removedId: string) => {
    setSessions((current) => {
      const remaining = current.filter((session) => session.id !== removedId);
      setActiveId((currentActiveId) => {
        if (currentActiveId !== removedId && remaining.some((session) => session.id === currentActiveId)) {
          return currentActiveId;
        }
        return remaining[0]?.id ?? null;
      });
      return remaining;
    });
  }, []);

  const refreshActiveWorktreeStatus = useCallback(async () => {
    const session = activeSession;
    const refreshId = ++worktreeStatusRefreshIdRef.current;
    if (listModeState !== 'active' || !session?.worktree) {
      setActiveWorktreeStatus(null);
      setActiveWorktreeStatusError(null);
      setIsWorktreeStatusLoading(false);
      return;
    }

    setIsWorktreeStatusLoading(true);
    try {
      const status = await getWorktreeStatus(session.id);
      if (refreshId !== worktreeStatusRefreshIdRef.current) return;
      setActiveWorktreeStatus(status);
      setActiveWorktreeStatusError(null);
    } catch (err: unknown) {
      if (refreshId !== worktreeStatusRefreshIdRef.current) return;
      setActiveWorktreeStatus(null);
      setActiveWorktreeStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      if (refreshId === worktreeStatusRefreshIdRef.current) setIsWorktreeStatusLoading(false);
    }
  }, [activeSession, listModeState]);

  useEffect(() => {
    if (skipNextListRefresh.current) {
      skipNextListRefresh.current = false;
      return;
    }
    void refreshSessions(listModeState, { reset: true });
  }, [listModeState, refreshSessions]);

  useEffect(() => {
    void refreshActiveWorktreeStatus();
  }, [refreshActiveWorktreeStatus]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (listModeState === 'active') {
        void refreshSessions('active');
        void refreshActiveWorktreeStatus();
      }
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [listModeState, refreshActiveWorktreeStatus, refreshSessions]);

  function openCreatedSession(created: SessionInfo) {
    if (listModeState === 'archived') {
      skipNextListRefresh.current = true;
      setListModeState('active');
      setSessions([created]);
    } else {
      setSessions((current) => [created, ...current]);
    }
    isStartSurfaceOpenRef.current = false;
    setActiveId(created.id);
    setIsStartSurfaceOpen(false);
    setCwd('');
    setUseWorktree(true);
    callbacksRef.current.onTasksChanged?.();
    callbacksRef.current.onSessionTasksChanged?.(created.id);
  }

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      openCreatedSession(created);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onStartSession(initialPrompt: string) {
    const launchCwd = cwd.trim();
    const prompt = initialPrompt.trim();
    if (!launchCwd || !prompt) return;
    setError(null);
    try {
      const created = await createSession({
        cwd: launchCwd,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      openCreatedSession(created);
      try {
        const updated = await sendInput(created.id, initialPrompt);
        if (updated) {
          setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onStop(removeWorktree = false) {
    if (!activeId) return;
    const sessionId = activeId;
    setError(null);
    try {
      if (removeWorktree) {
        await stopAndRemoveWorktree(sessionId);
      } else {
        await stopSession(sessionId);
      }
      setSessions((current) => current.map((session) => {
        if (session.id !== sessionId) return session;
        if (removeWorktree && session.worktree) {
          setActiveWorktreeStatus(null);
          setActiveWorktreeStatusError(null);
          return { ...session, cwd: session.worktree.sourceCwd, status: 'stopped', runtimeStatus: 'stopped', worktree: null };
        }
        return { ...session, status: 'stopped', runtimeStatus: 'stopped' };
      }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
      if (!removeWorktree) void refreshActiveWorktreeStatus();
    }
  }

  async function onRename(sessionId: string, name: string | null) {
    setError(null);
    try {
      const updated = await updateSession(sessionId, { name });
      setSessions((current) => current.map((session) => session.id === sessionId ? updated : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onCreateGroup(name: string) {
    setError(null);
    try {
      const group = await createSessionGroup({ name });
      setSessionGroups((current) => [...current, group].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRenameGroup(groupId: string, name: string) {
    setError(null);
    try {
      const updated = await updateSessionGroup(groupId, { name });
      setSessionGroups((current) => current.map((group) => group.id === groupId ? updated : group));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDeleteGroup(groupId: string) {
    if (!confirm('Delete this group? Chats in the group will stay available as ungrouped chats.')) return;
    setError(null);
    try {
      await deleteSessionGroup(groupId);
      setSessionGroups((current) => current.filter((group) => group.id !== groupId));
      setSessions((current) => current.map((session) => session.groupId === groupId ? { ...session, groupId: null } : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onMoveSessionToGroup(sessionId: string, groupId: string | null) {
    setError(null);
    const previousSessions = sessions;
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, groupId } : session));
    try {
      const updated = await updateSession(sessionId, { groupId });
      setSessions((current) => current.map((session) => session.id === sessionId ? updated : session));
    } catch (err: unknown) {
      setSessions(previousSessions);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestart() {
    if (!activeId) return;
    const sessionId = activeId;
    setError(null);
    try {
      const restarted = await restartSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? restarted : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
    }
  }

  async function onResume() {
    if (!activeId) return;
    const sessionId = activeId;
    setError(null);
    try {
      const resumed = await resumeSession(sessionId);
      setSessions((current) => current.map((session) => session.id === sessionId ? resumed : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
    }
  }

  async function onArchive() {
    if (!activeId) return;
    const archivedId = activeId;
    if (!confirm('Archive this session? It will be hidden from active sessions while keeping local data.')) return;
    setError(null);
    try {
      await archiveSession(archivedId);
      removeSessionFromCurrentList(archivedId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onUnarchive() {
    if (!activeId) return;
    const unarchivedId = activeId;
    setError(null);
    try {
      await unarchiveSession(unarchivedId);
      removeSessionFromCurrentList(unarchivedId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete() {
    if (!activeId) return;
    const removedId = activeId;
    if (!confirm('Delete this archived session and its local event logs? This cannot be undone.')) return;
    setError(null);
    try {
      await deleteSession(removedId);
      removeSessionFromCurrentList(removedId);
      callbacksRef.current.onDeleteSessionEvents?.(removedId);
      callbacksRef.current.onTasksChanged?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return {
    sessions,
    sessionGroups,
    setSessions,
    activeId,
    activeSession,
    activeWorktreeStatus,
    activeWorktreeStatusError,
    cwd,
    isActiveSessionMode,
    isListLoading,
    isStartSurfaceOpen,
    isWorktreeStatusLoading,
    listError,
    listMode: listModeState,
    permissionMode,
    recentProjects,
    recentSessions,
    sessionSearch,
    useWorktree,
    visibleSessions,
    onArchive,
    onCreateSession,
    onStartSession,
    onCreateGroup,
    onDelete,
    onDeleteGroup,
    onMoveSessionToGroup,
    onRename,
    onRenameGroup,
    onRestart,
    onResume,
    onStop,
    onUnarchive,
    openStartSurface,
    refreshSessions,
    selectSession,
    setCwd,
    setListMode,
    setPermissionMode,
    setSessionSearch,
    setUseWorktree
  };
}
