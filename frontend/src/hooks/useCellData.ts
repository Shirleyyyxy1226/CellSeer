/**
 * Shared React Query hooks for the two project-wide payloads almost every
 * dashboard needs. Before these existed each panel ran its own
 * fetchRatePerformance/fetchCellRecordIndex in useEffect, so switching tabs
 * refetched ~600 KB of JSON per view; now all views share one cached result.
 *
 * Cache identity = (endpoint, projectId from URL, dataVersion). Bumping
 * dataVersion via DataRefreshContext (after uploads / metadata edits) moves
 * the key, which forces a refetch exactly like the old useEffect dependency.
 */
import { useQueries, useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  fetchCellRecord,
  fetchCellRecordIndex,
  fetchDifferential,
  fetchMasterPlotOverview,
  fetchMasterPlotPeakShift,
  fetchRatePerformance,
  type RateScope,
} from '@/lib/api';
import { getProjectIdFromPathname } from '@/lib/projectScope';
import { useDataRefresh } from '@/contexts/DataRefreshContext';

const STALE_MS = 15 * 60_000;

function useProjectScopeKey(): string {
  const { pathname } = useLocation();
  return getProjectIdFromPathname(pathname) ?? 'default';
}

/** Canonical scope key — '' when unconstrained, so unscoped callers all share
 * one cache entry (and match the full-project fetch). */
function rateScopeKey(scope?: RateScope): string {
  const norm = (v?: string) => (v && v !== 'All' ? v : '');
  const parts = [norm(scope?.cathode), norm(scope?.separator), norm(scope?.spacer)];
  return parts.every((p) => p === '') ? '' : parts.join('');
}

/**
 * Per-cycle rate-performance payload.
 * - `enabled` lets callers defer the fetch (tens of MB at scale) until a view
 *   that needs per-cycle data is actually shown.
 * - `scope` narrows it to one condition cohort (05 · FR-2) so cell-level views
 *   pull only what they draw. The scope is part of the cache key, so two callers
 *   on the same cohort (e.g. trajectories + parcoords) share one fetch, and an
 *   unscoped call still matches the full-project entry.
 */
export function useRatePerformanceQuery(options?: { enabled?: boolean; scope?: RateScope }) {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  const scope = options?.scope;
  return useQuery({
    queryKey: ['rate-performance', projectKey, dataVersion, rateScopeKey(scope)],
    queryFn: () => fetchRatePerformance(scope),
    staleTime: STALE_MS,
    enabled: options?.enabled ?? true,
  });
}

/**
 * Master Plot overview aggregate (05 · FR-1): per-condition stats + per-cell
 * scalars, with no per-cycle arrays. A fraction of the rate-performance payload,
 * used to drive the condition views (heatmap / ranking / treemap)
 * for large projects. Disabled by default — the orchestrator enables it only
 * above the cell-count threshold.
 */
export function useMasterPlotOverviewQuery(options?: { enabled?: boolean }) {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  return useQuery({
    queryKey: ['master-plot-overview', projectKey, dataVersion],
    queryFn: fetchMasterPlotOverview,
    staleTime: STALE_MS,
    enabled: options?.enabled ?? false,
  });
}

/**
 * dQ/dV peak-shift scalars (04 · FR-4). Disabled by default — the overview
 * enables it only when the peak-shift metric is selected, since the reduction
 * reads the (large) differential Parquet for every cell.
 */
export function useMasterPlotPeakShiftQuery(options?: { enabled?: boolean }) {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  return useQuery({
    queryKey: ['master-plot-peak-shift', projectKey, dataVersion],
    queryFn: fetchMasterPlotPeakShift,
    staleTime: STALE_MS,
    enabled: options?.enabled ?? false,
  });
}

export function useCellRecordIndexQuery() {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  return useQuery({
    queryKey: ['cell-record-index', projectKey, dataVersion],
    queryFn: fetchCellRecordIndex,
    staleTime: STALE_MS,
  });
}

/**
 * Per-cell cycling-curve records (downsampled for plotting). One cached query
 * per cell, so toggling selections or revisiting a tab never refetches a cell
 * already loaded this session.
 */
export function useCellRecordQueries(cellIds: string[]) {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  return useQueries({
    queries: cellIds.map((cellId) => ({
      queryKey: ['cell-record', projectKey, dataVersion, cellId],
      queryFn: () => fetchCellRecord(cellId),
      staleTime: STALE_MS,
      enabled: !!cellId,
    })),
  });
}

/** Per-cell dQ/dV + dV/dQ payloads, cached per (cell, direction). */
export function useDifferentialQueries(cellIds: string[], direction: 'discharge' | 'charge') {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  return useQueries({
    queries: cellIds.map((cellId) => ({
      queryKey: ['differential', projectKey, dataVersion, cellId, direction],
      queryFn: () => fetchDifferential(cellId, direction),
      staleTime: STALE_MS,
      enabled: !!cellId,
    })),
  });
}
