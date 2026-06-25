import { useState, useEffect, useMemo } from 'react';
import { fetchDifferentialCells } from '@/lib/api';
import { useCellRecordIndexQuery, useDifferentialQueries } from '@/hooks/useCellData';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { interpolateOntoGrid } from '@/lib/differentialUtils';
import { cellIdentityColor } from '@/lib/cellColorScheme';

export interface DifferentialCellInfo {
  id: string;
  name: string;
  cathode: string;
  spacer: string;
  separator: string;
  color: string;
}

export interface DqDvCycleTrace {
  cycle: number;
  dqdv: number[];
}

export interface DvDqCycleTrace {
  cycle: number;
  dvdq: number[];
}

export interface DqDvData {
  voltages: number[];
  cycles: number[];
  cellData: { cell: DifferentialCellInfo; cycleTraces: DqDvCycleTrace[] }[];
}

export interface DvDqData {
  capacities: number[];
  cycles: number[];
  cellData: { cell: DifferentialCellInfo; cycleTraces: DvDqCycleTrace[] }[];
}

interface VQCellIndex {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
}

interface DifferentialApiResponse {
  cellId: string;
  direction?: 'discharge' | 'charge';
  cycles: Record<string, { dqdv: { v: number[]; dqdv: number[] }; dvdq: { q: number[]; dvdq: number[] } }>;
}

// Explicit selection may pull up to this many cells for side-by-side comparison.
const MAX_CELLS_LOAD = 6;

function matchesSpacer(spacerFilter: string, spacerMm: number | null): boolean {
  if (spacerFilter === 'All') return true;
  if (spacerMm == null) return spacerFilter === '';
  const s = String(spacerMm);
  return s === spacerFilter || spacerFilter === s;
}

function buildSharedGrid(values: number[], defaultMin: number, defaultMax: number, defaultStep: number): number[] {
  if (values.length === 0) {
    const out: number[] = [];
    for (let x = defaultMin; x <= defaultMax; x += defaultStep) out.push(x);
    return out;
  }
  let min = values[0];
  let max = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = Math.max(max - min, defaultStep);
  // Use ~150 points for smooth curves; avoids rectangular artifact from coarse grid
  const nPts = 150;
  const s = range / nPts;
  const out: number[] = [];
  for (let x = min; x <= max; x += s) out.push(parseFloat(x.toFixed(6)));
  return out.length >= 2 ? out : [min, max];
}

