import { useState, useEffect, useMemo } from 'react';
import { fetchCellRecordIndex, fetchIcaCells, fetchIcaDvq } from '@/lib/api';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { interpolateOntoGrid, cellColor } from '@/lib/icaDvqUtils';

export interface IcaDvqCellInfo {
  id: string;
  name: string;
  cathode: string;
  spacer: string;
  separator: string;
  color: string;
}

export interface IcaCycleTrace {
  cycle: number;
  dqdv: number[];
}

export interface DvqCycleTrace {
  cycle: number;
  dvdq: number[];
}

export interface IcaData {
  voltages: number[];
  cycles: number[];
  cellData: { cell: IcaDvqCellInfo; cycleTraces: IcaCycleTrace[] }[];
}

export interface DvqData {
  capacities: number[];
  cycles: number[];
  cellData: { cell: IcaDvqCellInfo; cycleTraces: DvqCycleTrace[] }[];
}

interface VQCellIndex {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
}

interface IcaDvqApiResponse {
  idNo: number;
  direction?: 'discharge' | 'charge';
  cycles: Record<string, { ica: { v: number[]; dqdv: number[] }; dvq: { q: number[]; dvdq: number[] } }>;
}

const MAX_CELLS_LOAD = 24;
const MAX_CYCLES_PER_CELL = 60;

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

