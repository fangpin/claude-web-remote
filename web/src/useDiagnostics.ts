import { useCallback, useEffect, useState } from 'react';
import { getDiagnostics, getSessionDiagnostics } from './api';
import type { DiagnosticsResponse, SessionDiagnosticsResponse } from './types';

type UseDiagnosticsOptions = {
  activeSessionId: string | null;
  enabled: boolean;
};

export function useDiagnostics({ activeSessionId, enabled }: UseDiagnosticsOptions) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [sessionDiagnostics, setSessionDiagnostics] = useState<SessionDiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDiagnostics = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      const [globalDiagnostics, loadedSessionDiagnostics] = await Promise.all([
        getDiagnostics(),
        activeSessionId ? getSessionDiagnostics(activeSessionId) : Promise.resolve(null)
      ]);
      setDiagnostics(globalDiagnostics);
      setSessionDiagnostics(loadedSessionDiagnostics);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [activeSessionId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refreshDiagnostics();
  }, [enabled, refreshDiagnostics]);

  useEffect(() => {
    if (activeSessionId) return;
    setSessionDiagnostics(null);
  }, [activeSessionId]);

  return {
    diagnostics,
    error,
    isLoading,
    refreshDiagnostics,
    sessionDiagnostics
  };
}
