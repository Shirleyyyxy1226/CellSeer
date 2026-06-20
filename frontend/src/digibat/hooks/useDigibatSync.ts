import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DigibatSyncConflictError,
  fetchDigibatStatus,
  startDigibatSync,
  type DigibatStatusResponse,
} from '@/digibat/api/digibatApi';
import { useDataRefresh } from '@/contexts/DataRefreshContext';

function formatConflictMessage(error: DigibatSyncConflictError): string {
  const ids = Array.from(
    new Set(error.conflicts.flatMap((c) => c.collectionIds).filter(Boolean)),
  );
  if (ids.length === 0) return error.message;
  const list = ids.slice(0, 4).join(', ');
  const more = ids.length > 4 ? ` (+${ids.length - 4} more)` : '';
  return `A sync is already running for: ${list}${more}. Wait for it to finish, or restart the backend if it appears stuck.`;
}

export function useDigibatSync(projectId: string | null) {
  const { triggerDataRefresh } = useDataRefresh();
  const [status, setStatus] = useState<DigibatStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!projectId) return;
    const next = await fetchDigibatStatus(projectId);
    setStatus(next);
    if (next.status === 'done') {
      stopPolling();
      triggerDataRefresh();
    }
  }, [projectId, stopPolling, triggerDataRefresh]);

  const beginPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      refreshStatus().catch(() => {}).finally(() => { inFlightRef.current = false; });
    }, 1500);
  }, [refreshStatus, stopPolling]);

  const triggerSync = useCallback(
    async (input: {
      projectId?: string;
      collectionIds: string[];
      selectedRefcodes?: string[];
      includeCycling?: boolean;
      maxItems?: number;
      dryRun?: boolean;
      fullResync?: boolean;
      verbose?: boolean;
    }): Promise<boolean> => {
      const targetProjectId = input.projectId ?? projectId;
      if (!targetProjectId) return Promise.resolve(false);
      if (!input.collectionIds.length) {
        setError('At least one collection ID is required.');
        return Promise.resolve(false);
      }
      setIsLoading(true);
      setError(null);
      try {
        await startDigibatSync({
          projectId: targetProjectId,
          ...input,
        });
        await refreshStatus();
        beginPolling();
        return true;
      } catch (e) {
        if (e instanceof DigibatSyncConflictError) {
          setError(formatConflictMessage(e));
        } else {
          setError(e instanceof Error ? e.message : 'Failed to start DIGIBAT sync.');
        }
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [beginPolling, projectId, refreshStatus],
  );

  useEffect(() => {
    if (!projectId) return;
    setIsLoading(true);
    refreshStatus()
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load DIGIBAT status.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [projectId, refreshStatus]);

  useEffect(() => {
    if (status?.status === 'running') {
      beginPolling();
    } else {
      stopPolling();
    }
  }, [beginPolling, status?.status, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return {
    status,
    isLoading,
    error,
    triggerSync,
    refreshStatus,
  };
}
