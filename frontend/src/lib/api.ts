import type {
  RatePerfCell,
  IndexCell,
  CellDatasetSummary,
  ProtocolSegment,
  OpenEndedProtocolSegment,
} from '@/lib/cellTypes';
import type { CellAnnotation } from '@/contexts/CellSelectionContext';
import { currentProjectIdFromLocation, withProjectQuery } from '@/lib/projectScope';

export type {
  RatePerfCell,
  IndexCell,
  CellDatasetSummary,
  ProtocolSegment,
  OpenEndedProtocolSegment,
};

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
    // Attach the HTTP status so callers (e.g. React Query retry predicates) can
    // skip retrying a definitive 404 instead of hammering the endpoint 3×.
    const e = new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`) as Error & {
      status?: number;
    };
    e.status = res.status;
    throw e;
  }
  return res.json();
}

export const fetchCellRecordIndex = (): Promise<{ cells: IndexCell[] }> =>
  apiFetch('/api/cell-record-index');

/**
 * Condition scope for the rate-performance fetch. Narrows the
 * payload to one cohort (the active dropdown filters) so cell-level views pull
 * only what they draw. `'All'` / empty values are treated as "no constraint".
 */
export interface RateScope {
  cathode?: string;
  separator?: string;
  spacer?: string;
}

export const fetchRatePerformance = (
  scope?: RateScope,
): Promise<{ cells: RatePerfCell[]; protocols?: string[] }> => {
  const params = new URLSearchParams();
  if (scope?.cathode && scope.cathode !== 'All') params.set('cathode', scope.cathode);
  if (scope?.separator && scope.separator !== 'All') params.set('separator', scope.separator);
  if (scope?.spacer && scope.spacer !== 'All') params.set('spacer', scope.spacer);
  const qs = params.toString();
  return apiFetch(`/api/rate-performance${qs ? `?${qs}` : ''}`);
};

/**
 * Master Plot overview aggregate: a per-condition category map and a per-cell
 * scalar table for the condition views. The per-cell scalars are the source of
 * truth; the frontend derives condition statistics from them.
 * See backend/master_plot_overview.py.
 */
export interface OverviewCondition {
  key: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  n: number;
}

export interface OverviewCell {
  cellId: string;
  condKey: string;
  idNo: number;
  cellName: string;
  hasProtocol: boolean;
  protocolName: string | null;
  peakCapacitySpec: number | null;
  peakCapacityRaw: number | null;
  medianCE: number | null;
  retention: number | null;
  cycleCount: number;
  capacityBasis: 'mAh/g' | 'mAh';
}

export interface MasterPlotOverview {
  projectId: string | null;
  cellCount: number;
  conditionCount: number;
  /** Number of cells with a resolved protocol — gates protocol-locked metrics. */
  protocolCellCount: number;
  conditions: Record<string, OverviewCondition>;
  cells: OverviewCell[];
}

export const fetchMasterPlotOverview = (): Promise<MasterPlotOverview> =>
  apiFetch('/api/master-plot/overview');

/**
 * Per-cell dQ/dV peak-shift scalars — ΔV (mV) of the dominant redox
 * peak between early and late cycling. Lazy: fetched only when that metric is
 * selected. `peakShiftMv` is null where the peak couldn't be reliably tracked.
 */
export interface PeakShiftResponse {
  cellCount: number;
  valueCount: number;
  cells: { cellId: string; peakShiftMv: number | null }[];
}

export const fetchMasterPlotPeakShift = (): Promise<PeakShiftResponse> =>
  apiFetch('/api/master-plot/peak-shift');

/**
 * Per-cell cycling curves. Dashboards request stride-downsampled traces
 * (default 500 points/cycle — visually identical, ~20× smaller than the
 * ~9 MB full payload); pass `maxPointsPerCycle: null` for full resolution
 * (e.g. for data export).
 */
export const fetchCellRecord = (
  cellId: string,
  opts?: { maxPointsPerCycle?: number | null },
): Promise<unknown> => {
  const maxPts = opts?.maxPointsPerCycle === undefined ? 500 : opts.maxPointsPerCycle;
  const qs = maxPts != null ? `?maxPointsPerCycle=${maxPts}` : '';
  return apiFetch(`/api/cell-record/${encodeURIComponent(cellId)}${qs}`);
};

export const fetchDifferential = (
  cellId: string,
  direction: 'discharge' | 'charge' = 'discharge',
): Promise<unknown> =>
  apiFetch(
    `/api/cell-record/${encodeURIComponent(cellId)}/differential?direction=${encodeURIComponent(direction)}`,
  );

export const fetchDifferentialCells = (
  direction: 'discharge' | 'charge' = 'discharge',
): Promise<{ cellIds: string[] }> =>
  apiFetch(`/api/differential-cells?direction=${encodeURIComponent(direction)}`);

export const fetchCellAnnotations = (): Promise<{ annotations: Record<string, CellAnnotation> }> =>
  apiFetch('/api/cell-annotations');

export const fetchCellAnnotation = (cellId: string): Promise<CellAnnotation> =>
  apiFetch(`/api/cell-annotation/${encodeURIComponent(cellId)}`);

export const putCellAnnotation = (
  cellId: string,
  body: { note?: string; tags?: string[] },
): Promise<CellAnnotation> =>
  apiFetch(`/api/cell-annotation/${encodeURIComponent(cellId)}`, {
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
  const effectivePid = options?.projectId ?? currentProjectIdFromLocation();
  if (effectivePid) form.append('projectId', effectivePid);
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
  const effectivePid = options?.projectId ?? currentProjectIdFromLocation();
  if (effectivePid) form.append('projectId', effectivePid);
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

export type CellTestType = 'cycling';

export interface CellMetadataPatch {
  batch?: number | null;
  category?: string | null;
  repeat?: number | null;
  cathode?: string | null;
  cathodeDiameterMm?: number | null;
  cathodeMassG?: number | null;
  anode?: string | null;
  anodeDiameterMm?: number | null;
  anodeMassG?: number | null;
  npRatio?: number | null;
  separatorType?: string | null;
  separatorDiameterMm?: number | null;
  electrolyte?: string | null;
  electrolyteVolumeUl?: number | null;
  spacerMm?: number | null;
  doFormation?: string | null;
  doRateTest?: string | null;
  doEis?: string | null;
  notes?: string | null;
}

export async function updateCellMetadata(
  cellId: string,
  patch: CellMetadataPatch,
): Promise<{ cell: IndexCell | null; updated: string[] }> {
  if (!cellId) throw new Error('cellId is required');
  const url = withProjectQuery(`/api/cells/${encodeURIComponent(cellId)}`);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function uploadCellTestFile(
  cellId: string,
  testType: CellTestType,
  file: File,
  options?: { projectId?: string },
): Promise<{
  taskId: string;
  filename: string;
  fileType: string;
  cellId: string;
  testType: string;
  status: string;
}> {
  if (!cellId) {
    throw new Error('cellId is required');
  }
  const form = new FormData();
  form.append('file', file);
  const url = withProjectQuery(
    `/api/cells/${encodeURIComponent(cellId)}/files/${encodeURIComponent(testType)}`,
    options?.projectId,
  );
  const scopedProjectId = new URLSearchParams(url.split('?')[1] ?? '').get('projectId');
  if (scopedProjectId) form.append('projectId', scopedProjectId);
  const res = await fetch(url, { method: 'POST', body: form });
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

// ---------------------------------------------------------------------------
// Protocol templates + per-cell protocol attach
// ---------------------------------------------------------------------------

export interface ProtocolTemplate {
  id: string;
  projectId: string;
  name: string;
  description: string;
  segments: OpenEndedProtocolSegment[];
  isBuiltin: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export const fetchProtocolTemplates = (): Promise<{ templates: ProtocolTemplate[] }> =>
  apiFetch('/api/protocol-templates');

export interface ProtocolTemplateCreate {
  name: string;
  description?: string | null;
  segments: OpenEndedProtocolSegment[];
}

export const createProtocolTemplate = (
  body: ProtocolTemplateCreate,
): Promise<{ template: ProtocolTemplate }> =>
  apiFetch('/api/protocol-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteProtocolTemplate = (templateId: string): Promise<{ deleted: string }> =>
  apiFetch(`/api/protocol-templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  });

export interface SetCellProtocolBody {
  protocolName?: string | null;
  segments: OpenEndedProtocolSegment[];
}

export const setCellProtocol = (
  cellId: string,
  body: SetCellProtocolBody,
): Promise<{ cell: IndexCell | null; protocolName: string }> =>
  apiFetch(`/api/cells/${encodeURIComponent(cellId)}/protocol`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export interface BulkSetCellProtocolBody {
  cellIds: string[];
  protocolName?: string | null;
  segments: OpenEndedProtocolSegment[];
}

export const setCellProtocolBulk = (
  body: BulkSetCellProtocolBody,
): Promise<{
  applied: string[];
  missing: string[];
  protocolName: string;
  segments: OpenEndedProtocolSegment[];
}> =>
  apiFetch('/api/cells/protocol/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
