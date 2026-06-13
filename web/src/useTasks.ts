import { useCallback, useEffect, useRef, useState } from 'react';
import { listSessionTasks, listTasks } from './api';
import type { SessionListMode } from './AppShell';
import type { TaskGroups } from './types';

export const emptyTaskGroups: TaskGroups = { background: [], finished: [] };

type UseTasksOptions = {
  activeId: string | null;
  listMode: SessionListMode;
};

export function useTasks({ activeId, listMode }: UseTasksOptions) {
  const [tasks, setTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [sessionTasks, setSessionTasks] = useState<TaskGroups>(emptyTaskGroups);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [sessionTaskError, setSessionTaskError] = useState<string | null>(null);
  const taskRefreshIdRef = useRef(0);
  const sessionTaskRefreshIdRef = useRef(0);
  const activeIdRef = useRef<string | null>(null);

  const refreshTasks = useCallback(async () => {
    const refreshId = ++taskRefreshIdRef.current;
    try {
      setTaskError(null);
      const loadedTasks = await listTasks();
      if (refreshId !== taskRefreshIdRef.current) return;
      setTasks(loadedTasks);
    } catch (err: unknown) {
      if (refreshId !== taskRefreshIdRef.current) return;
      setTaskError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refreshSessionTasks = useCallback(async (sessionId: string) => {
    const refreshId = ++sessionTaskRefreshIdRef.current;
    try {
      setSessionTaskError(null);
      const loadedTasks = await listSessionTasks(sessionId);
      if (refreshId !== sessionTaskRefreshIdRef.current || activeIdRef.current !== sessionId) return;
      setSessionTasks(loadedTasks);
    } catch (err: unknown) {
      if (refreshId !== sessionTaskRefreshIdRef.current || activeIdRef.current !== sessionId) return;
      setSessionTasks(emptyTaskGroups);
      setSessionTaskError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    activeIdRef.current = activeId;
    setSessionTaskError(null);
    sessionTaskRefreshIdRef.current += 1;
    void refreshTasks();
    if (!activeId || listMode === 'archived') {
      setSessionTasks(emptyTaskGroups);
      return;
    }
    setSessionTasks(emptyTaskGroups);
    void refreshSessionTasks(activeId);
  }, [activeId, listMode, refreshTasks, refreshSessionTasks]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshTasks();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [refreshTasks]);

  return {
    tasks,
    sessionTasks,
    taskError,
    sessionTaskError,
    refreshTasks,
    refreshSessionTasks
  };
}