export function useIcaDvqData(
  cathodeFilter: string,
  spacerFilter: string,
  separatorFilter: string,
  direction: 'discharge' | 'charge' = 'discharge',
): {
  icaData: IcaData | null;
  dvqData: DvqData | null;
  cells: Array<{ idNo: number; cellId: string; cellName: string; cathode: string; separatorType: string; spacerMm: number | null }>;
  loading: boolean;
  error: string | null;
  noIcaDvqHint: string | null;
} {
  const { dataVersion } = useDataRefresh();
  const [cellIndex, setCellIndex] = useState<VQCellIndex[] | null>(null);
  const [icaReadyIdNos, setIcaReadyIdNos] = useState<Set<number>>(new Set());
  const [icaDvqByCell, setIcaDvqByCell] = useState<Map<number, IcaDvqApiResponse>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const filteredCells = useMemo(() => {
    if (!cellIndex?.length) return [];
    return cellIndex
      .filter((c) => {
        if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
        if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
        if (!matchesSpacer(spacerFilter, c.spacerMm)) return false;
        return true;
      })
      .sort((a, b) => {
        const aReady = icaReadyIdNos.has(a.idNo) ? 1 : 0;
        const bReady = icaReadyIdNos.has(b.idNo) ? 1 : 0;
        if (aReady !== bReady) return bReady - aReady;
        return a.idNo - b.idNo;
      })
      .slice(0, MAX_CELLS_LOAD);
  }, [cellIndex, cathodeFilter, separatorFilter, spacerFilter, icaReadyIdNos]);

  useEffect(() => {
    setLoadError(null);
    setLoading(true);
    fetchCellRecordIndex()
      .then((d) => {
        if (d.cells.length) {
          setCellIndex(d.cells as VQCellIndex[]);
          setIcaDvqByCell(new Map());
          setLoadError(null);
        } else {
          setCellIndex(null);
          setLoadError(null);
        }
        setLoading(false);
      })
      .catch(() => {
        setCellIndex(null);
        setLoadError('Failed to load cell index.');
        setLoading(false);
      });
  }, [dataVersion]);

  useEffect(() => {
    let cancelled = false;
    fetchIcaCells(direction)
      .then((d) => {
        if (!cancelled) {
          setIcaReadyIdNos(new Set((d.idNos ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n))));
        }
      })
      .catch(() => {
        if (!cancelled) setIcaReadyIdNos(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, direction]);

  useEffect(() => {
    if (!filteredCells.length) {
      setIcaDvqByCell(new Map());
      return;
    }
    const aborted = { current: false };
    setIcaDvqByCell(new Map());
    const fetchAll = async () => {
      const results = await Promise.all(
        filteredCells.map(async (cell) => {
          if (aborted.current) return null;
          try {
            const data = await fetchIcaDvq(cell.idNo, direction) as IcaDvqApiResponse;
            if (data?.cycles && Object.keys(data.cycles).length > 0) {
              return { idNo: cell.idNo, data } as const;
            }
          } catch {
            // skip failed cells
          }
          return null;
        })
      );
      if (aborted.current) return;
      const map = new Map<number, IcaDvqApiResponse>();
      for (const entry of results) {
        if (entry) map.set(entry.idNo, entry.data);
      }
      setIcaDvqByCell(map);
    };
    fetchAll();
    return () => {
      aborted.current = true;
    };
  }, [filteredCells, direction]);

  const { icaData, dvqData } = useMemo(() => {
    if (!cellIndex || icaDvqByCell.size === 0) return { icaData: null, dvqData: null };

    const allV: number[] = [];
    const allQ: number[] = [];
    const allCycles = new Set<number>();

    for (const [, resp] of icaDvqByCell) {
      for (const cycStr of Object.keys(resp.cycles)) {
        const d = resp.cycles[cycStr];
        if (!d?.ica || !d?.dvq) continue;
        const cyc = parseInt(cycStr, 10);
        if (isNaN(cyc)) continue;
        allCycles.add(cyc);
        if (d.ica.v) for (let i = 0; i < d.ica.v.length; i++) allV.push(d.ica.v[i]);
        if (d.dvq.q) for (let i = 0; i < d.dvq.q.length; i++) allQ.push(d.dvq.q[i]);
      }
    }

    const vGrid = buildSharedGrid(allV, 2.5, 4.3, 0.002);
    const qGrid = buildSharedGrid(allQ, 0, 0.01, 0.0001);

    const icaCellData: IcaData['cellData'] = [];
    const dvqCellData: DvqData['cellData'] = [];

    let idx = 0;
    for (const cell of filteredCells) {
      const resp = icaDvqByCell.get(cell.idNo);
      if (!resp?.cycles) continue;

      const cellInfo: IcaDvqCellInfo = {
        id: cell.cellId,
        name: cell.cellName,
        cathode: cell.cathode,
        spacer: String(cell.spacerMm ?? ''),
        separator: cell.separatorType,
        color: cellColor(cell.cellId, idx),
      };
      idx += 1;

      const cycleKeys = Object.keys(resp.cycles)
        .map((k) => parseInt(k, 10))
        .filter((x) => !isNaN(x))
        .sort((a, b) => a - b)
        .slice(0, MAX_CYCLES_PER_CELL);

      const icaTraces: IcaCycleTrace[] = [];
      const dvqTraces: DvqCycleTrace[] = [];

      for (const cyc of cycleKeys) {
        const d = resp.cycles[String(cyc)];
        if (!d?.ica || !d?.dvq) continue;
        if (d.ica.v.length < 2 || d.ica.dqdv.length < 2) continue;
        if (d.dvq.q.length < 2 || d.dvq.dvdq.length < 2) continue;

        icaTraces.push({
          cycle: cyc,
          dqdv: interpolateOntoGrid(d.ica.v, d.ica.dqdv, vGrid, 0),
        });
        dvqTraces.push({
          cycle: cyc,
          dvdq: interpolateOntoGrid(d.dvq.q, d.dvq.dvdq, qGrid, 0.1),
        });
      }

      if (icaTraces.length > 0) icaCellData.push({ cell: cellInfo, cycleTraces: icaTraces });
      if (dvqTraces.length > 0) dvqCellData.push({ cell: cellInfo, cycleTraces: dvqTraces });
    }

    const cycles = Array.from(allCycles).sort((a, b) => a - b);
    return {
      icaData:
        icaCellData.length > 0 ? { voltages: vGrid, cycles, cellData: icaCellData } : null,
      dvqData:
        dvqCellData.length > 0 ? { capacities: qGrid, cycles, cellData: dvqCellData } : null,
    };
  }, [cellIndex, filteredCells, icaDvqByCell]);

  const noIcaDvqHint =
    !loading && !loadError && cellIndex?.length && !icaData
      ? `No ICA/DVQ found for the currently visible cells (${direction}). Upload cycling data for these cells (or regenerate dQ/dV + dV/dQ datasets) and ensure backend API is running.`
      : null;

  return {
    icaData: icaData ?? null,
    dvqData: dvqData ?? null,
    cells: filteredCells,
    loading,
    error: loadError,
    noIcaDvqHint,
  };
}
