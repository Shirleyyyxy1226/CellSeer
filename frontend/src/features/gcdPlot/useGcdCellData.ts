import { useEffect, useMemo, useState } from 'react';
import {
  useCellRecordIndexQuery,
  useCellRecordQueries,
  useRatePerformanceQuery,
} from '@/hooks/useCellData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { isCellSelectionPath } from '@/lib/treeUtils';
import type { RatePerfCell } from '@/lib/cell/cellTypes';

/** Full record per cycle - PyProBE columns (Voltage [V], Capacity [Ah], Current [A], etc.) */
export interface RecordCurve {
  [key: string]: (number | string | null)[];
}

/** Cell metadata (from index); curves loaded on demand from /cell-record/{idNo}.json */
export interface VQCellIndex {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  cathodeMassG?: number | null;
  /** Working-electrode active mass (g) for specific capacity — cathode or anode
   *  depending on capacity basis. Normalisation should use this, not cathodeMassG. */
  activeMassG?: number | null;
  /** Attached test files from the index; a cell needs a 'cycling' one to plot GCD. */
  datasets?: { name?: string }[];
}

/** Rate performance cell from rate-performance.json. Canonical shape lives in
 *  cellTypes (includes cathode/separatorType/spacerMm needed by the colour and
 *  rate-performance plot code); re-exported so GCD shares one definition rather
 *  than a stale duplicate that drops the hierarchy fields. */
export type { RatePerfCell };

export interface VQCell extends VQCellIndex {
  curves: Record<string, RecordCurve>;
}

interface UseGcdCellDataOpts {
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
}

interface UseGcdCellDataReturn {
  cellIndex: VQCellIndex[] | null;
  /** True while the initial cell-index fetch is in flight (or being refetched). */
  cellIndexLoading: boolean;
  /** Cell list after cathode/spacer/separator + multiselect + tree filtering. */
  filteredCells: VQCellIndex[];
  /** Subset actually rendered (multi-select / tree-filter / default-first-cell rules). */
  cellsForCharts: VQCellIndex[];
  /** Loaded cell records keyed by idNo (multi-cell mode). */
  cellRecordsByCell: Record<number, VQCell>;
  /** The "currently active" cell — used for titles, single-cell charts, etc. */
  selectedCell: VQCellIndex | undefined;
  selectedCellId: string;
  setSelectedCellId: (id: string) => void;
  /** Single-cell record, if loaded; null in multi-cell mode. */
  selectedCellData: VQCell | null;
  /** Records ready for `buildGcdFigure` (`selectedCellData` in 1-cell mode, all loaded in N-cell mode). */
  cellsDataList: VQCell[];
  /** Cycle-filter input value (user-editable). */
  cycleFilter: string;
  setCycleFilter: (s: string) => void;
  /** Rate-performance rows; null if endpoint returned empty. */
  ratePerfCells: RatePerfCell[] | null;
  /** Rate-performance row matching the currently selected cell, if any. */
  selectedCellRatePerf: RatePerfCell | null;
  loadError: string | null;
  cellDataLoading: boolean;
  cellDataError: string | null;
}

/**
 * Encapsulates every GCD-dashboard data concern: the cell index fetch,
 * the rate-performance fetch, the cathode/spacer/separator filter, the
 * multi-select & tree-filter interactions, single-cell vs N-cell record
 * loading, and the "which cell is currently selected" disambiguation.
 *
 * The dashboard component only needs to read the returned slices and pass
 * them to `buildGcdFigure` / `buildRatePerformanceFigure` / etc.
 */
