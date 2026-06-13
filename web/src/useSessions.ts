import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveSession,
  createSession,
  deleteSession,
  listSessions,
  restartSession,
  resumeSession,
  stopAndRemoveWorktree,
  stopSession,
  unarchiveSession
} from './api';
import { runtimeStatusLabels, type SessionListMode } from './AppShell';
import type { SessionInfo } from './types';

type UseSessionsOptions = {
  setError: (error: string | null) => void;
  onTasksChanged?: () => void;
  onSessionTasksChanged?: (sessionId: string) => void;
  onDeleteSessionEvents?: (sessionId: string) => void;
};

export function useSessions({
  setError,
  onTasksChanged,
  onSessionTasksChanged,
  onDeleteSessionEvents
}: UseSessionsOptions) {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listModeState, setListModeState] = useState<SessionListMode>('active');
  const [sessionSearch, setSessionSearch] = useState('');
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  const [cwd, setCwd] = useState('');
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const [useWorktree, setUseWorktree] = useState(false);
  const [isListLoading, setIsListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listRefreshIdRef = useRef(0);
  const skipNextListRefresh = useRef(false);
  const callbacksRef = useRef({
    setError,
    onTasksChanged,
    onSessionTasksChanged,
    onDeleteSessionEvents
  });
  callbacksRef.current = { setError, onTasksChanged, onSessionTasksChanged, onDeleteSessionEvents };

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  const recentDirectories = useMemo(() => {
    const seen = new Set<string>();
    return [...sessions]
      .filter((session) => !session.deletedAt)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .filter((session) => {
        if (seen.has(session.cwd)) return false;
        seen.add(session.cwd);
        return true;
      })
      .slice(0, 5)
      .map((session) => session.cwd);
  }, [sessions]);

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
      if (refreshId !== listRefreshIdRef.current) return;
      setListError(null);
      setSessions(loaded);
      if (options.reset) {
        setActiveId(loaded[0]?.id ?? null);
      } else {
        setActiveId((currentActiveId) => {
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
    setActiveId(sessionId);
  }, []);

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

  useEffect(() => {
    if (skipNextListRefresh.current) {
      skipNextListRefresh.current = false;
      return;
    }
    void refreshSessions(listModeState, { reset: true });
  }, [listModeState, refreshSessions]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (listModeState === 'active') {
        void refreshSessions('active');
      }
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [listModeState, refreshSessions]);

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        permissionMode,
        worktree: useWorktree ? { enabled: true } : undefined
      });
      if (listModeState === 'archived') {
        skipNextListRefresh.current = true;
        setListModeState('active');
        setSessions([created]);
      } else {
        setSessions((current) => [created, ...current]);
      }
      setActiveId(created.id);
      setCwd('');
      setUseWorktree(false);
      setIsNewSessionOpen(false);
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(created.id);
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
          return { ...session, cwd: session.worktree.sourceCwd, status: 'stopped', runtimeStatus: 'stopped', worktree: null };
        }
        return { ...session, status: 'stopped', runtimeStatus: 'stopped' };
      }));
    } catch (err: unknown) {
      if (removeWorktree) {
        setSessions((current) => current.map((session) => (
          session.id === sessionId ? { ...session, status: 'stopped', runtimeStatus: 'stopped' } : session
        )));
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      callbacksRef.current.onTasksChanged?.();
      callbacksRef.current.onSessionTasksChanged?.(sessionId);
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
    setSessions,
    activeId,
    activeSession,
    cwd,
    isActiveSessionMode,
    isListLoading,
    isNewSessionOpen,
    listError,
    listMode: listModeState,
    permissionMode,
    recentDirectories,
    sessionSearch,
    useWorktree,
    visibleSessions,
    onArchive,
    onCreateSession,
    onDelete,
    onRestart,
    onResume,
    onStop,
    onUnarchive,
    refreshSessions,
    selectSession,
    setCwd,
    setIsNewSessionOpen,
    setListMode,
    setPermissionMode,
    setSessionSearch,
    setUseWorktree,
    toggleNewSession: () => setIsNewSessionOpen((open) => !open)
  };
}
