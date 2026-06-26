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
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import {
  fetchCellRecord,
  fetchCellRecordIndex,
  fetchDifferential,
  fetchMasterPlotOverview,
  fetchMasterPlotPeakShift,
  fetchRatePerformance,
  type RateScope,
  type DiffSmoothing,
} from '@/lib/api';
import { getProjectIdFromPathname } from '@/lib/projectScope';
import { useDataRefresh } from '@/contexts/DataRefreshContext';

const STALE_MS = 15 * 60_000;

/** Fields consumers actually read off a per-cell query result. */
export interface CellQueryResult {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}

/**
 * `combine` for the `useQueries` hooks below. `useQueries` returns a BRAND-NEW
 * array (and fresh result objects) on every render even when the cached data is
 * unchanged. Consuming that array directly drove an infinite render loop: the
 * new array identity made downstream `useMemo`s recompute, which made child
 * plots emit fresh legend arrays through their `onLegendItems` effect, which
 * setState'd the parent, which re-rendered, which produced a new array again…
 * ("Maximum update depth exceeded").
 *
 * Projecting to just the fields consumers use lets TanStack apply structural
 * sharing to this output, so the returned array keeps a STABLE identity while
 * the underlying data/loading/error state is unchanged. Module-level (stable
 * reference) so the combine itself never forces a re-run.
 */
function combineCellQueries(results: UseQueryResult[]): CellQueryResult[] {
  return results.map((r) => ({ data: r.data, isLoading: r.isLoading, isError: r.isError }));
}

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
 * - `scope` narrows it to one condition cohort so cell-level views
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
 * Master Plot overview aggregate: per-condition stats + per-cell
 * scalars, with no per-cycle arrays. A fraction of the rate-performance payload,
 * used to drive the condition views (heatmap / ranking; the treemap view is in
 * development and not currently mounted) for large projects. Disabled by
 * default — the orchestrator enables it only above the cell-count threshold.
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
 * dQ/dV peak-shift scalars. Disabled by default — the overview
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
      // A 404 means this cell has no cycling record — definitive, don't retry.
      retry: (count: number, err: unknown) =>
        (err as { status?: number }).status !== 404 && count < 2,
    })),
    combine: combineCellQueries,
  });
}

/** Per-cell dQ/dV + dV/dQ payloads, cached per (cell, direction). */
export function useDifferentialQueries(
  cellIds: string[],
  direction: 'discharge' | 'charge',
  smoothing?: DiffSmoothing,
) {
  const { dataVersion } = useDataRefresh();
  const projectKey = useProjectScopeKey();
  const sKey = smoothing ? `${smoothing.method}:${smoothing.targetBins}:${smoothing.kernel}` : 'default';
  return useQueries({
    queries: cellIds.map((cellId) => ({
      queryKey: ['differential', projectKey, dataVersion, cellId, direction, sKey],
      queryFn: () => fetchDifferential(cellId, direction, smoothing),
      staleTime: STALE_MS,
      enabled: !!cellId,
      retry: (count: number, err: unknown) =>
        (err as { status?: number }).status !== 404 && count < 2,
    })),
    combine: combineCellQueries,
  });
}
