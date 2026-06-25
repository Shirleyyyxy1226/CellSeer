/**
 * Per-cell test-file upload lifecycle.
 *
 * Each consumer (ProjectDetailPage row drawer + CellDetailPanel sidebar)
 * mounts its own instance because the global `useFileUpload` hook is
 * single-slot and would clobber concurrent uploads. The hook does the
 * POST then polls /api/upload/status until the backend reports done/error,
 * so callers just await `attach(file)` and watch `status` / `progress`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchUploadStatus,
  uploadCellTestFile,
  type CellTestType,
} from '@/lib/api';

export type AttachStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export interface UseCellTestFileAttachResult {
  status: AttachStatus;
  progress: number;
  message: string | null;
  attach: (file: File) => Promise<void>;
}

/**
 * @param cellId    Cell to attach the file to.
 * @param testType  Logical test type (currently always `'cycling'`).
 * @param onComplete  Fired once on successful ingest. Use to bump
 *                    `triggerDataRefresh()` so consumers refetch.
 */
export function useCellTestFileAttach(
  cellId: string,
  testType: CellTestType,
  onComplete?: () => void,
): UseCellTestFileAttachResult {
  const [status, setStatus] = useState<AttachStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const attach = useCallback(
    async (file: File) => {
      stopPolling();
      setStatus('uploading');
      setProgress(0);
      setMessage(null);
      try {
        const { taskId } = await uploadCellTestFile(cellId, testType, file);
        setStatus('processing');
        const tick = async () => {
          try {
            const task = await fetchUploadStatus(taskId);
            setProgress(task.progress);
            setMessage(task.message);
            if (task.status === 'done') {
              stopPolling();
              setStatus('done');
              onComplete?.();
            } else if (task.status === 'error') {
              stopPolling();
              setStatus('error');
            }
          } catch {
            /* transient network blip — keep polling */
          }
        };
        await tick();
        pollRef.current = window.setInterval(tick, 700);
      } catch (e) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed');
      }
    },
    [cellId, testType, onComplete, stopPolling],
  );

  return { status, progress, message, attach };
}
