import { useState, useCallback, useRef, useEffect } from 'react';
import { uploadFile, uploadFiles, getUploadStatus } from '@/lib/api/uploadApi';

export type UploadStatus = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export function useFileUpload(onSuccess?: (fileType: string) => void) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollUntilDone = useCallback(
    async (taskId: string, fileType: string) => {
      setStatus('processing');
      const pollTask = async () => {
        try {
          const task = await getUploadStatus(taskId);
          setProgress(task.progress);
          setMessage(task.message);
          if (task.status === 'done') {
            stopPolling();
            setStatus('done');
            onSuccess?.(fileType);
          } else if (task.status === 'error') {
            stopPolling();
            setStatus('error');
          }
        } catch {
          // network blip — keep polling
        }
      };
      await pollTask();
      pollRef.current = setInterval(pollTask, 700);
    },
    [onSuccess, stopPolling],
  );

  const upload = useCallback(async (file: File) => {
    stopPolling();
    setStatus('uploading');
    setProgress(0);
    setMessage(null);
    try {
      const { taskId, fileType } = await uploadFile(file);
      await pollUntilDone(taskId, fileType);
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Upload failed');
    }
  }, [pollUntilDone, stopPolling]);
  
  const uploadWithOptions = useCallback(
    async (
      file: File,
      options?: {
        primaryKeyHeader?: string;
        idNoHeader?: string;
        displayNameTemplate?: string;
        metadataSheet?: string;
        projectId?: string;
        fileType?: 'metadata' | 'cycling';
      },
    ) => {
      stopPolling();
      setStatus('uploading');
      setProgress(0);
      setMessage(null);
      try {
        const { taskId, fileType } = await uploadFile(file, options);
        await pollUntilDone(taskId, fileType);
      } catch (e) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed');
      }
    },
    [pollUntilDone, stopPolling],
  );

  const uploadManyWithOptions = useCallback(
    async (
      files: File[],
      options?: {
        primaryKeyHeader?: string;
        idNoHeader?: string;
        displayNameTemplate?: string;
        metadataSheet?: string;
        projectId?: string;
        fileType?: 'metadata' | 'cycling';
      },
    ) => {
      stopPolling();
      setStatus('uploading');
      setProgress(0);
      setMessage(null);
      try {
        const { taskId, fileType } = await uploadFiles(files, options);
        await pollUntilDone(taskId, fileType);
      } catch (e) {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed');
      }
    },
    [pollUntilDone, stopPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus('idle');
    setProgress(0);
    setMessage(null);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  return { upload, uploadWithOptions, uploadManyWithOptions, status, progress, message, reset };
}