export function useGcdCellData({
  cathodeFilter,
  spacerFilter,
  separatorFilter,
}: UseGcdCellDataOpts): UseGcdCellDataReturn {
  const { multiselectionMode, selectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const { matchPathToIdNos } = useProjectHierarchy();

  const [selectedCellId, setSelectedCellId] = useState<string>('');
  const [cycleFilter, setCycleFilter] = useState<string>('');

  const indexQuery = useCellRecordIndexQuery();
  const rateQuery = useRatePerformanceQuery();

  const cellIndex = useMemo<VQCellIndex[] | null>(() => {
    if (!indexQuery.data) return null;
    return indexQuery.data.cells as VQCellIndex[];
  }, [indexQuery.data]);
  const cellIndexLoading = indexQuery.isLoading;
  const loadError = indexQuery.isError
    ? 'Failed to load cell list.'
    : indexQuery.data && indexQuery.data.cells.length === 0
      ? 'Cell list is empty for this project. Upload metadata and cycling data first.'
      : null;
  const ratePerfCells = useMemo<RatePerfCell[] | null>(() => {
    const cells = rateQuery.data?.cells;
    return cells?.length ? (cells as RatePerfCell[]) : null;
  }, [rateQuery.data]);

  // Default the selection to the first cell once the index arrives.
  useEffect(() => {
    if (cellIndex?.length) {
      setSelectedCellId((prev) => prev || cellIndex[0].cellId);
    }
  }, [cellIndex]);

  const filteredCells = useMemo(() => {
    if (!cellIndex) return [];
    return cellIndex
      .filter((c) => {
        if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
        if (spacerFilter !== 'All' && String(c.spacerMm ?? '') !== spacerFilter) return false;
        if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
        // GCD needs cycling curves. If the index lists this cell's datasets and
        // none is 'cycling', requesting its cell-record would 404 — exclude it.
        // (Keep cells whose datasets are absent, to avoid over-filtering.)
        if (Array.isArray(c.datasets) && !c.datasets.some((d) => d?.name === 'cycling')) return false;
        return true;
      })
      .sort((a, b) => a.idNo - b.idNo);
  }, [cellIndex, cathodeFilter, spacerFilter, separatorFilter]);

  const cellsForCharts = useMemo(() => {
    if (!filteredCells.length) return [];
    // GCD plots per-cell curves, so it responds ONLY to individual-cell
    // selection — never to a group/branch click. Multi mode overlays every
    // checked cell; an explicit selection (e.g. drill-down from the Master Plot
    // inspector) is honoured in either mode; in Single mode only a leaf (cell)
    // click plots. A group/branch selection or no selection yields no cells, so
    // the dashboard shows a "select a cell" prompt instead.
    const bySelectedIds = () =>
      filteredCells.filter((c) => selectedCellIds.includes(c.idNo)).sort((a, b) => a.idNo - b.idNo);
    if (multiselectionMode) {
      return selectedCellIds.length > 0 ? bySelectedIds() : [];
    }
    if (selectedCellIds.length > 0) {
      const selected = bySelectedIds();
      if (selected.length > 0) return selected;
    }
    if (isCellSelectionPath(treeFilterPath)) {
      const matchedIdNos = matchPathToIdNos(treeFilterPath);
      if (matchedIdNos && matchedIdNos.size > 0) {
        return filteredCells
          .filter((c) => matchedIdNos.has(c.idNo))
          .sort((a, b) => a.idNo - b.idNo);
      }
    }
    return [];
  }, [filteredCells, multiselectionMode, selectedCellIds, treeFilterPath, matchPathToIdNos]);

  // One cached query per charted cell — selection toggles and tab revisits
  // reuse already-loaded records instead of refetching.
  const recordQueries = useCellRecordQueries(cellsForCharts.map((c) => c.cellId));

  const cellRecordsByCell = useMemo(() => {
    const out: Record<number, VQCell> = {};
    cellsForCharts.forEach((cell, i) => {
      const record = recordQueries[i]?.data as VQCell | undefined;
      if (record?.curves) out[cell.idNo] = record;
    });
    return out;
  }, [cellsForCharts, recordQueries]);

  const singleMode = cellsForCharts.length === 1;
  const firstQuery = recordQueries[0];
  const selectedCellData = useMemo<VQCell | null>(() => {
    if (!singleMode) return null;
    const record = firstQuery?.data as VQCell | undefined;
    return record?.curves ? record : null;
  }, [singleMode, firstQuery?.data]);
  const cellDataLoading = singleMode ? !!firstQuery?.isLoading : false;
  const cellDataError = !singleMode
    ? null
    : cellsForCharts[0] && !cellsForCharts[0].cellId
      ? 'Cell is missing a cell_id; cannot fetch curves.'
      : firstQuery?.isError
        ? 'Failed to load cell data from database.'
        : null;

  const selectedCell = useMemo(() => {
    if (cellsForCharts.length === 1) return cellsForCharts[0];
    if (cellsForCharts.length > 1 && selectedCellId) {
      const c = cellsForCharts.find(
        (x) => x.cellId === selectedCellId && !!cellRecordsByCell[x.idNo]?.curves,
      );
      if (c) return c;
    }
    if (cellsForCharts.length > 1) {
      const firstWithCurves = cellsForCharts.find((x) => !!cellRecordsByCell[x.idNo]?.curves);
      if (firstWithCurves) return firstWithCurves;
    }
    // No fallback to filteredCells[0]: when nothing (or only a group) is
    // selected, there is no selected cell, so the dashboard shows its
    // "select a cell" prompt rather than auto-plotting an arbitrary cell.
    return cellsForCharts[0] ?? null;
  }, [cellsForCharts, selectedCellId, cellRecordsByCell]);

  const cellsDataList = useMemo((): VQCell[] => {
    if (cellsForCharts.length <= 1 && selectedCellData?.curves) return [selectedCellData];
    return cellsForCharts
      .map((c) => cellRecordsByCell[c.idNo])
      .filter((d): d is VQCell => !!d?.curves);
  }, [cellsForCharts, selectedCellData, cellRecordsByCell]);

  useEffect(() => {
    if (cellsForCharts.length === 1 && cellsForCharts[0]) {
      setSelectedCellId(cellsForCharts[0].cellId);
    } else if (cellsForCharts.length > 1) {
      const selectedHasCurves = cellsForCharts.some(
        (c) => c.cellId === selectedCellId && !!cellRecordsByCell[c.idNo]?.curves,
      );
      if (!selectedHasCurves) {
        const firstWithCurves = cellsForCharts.find((c) => !!cellRecordsByCell[c.idNo]?.curves);
        if (firstWithCurves) setSelectedCellId(firstWithCurves.cellId);
      }
    } else if (filteredCells.length > 0 && !selectedCellId) {
      setSelectedCellId(filteredCells[0].cellId);
    }
  }, [cellsForCharts, filteredCells, selectedCellId, cellRecordsByCell]);

  const selectedCellRatePerf = useMemo(() => {
    if (!ratePerfCells?.length || !selectedCell) return null;
    return (
      ratePerfCells.find(
        (c) => c.cellId === selectedCell.cellId || c.idNo === selectedCell.idNo,
      ) ?? null
    );
  }, [ratePerfCells, selectedCell]);

  return {
    cellIndex,
    cellIndexLoading,
    filteredCells,
    cellsForCharts,
    cellRecordsByCell,
    selectedCell,
    selectedCellId,
    setSelectedCellId,
    selectedCellData,
    cellsDataList,
    cycleFilter,
    setCycleFilter,
    ratePerfCells,
    selectedCellRatePerf,
    loadError,
    cellDataLoading,
    cellDataError,
  };
}