export function useDifferentialData(
  cathodeFilter: string,
  spacerFilter: string,
  separatorFilter: string,
  direction: 'discharge' | 'charge' = 'discharge',
  selectedIdNos: number[] = [],
): {
  dqdvData: DqDvData | null;
  dvdqData: DvDqData | null;
  cells: Array<{ idNo: number; cellId: string; cellName: string; cathode: string; separatorType: string; spacerMm: number | null }>;
  loading: boolean;
  error: string | null;
  noDifferentialHint: string | null;
  noFilterMatch: boolean;
} {
  const { dataVersion } = useDataRefresh();
  const [readyCellIds, setReadyCellIds] = useState<Set<string>>(new Set());

  const indexQuery = useCellRecordIndexQuery();
  const cellIndex = useMemo<VQCellIndex[] | null>(() => {
    const cells = indexQuery.data?.cells;
    if (!cells?.length) return null;
    return (cells as VQCellIndex[]).filter((c) => !!c.cellId);
  }, [indexQuery.data]);
  const loading = indexQuery.isLoading;
  const loadError = indexQuery.isError ? 'Failed to load cell index.' : null;

  // Stable key for selection so useMemo / useEffect don't refire on new-but-equal arrays.
  const selectionKey = useMemo(
    () => [...selectedIdNos].sort((a, b) => a - b).join(','),
    [selectedIdNos],
  );

  const filteredCells = useMemo(() => {
    if (!cellIndex?.length) return [];
    const matchesFilters = (c: VQCellIndex) => {
      if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
      if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
      if (!matchesSpacer(spacerFilter, c.spacerMm)) return false;
      return true;
    };
    const sortFn = (a: VQCellIndex, b: VQCellIndex) => {
      const aReady = readyCellIds.has(a.cellId) ? 1 : 0;
      const bReady = readyCellIds.has(b.cellId) ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady;
      // Display sort: id_no is still a useful display number.
      const ai = Number.isFinite(a.idNo) ? a.idNo : Number.MAX_SAFE_INTEGER;
      const bi = Number.isFinite(b.idNo) ? b.idNo : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a.cellId.localeCompare(b.cellId);
    };

    // When the user has selected cells anywhere else in the app, the dV/dQ view
    // honours that selection and loads those cells (up to MAX_CELLS_LOAD) regardless
    // of the default landing window. This lets users pull up arbitrary cells
    // that fall outside the default top-N window, and lets power
    // users compare up to MAX_CELLS_LOAD cells deliberately.
    // Plot ONLY the explicitly selected cells. With no cell selection (e.g. a
    // group/branch node is active, or nothing is selected) there are no cells to
    // load, so the dashboard shows a "select a cell" prompt instead of plotting
    // an arbitrary default set.
    if (selectedIdNos.length === 0) return [];
    const selSet = new Set(selectedIdNos);
    return cellIndex
      .filter((c) => selSet.has(c.idNo) && matchesFilters(c))
      .sort(sortFn)
      .slice(0, MAX_CELLS_LOAD);
    // selectionKey participates so identity-only array changes don't cause refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellIndex, cathodeFilter, separatorFilter, spacerFilter, readyCellIds, selectionKey]);

  useEffect(() => {
    let cancelled = false;
    fetchDifferentialCells(direction)
      .then((d) => {
        if (!cancelled) {
          setReadyCellIds(new Set((d.cellIds ?? []).filter((s): s is string => typeof s === 'string' && s.length > 0)));
        }
      })
      .catch(() => {
        if (!cancelled) setReadyCellIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, direction]);

  // One cached query per (cell, direction). Filter changes that re-order or
  // shrink the cell list reuse loaded payloads instead of refetching everything
  // (the old effect refired on every `filteredCells` identity change, fetching
  // each cell at least twice on mount).
  const diffQueries = useDifferentialQueries(
    filteredCells.map((c) => c.cellId),
    direction,
  );

  const byCell = useMemo(() => {
    const map = new Map<string, DifferentialApiResponse>();
    filteredCells.forEach((cell, i) => {
      const data = diffQueries[i]?.data as DifferentialApiResponse | undefined;
      if (data?.cycles && Object.keys(data.cycles).length > 0) {
        map.set(cell.cellId, data);
      }
    });
    return map;
  }, [filteredCells, diffQueries]);

  const cellFetchLoading = diffQueries.some((q) => q.isLoading);

  const { dqdvData, dvdqData } = useMemo(() => {
    if (!cellIndex || byCell.size === 0) return { dqdvData: null, dvdqData: null };

    const allV: number[] = [];
    const allQ: number[] = [];
    const allCycles = new Set<number>();

    for (const [, resp] of byCell) {
      for (const cycStr of Object.keys(resp.cycles)) {
        const d = resp.cycles[cycStr];
        if (!d?.dqdv || !d?.dvdq) continue;
        const cyc = parseInt(cycStr, 10);
        if (isNaN(cyc)) continue;
        allCycles.add(cyc);
        if (d.dqdv.v) for (let i = 0; i < d.dqdv.v.length; i++) allV.push(d.dqdv.v[i]);
        // Coin-cell capacities are mAh-scale; the API stores Ah. Convert once
        // here so every axis, peak table and export reads in publication units.
        if (d.dvdq.q) for (let i = 0; i < d.dvdq.q.length; i++) allQ.push(d.dvdq.q[i] * 1000);
      }
    }

    const vGrid = buildSharedGrid(allV, 2.5, 4.3, 0.002);
    const qGrid = buildSharedGrid(allQ, 0, 10, 0.1);

    const dqdvCellData: DqDvData['cellData'] = [];
    const dvdqCellData: DvDqData['cellData'] = [];

    for (const cell of filteredCells) {
      const resp = byCell.get(cell.cellId);
      if (!resp?.cycles) continue;

      const cellInfo: DifferentialCellInfo = {
        id: cell.cellId,
        name: cell.cellName,
        cathode: cell.cathode,
        spacer: String(cell.spacerMm ?? ''),
        separator: cell.separatorType,
        color: cellIdentityColor(cell),
      };

      const cycleKeys = Object.keys(resp.cycles)
        .map((k) => parseInt(k, 10))
        .filter((x) => !isNaN(x))
        .sort((a, b) => a - b);

      const dqdvTraces: DqDvCycleTrace[] = [];
      const dvdqTraces: DvDqCycleTrace[] = [];

      for (const cyc of cycleKeys) {
        const d = resp.cycles[String(cyc)];
        if (!d?.dqdv || !d?.dvdq) continue;
        if (d.dqdv.v.length < 2 || d.dqdv.dqdv.length < 2) continue;
        if (d.dvdq.q.length < 2 || d.dvdq.dvdq.length < 2) continue;

        dqdvTraces.push({
          cycle: cyc,
          // Ah/V → mAh/V to match the mAh capacity axis.
          dqdv: interpolateOntoGrid(d.dqdv.v, d.dqdv.dqdv.map((y) => y * 1000), vGrid, 0),
        });
        dvdqTraces.push({
          cycle: cyc,
          // Q: Ah → mAh; dV/dQ: V/Ah → V/mAh (out-of-range placeholder scaled too).
          dvdq: interpolateOntoGrid(
            d.dvdq.q.map((x) => x * 1000),
            d.dvdq.dvdq.map((y) => y / 1000),
            qGrid,
            0.0001,
          ),
        });
      }

      if (dqdvTraces.length > 0) dqdvCellData.push({ cell: cellInfo, cycleTraces: dqdvTraces });
      if (dvdqTraces.length > 0) dvdqCellData.push({ cell: cellInfo, cycleTraces: dvdqTraces });
    }

    const cycles = Array.from(allCycles).sort((a, b) => a - b);
    return {
      dqdvData:
        dqdvCellData.length > 0 ? { voltages: vGrid, cycles, cellData: dqdvCellData } : null,
      dvdqData:
        dvdqCellData.length > 0 ? { capacities: qGrid, cycles, cellData: dvdqCellData } : null,
    };
  }, [cellIndex, filteredCells, byCell]);

  // Distinguish why data is absent so the UI can show a targeted message.
  const noFilterMatch =
    !loading && !cellFetchLoading && !loadError && filteredCells.length === 0 && (cellIndex?.length ?? 0) > 0;
  const noDifferentialHint =
    !loading && !cellFetchLoading && !loadError && cellIndex?.length && !dqdvData && !noFilterMatch
      ? 'no_data'
      : noFilterMatch
      ? 'no_filter_match'
      : null;

  return {
    dqdvData: dqdvData ?? null,
    dvdqData: dvdqData ?? null,
    cells: filteredCells,
    loading: loading || cellFetchLoading,
    error: loadError,
    noDifferentialHint,
    noFilterMatch,
  };
}
