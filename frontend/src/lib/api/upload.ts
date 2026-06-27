// Re-exports from the central api.ts — use @/lib/api for new code.
export type { LoaderManifestEntry as LoaderInfo, UploadTaskStatus as UploadTask } from '@/lib/api';
import {
  fetchUploadLoaders,
  uploadFile as _uploadFile,
  uploadFiles as _uploadFiles,
  fetchUploadStatus,
  fetchUploadHistory,
  fetchMetadataUploadOptions as _fetchMetadataUploadOptions,
} from '@/lib/api';

export async function fetchLoaders() {
  return (await fetchUploadLoaders()).loaders;
}

export async function uploadFile(
  file: File,
  options?: {
    primaryKeyHeader?: string;
    idNoHeader?: string;
    displayNameTemplate?: string;
    metadataSheet?: string;
    projectId?: string;
    fileType?: 'metadata' | 'cycling';
  },
) {
  const d = await _uploadFile(file, options);
  return { taskId: d.taskId, fileType: d.fileType };
}

export async function uploadFiles(
  files: File[],
  options?: {
    primaryKeyHeader?: string;
    idNoHeader?: string;
    displayNameTemplate?: string;
    metadataSheet?: string;
    projectId?: string;
    fileType?: 'metadata' | 'cycling';
  },
) {
  const d = await _uploadFiles(files, options);
  return { taskId: d.taskId, fileType: d.fileType, itemCount: d.itemCount };
}

export async function fetchMetadataUploadOptions(file: File) {
  return _fetchMetadataUploadOptions(file);
}

export async function getUploadStatus(taskId: string) {
  return fetchUploadStatus(taskId);
}

export async function getUploadHistory() {
  return (await fetchUploadHistory()).tasks;
}
