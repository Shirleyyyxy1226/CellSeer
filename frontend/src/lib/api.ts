import type { RatePerfCellRaw, IndexCellRaw } from '@/lib/cellTypes';
import type { CellAnnotation } from '@/contexts/CellSelectionContext';
import { withProjectQuery } from '@/lib/projectScope';

export type { RatePerfCellRaw, IndexCellRaw };

export interface UploadTaskStatus {
  id: string;
  filename: string;
  file_type: string | null;
  status: 'queued' | 'processing' | 'done' | 'error';
  message: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface LoaderManifestEntry {
  fileType: string;
  displayName: string;
  description: string;
  extensions: string[];
}

export interface MetadataUploadOptions {
  fileType: 'metadata';
  keyCandidates: string[];
  defaultPrimaryKey: string | null;
  requiresChoice: boolean;
  idNoCandidates: string[];
  defaultIdNoHeader: string | null;
  requiresIdNoChoice: boolean;
  sheetName: string | null;
  sheetNames: string[];
  headerColumns: string[];
  displayNameTemplate: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cellCount: number;
  cathodeTypes: string[];
}

export interface ProjectReadiness {
  projectId: string;
  projectName: string;
  hasMetadata: boolean;
  metadataColumnCount: number;
  cyclingFileCount: number;
  canEnterDashboard: boolean;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const finalUrl = url.startsWith('/api/') ? withProjectQuery(url) : url;
  const res = await fetch(finalUrl, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const fetchCellRecordIndex = (): Promise<{ cells: IndexCellRaw[] }> =>
  apiFetch('/api/cell-record-index');

export const fetchRatePerformance = (): Promise<{ cells: RatePerfCellRaw[]; protocols?: string[] }> =>
  apiFetch('/api/rate-performance');

export const fetchCellRecord = (idNo: number): Promise<unknown> =>
  apiFetch(`/api/cell-record/${idNo}`);

export const fetchDifferential = (
  idNo: number,
  direction: 'discharge' | 'charge' = 'discharge',
): Promise<unknown> =>
  apiFetch(`/api/cell-record/${idNo}/differential?direction=${encodeURIComponent(direction)}`);

export const fetchDifferentialCells = (
  direction: 'discharge' | 'charge' = 'discharge',
): Promise<{ idNos: number[] }> =>
  apiFetch(`/api/differential-cells?direction=${encodeURIComponent(direction)}`);

export const fetchCellAnnotations = (): Promise<{ annotations: Record<number, CellAnnotation> }> =>
  apiFetch('/api/cell-annotations');

export const fetchCellAnnotation = (idNo: number): Promise<CellAnnotation> =>
  apiFetch(`/api/cell-annotation/${idNo}`);

export const putCellAnnotation = (
  idNo: number,
  body: { note?: string; tags?: string[] },
): Promise<CellAnnotation> =>
  apiFetch(`/api/cell-annotation/${idNo}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const fetchUploadLoaders = (): Promise<{ loaders: LoaderManifestEntry[] }> =>
  apiFetch('/api/upload/loaders');

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
): Promise<{ taskId: string; filename: string; fileType: string; status: string }> {
  const form = new FormData();
  form.append('file', file);
  const scopedUploadUrl = withProjectQuery('/api/upload', options?.projectId);
  const scopedProjectId = new URLSearchParams(scopedUploadUrl.split('?')[1] ?? '').get('projectId');
  if (scopedProjectId) form.append('projectId', scopedProjectId);
  if (options?.fileType) form.append('fileType', options.fileType);
  if (options?.primaryKeyHeader) form.append('primaryKeyHeader', options.primaryKeyHeader);
  if (options?.idNoHeader) form.append('idNoHeader', options.idNoHeader);
  if (options?.displayNameTemplate) form.append('displayNameTemplate', options.displayNameTemplate);
  if (options?.metadataSheet) form.append('metadataSheet', options.metadataSheet);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
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
): Promise<{ taskId: string; filename: string; fileType: string; status: string; itemCount: number }> {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  const scopedUploadUrl = withProjectQuery('/api/upload/batch', options?.projectId);
  const scopedProjectId = new URLSearchParams(scopedUploadUrl.split('?')[1] ?? '').get('projectId');
  if (scopedProjectId) form.append('projectId', scopedProjectId);
  if (options?.fileType) form.append('fileType', options.fileType);
  if (options?.primaryKeyHeader) form.append('primaryKeyHeader', options.primaryKeyHeader);
  if (options?.idNoHeader) form.append('idNoHeader', options.idNoHeader);
  if (options?.displayNameTemplate) form.append('displayNameTemplate', options.displayNameTemplate);
  if (options?.metadataSheet) form.append('metadataSheet', options.metadataSheet);
  const res = await fetch('/api/upload/batch', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchMetadataUploadOptions(file: File): Promise<MetadataUploadOptions> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(withProjectQuery('/api/upload/metadata-options'), { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const fetchUploadStatus = (taskId: string): Promise<UploadTaskStatus> =>
  apiFetch(withProjectQuery(`/api/upload/status/${taskId}`));

export const fetchUploadHistory = (): Promise<{ tasks: UploadTaskStatus[] }> =>
  apiFetch(withProjectQuery('/api/upload/history'));

export const fetchProjects = (): Promise<{ projects: ProjectSummary[] }> =>
  apiFetch('/api/projects');

export const createProject = (name: string): Promise<ProjectSummary> =>
  apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

export const renameProject = (id: string, name: string): Promise<{ ok: boolean }> =>
  apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

export const deleteProject = (id: string): Promise<{ ok: boolean }> =>
  apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export async function fetchProjectReadiness(projectId: string): Promise<ProjectReadiness> {
  const res = await fetch(withProjectQuery(`/api/projects/${encodeURIComponent(projectId)}/readiness`), {
    cache: 'no-store',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}
