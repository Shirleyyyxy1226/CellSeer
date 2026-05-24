import { useEffect, useMemo, useState } from 'react';
import { fetchCellRecord, fetchCellRecordIndex, fetchRatePerformance } from '@/lib/api';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';

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
}

/** Rate performance cell from rate-performance.json */
export interface RatePerfCell {
  idNo: number;
  cellId: string;
  cellName: string;
  cycles: number[];
  dischargeCapacityMah: number[];
  chargeCapacityMah?: number[];
  specificCapacityMahG: number[] | null;
  cRates?: number[];
  protocolSegments?: { cycleStart: number; cycleEnd: number; cRate: number }[];
}

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
  const { dataVersion } = useDataRefresh();
  const { treeFilterPath } = useTreeFilter();
  const { matchPathToIdNos } = useProjectHierarchy();

  const [cellIndex, setCellIndex] = useState<VQCellIndex[] | null>(null);
  const [selectedCellData, setSelectedCellData] = useState<VQCell | null>(null);
  const [cellRecordsByCell, setCellRecordsByCell] = useState<Record<number, VQCell>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cellDataLoading, setCellDataLoading] = useState(false);
  const [cellDataError, setCellDataError] = useState<string | null>(null);
  const [selectedCellId, setSelectedCellId] = useState<string>('');
  const [cycleFilter, setCycleFilter] = useState<string>('');
  const [ratePerfCells, setRatePerfCells] = useState<RatePerfCell[] | null>(null);

  useEffect(() => {
    setLoadError(null);
    setCellRecordsByCell({});
    fetchCellRecordIndex()
      .then((d) => {
        if (d.cells.length) {
          setCellIndex(d.cells as VQCellIndex[]);
          setLoadError(null);
          if (!selectedCellId && d.cells[0]) setSelectedCellId(d.cells[0].cellId);
        } else {
          setCellIndex([]);
          setLoadError('Cell list is empty for this project. Upload metadata and cycling data first.');
        }
      })
      .catch(() => {
        setCellIndex(null);
        setLoadError('Failed to load cell list.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  useEffect(() => {
    fetchRatePerformance()
      .then((d) => {
        if (d.cells.length) setRatePerfCells(d.cells as RatePerfCell[]);
        else setRatePerfCells(null);
      })
      .catch(() => setRatePerfCells(null));
  }, [dataVersion]);

  const filteredCells = useMemo(() => {
    if (!cellIndex) return [];
    return cellIndex
      .filter((c) => {
        if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
        if (spacerFilter !== 'All' && String(c.spacerMm ?? '') !== spacerFilter) return false;
        if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
        return true;
      })
      .sort((a, b) => a.idNo - b.idNo);
  }, [cellIndex, cathodeFilter, spacerFilter, separatorFilter]);

  const cellsForCharts = useMemo(() => {
    if (!filteredCells.length) return [];
    if (multiselectionMode && selectedCellIds.length > 0) {
      return filteredCells
        .filter((c) => selectedCellIds.includes(c.idNo))
        .sort((a, b) => a.idNo - b.idNo);
    }
    if (treeFilterPath.length > 0) {
      const matchedIdNos = matchPathToIdNos(treeFilterPath);
      if (matchedIdNos && matchedIdNos.size > 0) {
        return filteredCells
          .filter((c) => matchedIdNos.has(c.idNo))
          .sort((a, b) => a.idNo - b.idNo);
      }
      // Leaf clicks set treeFilterPath but may not resolve via path match; honour explicit cell selection.
      if (!multiselectionMode && selectedCellIds.length > 0) {
        return filteredCells
          .filter((c) => selectedCellIds.includes(c.idNo))
          .sort((a, b) => a.idNo - b.idNo);
      }
      return [];
    }
    return filteredCells.slice(0, 1);
  }, [filteredCells, multiselectionMode, selectedCellIds, treeFilterPath, matchPathToIdNos]);

  useEffect(() => {
    if (cellsForCharts.length === 0) {
      setSelectedCellData(null);
      setCellRecordsByCell({});
      return;
    }
    if (cellsForCharts.length === 1) {
      const cell = cellsForCharts[0];
      setCellRecordsByCell({});
      setCellDataLoading(true);
      setCellDataError(null);
      fetchCellRecord(cell.idNo)
        .then((d) => {
          const record = d as VQCell | null;
          setSelectedCellData(record ?? null);
          setCellDataError(record ? null : 'Failed to load cell data.');
        })
        .catch(() => {
          setSelectedCellData(null);
          setCellDataError('Failed to load cell data from database.');
        })
        .finally(() => setCellDataLoading(false));
      return;
    }
    setSelectedCellData(null);
    const idNos = cellsForCharts.map((c) => c.idNo);
    setCellRecordsByCell((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (!idNos.includes(Number(k))) delete next[Number(k)];
      }
      return next;
    });
    idNos.forEach((idNo) => {
      fetchCellRecord(idNo)
        .then((d) => {
          const record = d as VQCell | null;
          if (record?.curves) {
            setCellRecordsByCell((prev) => ({ ...prev, [idNo]: record }));
          }
        })
        .catch(() => {});
    });
  }, [cellsForCharts]);

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
    return cellsForCharts[0] ?? filteredCells.find((c) => c.cellId === selectedCellId) ?? filteredCells[0];
  }, [cellsForCharts, filteredCells, selectedCellId, cellRecordsByCell]);

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
