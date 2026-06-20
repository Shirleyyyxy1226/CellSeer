import { withProjectQuery } from '@/lib/projectScope';

export interface DigibatRunSummary {
  id: string;
  mode: string;
  status: 'running' | 'done' | 'error' | 'queued' | 'idle';
  totalsJson?: string | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface DigibatStatusResponse {
  projectId: string;
  status: 'running' | 'done' | 'error' | 'queued' | 'idle';
  datasetCount: number;
  lastRun: DigibatRunSummary | null;
}

export interface DigibatCollection {
  id: string;
  name: string;
  description?: string | null;
}

export interface DigibatCollectionCell {
  refcode: string;
  name: string;
}

export interface DigibatCollectionsResponse {
  projectId: string;
  configured?: boolean;
  detail?: string;
  collections: DigibatCollection[];
}

export interface DigibatCollectionCellsResponse {
  projectId: string;
  collectionId: string;
  configured?: boolean;
  detail?: string;
  cells: DigibatCollectionCell[];
}

export interface DigibatSyncConflict {
  runId: string;
  collectionIds: string[];
}

export class DigibatSyncConflictError extends Error {
  readonly conflicts: DigibatSyncConflict[];
  constructor(message: string, conflicts: DigibatSyncConflict[]) {
    super(message);
    this.name = 'DigibatSyncConflictError';
    this.conflicts = conflicts;
  }
}

function extractDetailMessage(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    const msg = (detail as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return fallback;
}

async function digibatFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    const detail = (body as { detail?: unknown }).detail;
    if (res.status === 409 && detail && typeof detail === 'object') {
      const rawConflicts = (detail as { conflicts?: unknown }).conflicts;
      const conflicts: DigibatSyncConflict[] = Array.isArray(rawConflicts)
        ? rawConflicts
            .filter((c): c is { runId?: unknown; collectionIds?: unknown } => !!c && typeof c === 'object')
            .map((c) => ({
              runId: typeof c.runId === 'string' ? c.runId : '',
              collectionIds: Array.isArray(c.collectionIds)
                ? c.collectionIds.filter((id): id is string => typeof id === 'string')
                : [],
            }))
        : [];
      throw new DigibatSyncConflictError(
        extractDetailMessage(detail, 'A sync is already running for one or more of the requested collections.'),
        conflicts,
      );
    }
    throw new Error(extractDetailMessage(detail, `HTTP ${res.status}`));
  }
  return res.json();
}

export function connectDigibatAccount(input: {
  projectId: string;
  apiKey?: string;
  useDefault?: boolean;
  baseUrl?: string;
}): Promise<{ ok: boolean; projectId: string }> {
  return digibatFetch('/api/digibat/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function createManualDigibatProject(input: {
  projectName: string;
  cells?: Array<{ cellName: string; idNo?: number | null }>;
}): Promise<{ ok: boolean; projectId: string }> {
  return digibatFetch('/api/digibat/manual-project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function startDigibatSync(input: {
  projectId: string;
  collectionIds: string[];
  selectedRefcodes?: string[];
  includeCycling?: boolean;
  maxItems?: number;
  dryRun?: boolean;
  fullResync?: boolean;
  verbose?: boolean;
}): Promise<{ ok: boolean; projectId: string; status: string; requestId: string }> {
  const projectPath = `/api/projects/${encodeURIComponent(input.projectId)}/digibat/sync`;
  const scopedPath = withProjectQuery(projectPath, input.projectId);
  return digibatFetch(scopedPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      collectionIds: input.collectionIds,
      selectedRefcodes: input.selectedRefcodes ?? [],
      includeCycling: input.includeCycling ?? true,
      maxItems: input.maxItems ?? null,
      dryRun: Boolean(input.dryRun),
      fullResync: Boolean(input.fullResync),
      verbose: Boolean(input.verbose),
    }),
  });
}

export function fetchDigibatCollections(projectId: string): Promise<DigibatCollectionsResponse> {
  return digibatFetch(`/api/digibat/collections?projectId=${encodeURIComponent(projectId)}`);
}

export function fetchDigibatCollectionCells(
  projectId: string,
  collectionId: string,
): Promise<DigibatCollectionCellsResponse> {
  return digibatFetch(
    `/api/digibat/collections/${encodeURIComponent(collectionId)}/cells?projectId=${encodeURIComponent(projectId)}`,
  );
}

export function fetchDigibatStatus(projectId: string): Promise<DigibatStatusResponse> {
  const projectPath = `/api/projects/${encodeURIComponent(projectId)}/digibat/status`;
  return digibatFetch(withProjectQuery(projectPath, projectId));
}

export function fetchDigibatRuns(
  projectId: string,
): Promise<{ projectId: string; runs: DigibatRunSummary[] }> {
  const projectPath = `/api/projects/${encodeURIComponent(projectId)}/digibat/runs`;
  return digibatFetch(withProjectQuery(projectPath, projectId));
}
