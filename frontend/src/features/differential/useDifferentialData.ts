import { useState, useEffect, useMemo } from 'react';
import { fetchCellRecordIndex, fetchDifferentialCells, fetchDifferential } from '@/lib/api';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { interpolateOntoGrid, cellColor } from '@/lib/differentialUtils';

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
  idNo: number;
  direction?: 'discharge' | 'charge';
  cycles: Record<string, { dqdv: { v: number[]; dqdv: number[] }; dvdq: { q: number[]; dvdq: number[] } }>;
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

export function useDifferentialData(
  cathodeFilter: string,
  spacerFilter: string,
  separatorFilter: string,
  direction: 'discharge' | 'charge' = 'discharge',
): {
  dqdvData: DqDvData | null;
  dvdqData: DvDqData | null;
  cells: Array<{ idNo: number; cellId: string; cellName: string; cathode: string; separatorType: string; spacerMm: number | null }>;
  loading: boolean;
  error: string | null;
  noDifferentialHint: string | null;
} {
  const { dataVersion } = useDataRefresh();
  const [cellIndex, setCellIndex] = useState<VQCellIndex[] | null>(null);
  const [readyIdNos, setReadyIdNos] = useState<Set<number>>(new Set());
  const [byCell, setByCell] = useState<Map<number, DifferentialApiResponse>>(new Map());
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
        const aReady = readyIdNos.has(a.idNo) ? 1 : 0;
        const bReady = readyIdNos.has(b.idNo) ? 1 : 0;
        if (aReady !== bReady) return bReady - aReady;
        return a.idNo - b.idNo;
      })
      .slice(0, MAX_CELLS_LOAD);
  }, [cellIndex, cathodeFilter, separatorFilter, spacerFilter, readyIdNos]);

  useEffect(() => {
    setLoadError(null);
    setLoading(true);
    fetchCellRecordIndex()
      .then((d) => {
        if (d.cells.length) {
          setCellIndex(d.cells as VQCellIndex[]);
          setByCell(new Map());
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
    fetchDifferentialCells(direction)
      .then((d) => {
        if (!cancelled) {
          setReadyIdNos(new Set((d.idNos ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n))));
        }
      })
      .catch(() => {
        if (!cancelled) setReadyIdNos(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion, direction]);

  useEffect(() => {
    if (!filteredCells.length) {
      setByCell(new Map());
      return;
    }
    const aborted = { current: false };
    setByCell(new Map());
    const fetchAll = async () => {
      const results = await Promise.all(
        filteredCells.map(async (cell) => {
          if (aborted.current) return null;
          try {
            const data = await fetchDifferential(cell.idNo, direction) as DifferentialApiResponse;
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
      const map = new Map<number, DifferentialApiResponse>();
      for (const entry of results) {
        if (entry) map.set(entry.idNo, entry.data);
      }
      setByCell(map);
    };
    fetchAll();
    return () => {
      aborted.current = true;
    };
  }, [filteredCells, direction]);

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
        if (d.dvdq.q) for (let i = 0; i < d.dvdq.q.length; i++) allQ.push(d.dvdq.q[i]);
      }
    }

    const vGrid = buildSharedGrid(allV, 2.5, 4.3, 0.002);
    const qGrid = buildSharedGrid(allQ, 0, 0.01, 0.0001);

    const dqdvCellData: DqDvData['cellData'] = [];
    const dvdqCellData: DvDqData['cellData'] = [];

    let idx = 0;
    for (const cell of filteredCells) {
      const resp = byCell.get(cell.idNo);
      if (!resp?.cycles) continue;

      const cellInfo: DifferentialCellInfo = {
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

      const dqdvTraces: DqDvCycleTrace[] = [];
      const dvdqTraces: DvDqCycleTrace[] = [];

      for (const cyc of cycleKeys) {
        const d = resp.cycles[String(cyc)];
        if (!d?.dqdv || !d?.dvdq) continue;
        if (d.dqdv.v.length < 2 || d.dqdv.dqdv.length < 2) continue;
        if (d.dvdq.q.length < 2 || d.dvdq.dvdq.length < 2) continue;

        dqdvTraces.push({
          cycle: cyc,
          dqdv: interpolateOntoGrid(d.dqdv.v, d.dqdv.dqdv, vGrid, 0),
        });
        dvdqTraces.push({
          cycle: cyc,
          dvdq: interpolateOntoGrid(d.dvdq.q, d.dvdq.dvdq, qGrid, 0.1),
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

  const noDifferentialHint =
    !loading && !loadError && cellIndex?.length && !dqdvData
      ? `No dQ/dV or dV/dQ found for the currently visible cells (${direction}). Upload cycling data for these cells (or regenerate dQ/dV + dV/dQ datasets) and ensure backend API is running.`
      : null;

  return {
    dqdvData: dqdvData ?? null,
    dvdqData: dvdqData ?? null,
    cells: filteredCells,
    loading,
    error: loadError,
    noDifferentialHint,
  };
}
