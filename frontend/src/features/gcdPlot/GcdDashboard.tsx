import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { fetchCellRecordIndex, fetchRatePerformance, fetchCellRecord } from '@/lib/api';
import { turboColor } from '@/lib/turboColormap';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { ResponsiveChartContainer } from '@/components/ResponsiveChartContainer';

/** Full record per cycle - PyProBE columns (Voltage [V], Capacity [Ah], Current [A], etc.) */
interface RecordCurve {
  [key: string]: (number | string | null)[];
}

/** Cell metadata (from index); curves loaded on demand from /cell-record/{idNo}.json */
interface VQCellIndex {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  cathodeMassG?: number | null;
}

/** Rate performance cell from rate-performance.json */
interface RatePerfCell {
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

interface VQCell extends VQCellIndex {
  curves: Record<string, RecordCurve>; // cycle -> full PyProBE record columns
}

interface VoltageCapacityPanelProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter?: (v: string) => void;
  onSeparatorFilter?: (v: string) => void;
}

const MAX_CYCLES = 60;
const MAX_PTS_TRACE = 2500;

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New'];
const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20];

const GcdDashboard = ({
  cathodeFilter,
  spacerFilter,
  separatorFilter,
}: VoltageCapacityPanelProps) => {
  const { setSelectedCellIds, multiselectionMode, selectedCellIds } = useCellSelection();
  const { dataVersion } = useDataRefresh();
  const [cellIndex, setCellIndex] = useState<VQCellIndex[] | null>(null);
  const [fullCells, setFullCells] = useState<VQCell[] | null>(null);
  const [selectedCellData, setSelectedCellData] = useState<VQCell | null>(null);
  const [cellRecordsByCell, setCellRecordsByCell] = useState<Record<number, VQCell>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cellDataLoading, setCellDataLoading] = useState(false);
  const [cellDataError, setCellDataError] = useState<string | null>(null);
  const { treeFilterPath } = useTreeFilter();
  const { apiData: hierarchyData, matchPathToIdNos } = useProjectHierarchy();

  const useIndexMode = cellIndex != null && fullCells == null;

  const [selectedCellId, setSelectedCellId] = useState<string>('');
  const [cycleFilter, setCycleFilter] = useState<string>('');

  // Chart appearance
  const [chartTitle, setChartTitle] = useState('GCD plot');
  const [xAxisLabel, setXAxisLabel] = useState('Capacity (mAh)');
  const [yAxisLabel, setYAxisLabel] = useState('Voltage (V)');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [titleFontSize, setTitleFontSize] = useState(14);
  const [labelFontSize, setLabelFontSize] = useState(12);
  const [legendFontSize, setLegendFontSize] = useState(11);
  const [showLegend, setShowLegend] = useState(true);
  const [legendPosition, setLegendPosition] = useState<'in' | 'right-bottom'>('right-bottom');
  const [showConnectedLine, setShowConnectedLine] = useState(false);
  const [gcdDirection, setGcdDirection] = useState<'discharge' | 'charge'>('discharge');

  const [combinedHighlightCycle, setCombinedHighlightCycle] = useState<number | null>(null);
  const [ratePerfCells, setRatePerfCells] = useState<RatePerfCell[] | null>(null);
  const [combinedChartSize, setCombinedChartSize] = useState<{ width: number; height: number } | null>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [ratePerfChartSize, setRatePerfChartSize] = useState<{ width: number; height: number } | null>(null);
  const [initialVoltageChartSize, setInitialVoltageChartSize] = useState<{ width: number; height: number } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    setSize: (s: { width: number; height: number }) => void;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, setSize: (s: { width: number; height: number }) => void, currentSize: { width: number; height: number }) => {
      e.preventDefault();
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: currentSize.width,
        startH: currentSize.height,
        setSize,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;
      r.setSize({
        width: Math.max(280, Math.min(1400, r.startW + dx)),
        height: Math.max(200, Math.min(900, r.startH + dy)),
      });
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    setLoadError(null);
    setCellRecordsByCell({});
    fetchCellRecordIndex()
      .then((d) => {
        if (d.cells.length) {
          setCellIndex(d.cells as VQCellIndex[]);
          setFullCells(null);
          setLoadError(null);
          if (!selectedCellId && d.cells[0]) setSelectedCellId(d.cells[0].cellId);
        } else {
          setCellIndex([]);
          setLoadError('Cell list is empty for this project. Upload metadata and cycling data first.');
        }
      })
      .catch(() => {
        setCellIndex(null);
        setFullCells(null);
        setLoadError('Failed to load cell list.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  useEffect(() => {
    fetchRatePerformance()
      .then((d) => {
        if (d.cells.length) {
          setRatePerfCells(d.cells as RatePerfCell[]);
        } else {
          setRatePerfCells(null);
        }
      })
      .catch(() => setRatePerfCells(null));
  }, []);

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
      return filteredCells.filter((c) => selectedCellIds.includes(c.idNo)).sort((a, b) => a.idNo - b.idNo);
    }
    if (treeFilterPath.length > 0) {
      const matchedIdNos = matchPathToIdNos(treeFilterPath);
      if (!matchedIdNos || matchedIdNos.size === 0) return [];
      return filteredCells.filter((c) => matchedIdNos.has(c.idNo)).sort((a, b) => a.idNo - b.idNo);
    }
    // Default when opening: show only the first cell
    return filteredCells.slice(0, 1);
  }, [filteredCells, multiselectionMode, selectedCellIds, treeFilterPath, matchPathToIdNos]);

  useEffect(() => {
    if (!useIndexMode) {
      if (fullCells && selectedCellId) {
        const c = fullCells.find((x) => x.cellId === selectedCellId);
        setSelectedCellData(c ?? null);
      }
      return;
    }
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
        .then((d: any) => {
          setSelectedCellData(d ?? null);
          setCellDataError(d ? null : 'Failed to load cell data.');
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
        .then((d: any) => {
          if (d?.curves) {
            setCellRecordsByCell((prev) => ({ ...prev, [idNo]: d }));
          }
        })
        .catch(() => {});
    });
  }, [useIndexMode, fullCells, selectedCellId, cellIndex, cellsForCharts]);

  const selectedCell = useMemo(() => {
    if (cellsForCharts.length === 1) return cellsForCharts[0];
    if (cellsForCharts.length > 1 && selectedCellId) {
      const c = cellsForCharts.find((x) => x.cellId === selectedCellId && !!cellRecordsByCell[x.idNo]?.curves);
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
      const selectedHasCurves = cellsForCharts.some((c) => c.cellId === selectedCellId && !!cellRecordsByCell[c.idNo]?.curves);
      if (!selectedHasCurves) {
        const firstWithCurves = cellsForCharts.find((c) => !!cellRecordsByCell[c.idNo]?.curves);
        if (firstWithCurves) setSelectedCellId(firstWithCurves.cellId);
      }
    } else if (filteredCells.length > 0 && !selectedCellId) {
      setSelectedCellId(filteredCells[0].cellId);
    }
  }, [cellsForCharts, filteredCells, selectedCellId, cellRecordsByCell]);

  const allowedCycles = useMemo(() => {
    const s = cycleFilter.trim();
    if (!s) return null;
    const out = new Set<number>();
    for (const part of s.split(/[,;]\s*/)) {
      const dash = part.indexOf('-');
      if (dash >= 0) {
        const lo = parseInt(part.slice(0, dash), 10);
        const hi = parseInt(part.slice(dash + 1), 10);
        if (!isNaN(lo) && !isNaN(hi)) for (let i = lo; i <= hi; i++) out.add(i);
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n)) out.add(n);
      }
    }
    return out.size ? out : null;
  }, [cycleFilter]);

  const COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];

  const activeAnalysis = hierarchyData?.analysis ?? null;
  const pathToColorMap = useMemo(
    () =>
      hierarchyData?.pathToColorMap && Object.keys(hierarchyData.pathToColorMap).length > 0
        ? new Map(Object.entries(hierarchyData.pathToColorMap))
        : new Map<string, string>(),
    [hierarchyData?.pathToColorMap]
  );

  const hierCols = activeAnalysis?.hierCols ?? [];

  const { traces, gcdTraceIndexToCell } = useMemo(() => {
    try {
    const traceIndexMap = new Map<number, { idNo: number; cellName: string }>();
    const out: Plotly.Data[] = [];
    cellsDataList.forEach((cellData, cellIdx) => {
      if (!cellData?.curves) return;
      const curveKeys = Object.keys(cellData.curves).slice(0, 200);
      let cycles = curveKeys
        .map((k) => parseInt(k, 10))
        .filter((x) => !isNaN(x))
        .sort((a, b) => a - b);
      if (allowedCycles) cycles = cycles.filter((c) => allowedCycles.has(c));
      cycles = cycles.slice(0, MAX_CYCLES);
      const cathodeMassG = cellData?.cathodeMassG;
      const useSpecificCapacity = cathodeMassG != null && cathodeMassG > 0;
      const capacityUnit = useSpecificCapacity ? 'mAh g⁻¹' : 'mAh';
      const cellColor =
        cellsDataList.length > 1 && pathToColorMap.size > 0
          ? getColorForCell(cellData, treeFilterPath, hierCols, pathToColorMap)
          : COLORS[cellIdx % COLORS.length];
      const namePrefix = cellsDataList.length > 1 ? `${cellData.cellName ?? `Cell ${cellData.idNo}`} — ` : '';
      for (let i = 0; i < cycles.length; i++) {
        const cyc = cycles[i];
        const curve = cellData.curves[String(cyc)];
        if (!curve) continue;
        const vKey = 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage';
        const qKey = 'Capacity [Ah]' in curve ? 'Capacity [Ah]' : 'capacity';
        const iKey = 'Current [A]' in curve ? 'Current [A]' : null;
        const v = (curve[vKey] ?? []) as (number | null)[];
        const q = (curve[qKey] ?? []) as (number | null)[];
        const curr = iKey ? (curve[iKey] ?? []) as (number | null)[] : null;
        const n = Math.min(v.length, q.length);
        const scale = qKey === 'Capacity [Ah]' ? 1000 : 1;
        const step = n <= MAX_PTS_TRACE ? 1 : Math.ceil(n / MAX_PTS_TRACE);
        const chargePts: { x: number; y: number }[] = [];
        const dchgPts: { x: number; y: number }[] = [];
        for (let j = 0; j < n; j += step) {
          const vv = v[j];
          const qq = q[j];
          if (vv == null || qq == null) continue;
          let qVal = qq * scale;
          if (useSpecificCapacity) qVal = qVal / cathodeMassG;
          const isCharge = !curr || curr[j] == null || curr[j]! > 0;
          if (isCharge) chargePts.push({ x: qVal, y: vv });
          else dchgPts.push({ x: qVal, y: vv });
        }
        let qMinChg = 0;
        let qMaxDchg = 0;
        if (chargePts.length > 0) {
          qMinChg = chargePts[0].x;
          for (let k = 1; k < chargePts.length; k++) {
            if (chargePts[k].x < qMinChg) qMinChg = chargePts[k].x;
          }
        }
        if (dchgPts.length > 0) {
          qMaxDchg = dchgPts[0].x;
          for (let k = 1; k < dchgPts.length; k++) {
            if (dchgPts[k].x > qMaxDchg) qMaxDchg = dchgPts[k].x;
          }
        }
        const cap = MAX_PTS_TRACE;
        const chargeSlice = chargePts.length <= cap ? chargePts : chargePts.slice(0, cap);
        const dchgSlice = dchgPts.length <= cap ? dchgPts : dchgPts.slice(0, cap);
        const chargeX: number[] = [];
        const dchgX: number[] = [];
        for (let k = 0; k < chargeSlice.length; k++) chargeX.push(chargeSlice[k].x - qMinChg);
        for (let k = 0; k < dchgSlice.length; k++) dchgX.push(qMaxDchg - dchgSlice[k].x);
        if (gcdDirection === 'charge' && chargeSlice.length >= 2) {
          const chargeY: number[] = [];
          for (let k = 0; k < chargeSlice.length; k++) chargeY.push(chargeSlice[k].y);
          traceIndexMap.set(out.length, { idNo: cellData.idNo, cellName: cellData.cellName ?? `Cell ${cellData.idNo}` });
          out.push({
            x: chargeX,
            y: chargeY,
            type: 'scatter' as const,
            mode: showConnectedLine ? ('lines' as const) : ('markers' as const),
            name: `${namePrefix}Cycle ${cyc} (charge)`,
            line: showConnectedLine ? { width: 1.5, color: cellColor } : undefined,
            marker: showConnectedLine ? undefined : { size: 3, color: cellColor },
            legendgroup: `${cellData.idNo}-${cyc}`,
            hovertemplate: `${cellData.cellName}<br>Cycle: ${cyc} (charge)<br>Capacity: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
          });
        }
        if (gcdDirection === 'discharge' && dchgSlice.length >= 2) {
          const dchgY: number[] = [];
          for (let k = 0; k < dchgSlice.length; k++) dchgY.push(dchgSlice[k].y);
          traceIndexMap.set(out.length, { idNo: cellData.idNo, cellName: cellData.cellName ?? `Cell ${cellData.idNo}` });
          out.push({
            x: dchgX,
            y: dchgY,
            type: 'scatter' as const,
            mode: showConnectedLine ? ('lines' as const) : ('markers' as const),
            name: `${namePrefix}Cycle ${cyc} (discharge)`,
            line: showConnectedLine ? { width: 1.5, color: cellColor } : undefined,
            marker: showConnectedLine ? undefined : { size: 3, color: cellColor },
            legendgroup: `${cellData.idNo}-${cyc}`,
            hovertemplate: `${cellData.cellName}<br>Cycle: ${cyc} (discharge)<br>Capacity: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
          });
        }
      }
    });
    if (cellsDataList.length <= 1 && out.length > 0) {
      const n = out.length;
      out.forEach((tr, idx) => {
        const c = turboColor(n > 1 ? idx / (n - 1) : 0);
        const s = tr as { line?: { color: string }; marker?: { color: string } };
        if (s.line) s.line.color = c;
        if (s.marker) s.marker.color = c;
      });
    }
    return { traces: out, gcdTraceIndexToCell: traceIndexMap };
    } catch (e) {
      console.warn('VoltageCapacityPanel: error building traces', e);
      return { traces: [], gcdTraceIndexToCell: new Map() };
    }
  }, [cellsDataList, allowedCycles, showConnectedLine, gcdDirection, treeFilterPath, hierCols, pathToColorMap]);

  /** All cycles connected; turbo colors per cycle, matching GCD chart */
  const COMBINED_MAX_PTS = 4000;
  const combinedGcdTraces = useMemo((): Plotly.Data[] => {
    try {
      const out: Plotly.Data[] = [];
      for (const cellData of cellsDataList) {
        if (!cellData?.curves) continue;
        const curveKeys = Object.keys(cellData.curves).slice(0, 200);
        let cycles = curveKeys
          .map((k) => parseInt(k, 10))
          .filter((x) => !isNaN(x))
          .sort((a, b) => a - b);
        if (allowedCycles) cycles = cycles.filter((c) => allowedCycles.has(c));
        cycles = cycles.slice(0, MAX_CYCLES);
        const cathodeMassG = cellData?.cathodeMassG;
        const useSpecificCapacity = cathodeMassG != null && cathodeMassG > 0;
        const capacityUnit = useSpecificCapacity ? 'mAh g⁻¹' : 'mAh';
        const prefix = cellsDataList.length > 1 ? `${cellData.cellName ?? `Cell ${cellData.idNo}`} — ` : '';
        const cellColor =
          cellsDataList.length > 1 && pathToColorMap.size > 0
            ? getColorForCell(cellData, treeFilterPath, hierCols, pathToColorMap)
            : '';
        let cum = 0;
        for (let i = 0; i < cycles.length; i++) {
          const cyc = cycles[i];
          const curve = cellData.curves[String(cyc)];
          if (!curve) continue;
          const vKey = 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage';
          const qKey = 'Capacity [Ah]' in curve ? 'Capacity [Ah]' : 'capacity';
          const iKey = 'Current [A]' in curve ? 'Current [A]' : null;
          const v = (curve[vKey] ?? []) as (number | null)[];
          const q = (curve[qKey] ?? []) as (number | null)[];
          const curr = iKey ? (curve[iKey] ?? []) as (number | null)[] : null;
          const n = Math.min(v.length, q.length);
          const scale = qKey === 'Capacity [Ah]' ? 1000 : 1;
          const chargePts: { x: number; y: number }[] = [];
          const dchgPts: { x: number; y: number }[] = [];
          for (let j = 0; j < n; j++) {
            const vv = v[j];
            const qq = q[j];
            if (vv == null || qq == null) continue;
            let qVal = qq * scale;
            if (useSpecificCapacity) qVal = qVal / cathodeMassG;
            const isCharge = !curr || curr[j] == null || curr[j]! > 0;
            if (isCharge) chargePts.push({ x: qVal, y: vv });
            else dchgPts.push({ x: qVal, y: vv });
          }
          let qMinChg = 0;
          let qMaxDchg = 0;
          if (chargePts.length > 0) {
            qMinChg = chargePts[0].x;
            for (let k = 1; k < chargePts.length; k++) {
              if (chargePts[k].x < qMinChg) qMinChg = chargePts[k].x;
            }
          }
          if (dchgPts.length > 0) {
            qMaxDchg = dchgPts[0].x;
            for (let k = 1; k < dchgPts.length; k++) {
              if (dchgPts[k].x > qMaxDchg) qMaxDchg = dchgPts[k].x;
            }
          }
          const chgEnd = chargePts.length > 0 ? chargePts.reduce((m, p) => Math.max(m, p.x - qMinChg), 0) : 0;
          const dchgEnd = dchgPts.length > 0 ? dchgPts.reduce((m, p) => Math.max(m, qMaxDchg - p.x), 0) : 0;
          const cap = MAX_PTS_TRACE;
          const chargeSlice = chargePts.length <= cap ? chargePts : chargePts.slice(0, cap);
          const dchgSlice = dchgPts.length <= cap ? dchgPts : dchgPts.slice(0, cap);
          const stepChg = Math.max(1, Math.ceil(chargeSlice.length / 200));
          const stepDchg = Math.max(1, Math.ceil(dchgSlice.length / 200));
          const legendGroup = `${cellData.idNo}-${cyc}`;
          if (gcdDirection === 'charge' && chargeSlice.length >= 2) {
            const xArr: number[] = [];
            const yArr: number[] = [];
            for (let k = 0; k < chargeSlice.length; k += stepChg) {
              xArr.push(cum + (chargeSlice[k].x - qMinChg));
              yArr.push(chargeSlice[k].y);
            }
            cum += chgEnd;
            out.push({
              x: xArr,
              y: yArr,
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: `${prefix}Cycle ${cyc} (charge)`,
              line: { width: 1.5, color: cellColor || '' },
              legendgroup: legendGroup,
              hovertemplate: `${cellData.cellName}<br>Cycle: ${cyc} (charge)<br>Cumulative: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
            });
          }
          if (gcdDirection === 'discharge' && dchgSlice.length >= 2) {
            const xArr: number[] = [];
            const yArr: number[] = [];
            for (let k = 0; k < dchgSlice.length; k += stepDchg) {
              xArr.push(cum + (qMaxDchg - dchgSlice[k].x));
              yArr.push(dchgSlice[k].y);
            }
            cum += dchgEnd;
            out.push({
              x: xArr,
              y: yArr,
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: `${prefix}Cycle ${cyc} (discharge)`,
              line: { width: 1.5, color: cellColor || '' },
              legendgroup: legendGroup,
              hovertemplate: `${cellData.cellName}<br>Cycle: ${cyc} (discharge)<br>Cumulative: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
            });
          }
        }
      }
      const n = out.length;
      const usePathColors = cellsDataList.length > 1 && pathToColorMap.size > 0;
      out.forEach((tr, idx) => {
        const s = tr as { line?: { color: string }; opacity?: number; legendgroup?: string };
        if (s.line && !usePathColors) {
          const c = turboColor(n > 1 ? idx / (n - 1) : 0);
          s.line.color = c;
        }
        if (combinedHighlightCycle != null && s.legendgroup) {
          const cycleFromGroup = (s.legendgroup as string).split('-').pop();
          if (cycleFromGroup !== String(combinedHighlightCycle)) {
            (tr as { opacity?: number }).opacity = 0.2;
          }
        }
      });
      return out;
    } catch (e) {
      console.warn('VoltageCapacityPanel: error building combined traces', e);
      return [];
    }
  }, [cellsDataList, allowedCycles, combinedHighlightCycle, gcdDirection, treeFilterPath, hierCols, pathToColorMap]);

  const combinedGcdLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 360,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: {
        text: cellsDataList.length > 1
          ? `${cellsDataList.length} cells: All cycles`
          : selectedCell
            ? `${selectedCell.cellName}: All cycles`
            : 'All cycles',
        font: { size: titleFontSize },
      },
      xaxis: {
        title: {
          text:
            selectedCellData?.cathodeMassG != null && selectedCellData.cathodeMassG > 0
              ? 'Cumulative specific capacity (mAh g⁻¹)'
              : 'Cumulative capacity (mAh)',
          font: { size: labelFontSize },
        },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: false,
      margin: { t: 48, r: 44, b: 80, l: 65 },
      uirevision: 'combined-gcd',
    }),
    [fontFamily, titleFontSize, labelFontSize, legendFontSize, selectedCell, selectedCellData]
  );

  const INITIAL_V_MAX_CYCLES = 5;
  const initialVoltageTraces = useMemo((): Plotly.Data[] => {
    const traces: Plotly.Data[] = [];
    cellsDataList.forEach((cellData, cellIdx) => {
      if (!cellData?.curves) return;
      const curveKeys = Object.keys(cellData.curves).slice(0, 200);
      let cycles = curveKeys
        .map((k) => parseInt(k, 10))
        .filter((x) => !isNaN(x))
        .sort((a, b) => a - b);
      if (allowedCycles) cycles = cycles.filter((c) => allowedCycles.has(c));
      cycles = cycles.slice(0, INITIAL_V_MAX_CYCLES);
      const namePrefix = cellsDataList.length > 1 ? `${cellData.cellName ?? `Cell ${cellData.idNo}`} — ` : '';
      const cellColor =
        cellsDataList.length > 1 && pathToColorMap.size > 0
          ? getColorForCell(cellData, treeFilterPath, hierCols, pathToColorMap)
          : COLORS[cellIdx % COLORS.length];
      for (let i = 0; i < cycles.length; i++) {
        const cyc = cycles[i];
        const curve = cellData.curves[String(cyc)];
        if (!curve) continue;
        const vKey = 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage';
        const tKey = 'Time [s]' in curve ? 'Time [s]' : null;
        const v = (curve[vKey] ?? []) as (number | null)[];
        const tRaw = tKey ? (curve[tKey] ?? []) as (number | null)[] : null;
        const n = v.length;
        const times: number[] = [];
        const volts: number[] = [];
        for (let j = 0; j < n; j++) {
          const vv = v[j];
          if (vv == null) continue;
          const tt = tRaw && tRaw[j] != null ? (tRaw[j] as number) : j;
          times.push(tt);
          volts.push(vv);
        }
        if (times.length >= 2) {
          traces.push({
            x: times,
            y: volts,
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: `${namePrefix}Cycle ${cyc}`,
            line: { width: 1.5, color: cellsDataList.length > 1 ? cellColor : '' },
            hovertemplate: `${cellData.cellName} Cycle ${cyc}<br>Time: %{x:.1f} s<br>Voltage: %{y:.3f} V<extra></extra>`,
          });
        }
      }
    });
    if (cellsDataList.length <= 1 && traces.length > 0) {
      const n = traces.length;
      traces.forEach((tr, idx) => {
        const c = turboColor(n > 1 ? idx / (n - 1) : 0);
        const s = tr as { line?: { color: string } };
        if (s.line) s.line.color = c;
      });
    }
    return traces;
  }, [cellsDataList, allowedCycles, treeFilterPath, hierCols, pathToColorMap]);

  const initialVoltageLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: `${selectedCell?.cellName ?? 'Cell'}: Voltage vs time (first few cycles)`, font: { size: titleFontSize } },
      xaxis: {
        title: { text: 'Time (s)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: true,
      legend: { x: 0.99, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)' },
      margin: { t: 48, r: 40, b: 80, l: 65 },
      uirevision: 'initial-voltage',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell]
  );

  const useSpecificCapacity = selectedCellData?.cathodeMassG != null && selectedCellData.cathodeMassG > 0;
  const effectiveXLabel = useSpecificCapacity ? 'Specific capacity (mAh g⁻¹)' : 'Capacity (mAh)';

  const layout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 480,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: selectedCell ? `${selectedCell.cellName}: GCD` : chartTitle, font: { size: titleFontSize } },
      xaxis: {
        title: { text: effectiveXLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: yAxisLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: showLegend,
      legend: showLegend
        ? {
            orientation: 'v',
            font: { size: legendFontSize },
            ...(legendPosition === 'in'
              ? { x: 0.99, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)' }
              : { x: 1.02, y: 0, xanchor: 'left', yanchor: 'bottom' }),
          }
        : undefined,
      margin: { t: 48, r: showLegend && legendPosition === 'right-bottom' ? 120 : 40, b: 80, l: 65 },
      uirevision: 'voltage-capacity',
    }),
    [
      selectedCell,
      chartTitle,
      effectiveXLabel,
      yAxisLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
      legendFontSize,
      showLegend,
      legendPosition,
    ]
  );

  const selectedCellRatePerf = useMemo(() => {
    if (!ratePerfCells?.length || !selectedCell) return null;
    return (
      ratePerfCells.find((c) => c.cellId === selectedCell.cellId || c.idNo === selectedCell.idNo) ?? null
    );
  }, [ratePerfCells, selectedCell]);

  const segmentByCrate = useCallback(
    (x: number[], y: number[], cRates?: number[]): { x: (number | null)[]; y: (number | null)[]; customdata?: (number | null)[] } => {
      if (!cRates || cRates.length !== x.length) return { x, y, customdata: cRates };
      const xOut: (number | null)[] = [];
      const yOut: (number | null)[] = [];
      const cOut: (number | null)[] = [];
      for (let i = 0; i < x.length; i++) {
        if (i > 0 && cRates[i] !== cRates[i - 1]) {
          xOut.push(null);
          yOut.push(null);
          cOut.push(null);
        }
        xOut.push(x[i]);
        yOut.push(y[i]);
        cOut.push(cRates[i]);
      }
      return { x: xOut, y: yOut, customdata: cOut };
    },
    [],
  );

  const ratePerfTraces = useMemo((): Plotly.Data[] => {
    if (!selectedCellRatePerf) return [];
    const row = selectedCellRatePerf;
    const hasCrate = row.cRates && row.cRates.length === row.cycles.length;
    const useLines = showConnectedLine && hasCrate && row.cRates;
    const { x, y, customdata } = useLines
      ? segmentByCrate(row.cycles, row.specificCapacityMahG ?? row.dischargeCapacityMah, row.cRates)
      : { x: row.cycles, y: row.specificCapacityMahG ?? row.dischargeCapacityMah, customdata: hasCrate ? row.cRates : undefined };
    return [
      {
        x,
        y,
        type: 'scatter' as const,
        mode: useLines ? ('lines+markers' as const) : ('markers' as const),
        name: row.cellName,
        line: useLines ? { width: 2, color: turboColor(0) } : undefined,
        marker: { size: 6, color: turboColor(0) },
        connectgaps: false,
        hovertemplate: hasCrate
          ? `${row.cellName}<br>Cycle: %{x}<br>Capacity: %{y:.2f}<br>C-rate: %{customdata}C<extra></extra>`
          : `${row.cellName}<br>Cycle: %{x}<br>Capacity: %{y:.2f}<extra></extra>`,
        customdata,
      },
    ];
  }, [selectedCellRatePerf, showConnectedLine, segmentByCrate]);

  const ratePerfProtocolShapes = useMemo((): Partial<Plotly.Shape>[] => {
    const segs = selectedCellRatePerf?.protocolSegments ?? [];
    if (segs.length <= 1) return [];
    const maxY = Math.max(
      0,
      ...(selectedCellRatePerf?.specificCapacityMahG ?? selectedCellRatePerf?.dischargeCapacityMah ?? [0])
    );
    const yTop = maxY * 1.02 || 1;
    const shapes: Partial<Plotly.Shape>[] = [];
    for (let i = 0; i < segs.length - 1; i++) {
      const x = segs[i].cycleEnd + 0.5;
      shapes.push({
        type: 'line' as const,
        x0: x,
        x1: x,
        y0: 0,
        y1: yTop,
        xref: 'x',
        yref: 'y',
        line: { dash: 'dash', width: 1.5, color: 'rgba(128,128,128,0.7)' },
        layer: 'below',
      });
    }
    return shapes;
  }, [selectedCellRatePerf]);

  const ratePerfProtocolAnnotations = useMemo((): Partial<Plotly.Annotations>[] => {
    const segs = selectedCellRatePerf?.protocolSegments ?? [];
    if (!segs.length) return [];
    return segs.map((seg) => ({
      x: (seg.cycleStart + seg.cycleEnd) / 2,
      y: 1,
      yref: 'paper' as const,
      xanchor: 'center' as const,
      yanchor: 'top' as const,
      text: `${seg.cRate}C`,
      showarrow: false,
      font: { size: 10, color: '#555' },
    }));
  }, [selectedCellRatePerf]);

  const ratePerfLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 360,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: `${selectedCellRatePerf?.cellName ?? 'Rate performance'}: discharge capacity vs cycle`, font: { size: titleFontSize } },
      xaxis: {
        title: { text: 'Cycle number', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Capacity (mAh g⁻¹)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: false,
      margin: { t: 48, r: 40, b: 80, l: 65 },
      uirevision: 'rate-perf-gcd',
      shapes: ratePerfProtocolShapes,
      annotations: ratePerfProtocolAnnotations,
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCellRatePerf, ratePerfProtocolShapes, ratePerfProtocolAnnotations]
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Load/error states */}
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {cellDataLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {cellDataError && !cellDataLoading && <p className="text-xs text-destructive">{cellDataError}</p>}
      <div className="flex items-center justify-end gap-3 shrink-0 flex-wrap">
        <div className="inline-flex items-center rounded-full border border-border bg-muted/60 p-1">
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full px-4 ${gcdDirection === 'discharge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
            onClick={() => setGcdDirection('discharge')}
          >
            Discharge
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full px-4 ${gcdDirection === 'charge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
            onClick={() => setGcdDirection('charge')}
          >
            Charge
          </Button>
        </div>
      </div>
      {/* Chart content */}
      <div className="flex-1 min-w-0 min-h-0 overflow-auto transition-all duration-300">
        <div className="space-y-4 p-4 w-full min-w-0">
          {/* All cycles connected (before GCD) */}
          {combinedGcdTraces.length > 0 && (() => {
            const uniqueCycles = [...new Set(
              combinedGcdTraces
                .map((t) => (t as { legendgroup?: string }).legendgroup)
                .filter(Boolean)
                .map((g) => (g as string).includes('-') ? (g as string).split('-').pop() : g)
            )].sort((a, b) => parseInt(a ?? '0', 10) - parseInt(b ?? '0', 10));
            const minCycle = uniqueCycles[0] ? parseInt(uniqueCycles[0], 10) : 1;
            const maxCycle = uniqueCycles[uniqueCycles.length - 1] ? parseInt(uniqueCycles[uniqueCycles.length - 1], 10) : 1;
            const turboStops = Array.from({ length: 32 }, (_, i) => turboColor(i / 31)).join(', ');
            const scaleWidth = 44;
            const gap = 12;
            const renderChart = (w: number, h: number) => {
              const chartW = w - scaleWidth - gap;
              return (
              <div className="flex gap-3 items-stretch shrink-0" style={{ width: w, height: h }}>
                <div className="relative shrink-0 bg-white dark:bg-card rounded overflow-hidden" style={{ width: chartW, height: h }}>
                  <PlotlyChart
                    key={`combined-${chartW}-${h}`}
                    data={combinedGcdTraces}
                    layout={{ ...combinedGcdLayout, width: chartW, height: h }}
                    config={{ responsive: true }}
                    style={{ width: chartW, height: h }}
                  />
                  {combinedHighlightCycle != null && (
                    <button
                      type="button"
                      onClick={() => setCombinedHighlightCycle(null)}
                      className="absolute bottom-2 right-2 z-10 text-[10px] px-2 py-1 rounded bg-muted/80 hover:bg-muted"
                    >
                      Clear (Cycle {combinedHighlightCycle})
                    </button>
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onMouseDown={(e) => handleResizeStart(e, setCombinedChartSize, { width: w, height: h })}
                    className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                    title="Drag to resize"
                    aria-label="Resize chart"
                  >
                    <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                  </div>
                </div>
                {/* Color scale – beside chart, not on plot */}
                <div
                  className="shrink-0 flex flex-col items-center justify-center gap-0.5"
                  style={{ width: scaleWidth, minHeight: h, alignSelf: 'stretch' }}
                >
                  <span className="text-[9px] text-muted-foreground">Cycle {minCycle}</span>
                  <div
                    role="slider"
                    tabIndex={0}
                    className="rounded cursor-pointer border border-border/60 hover:border-border shadow-sm shrink-0"
                    style={{
                      width: 18,
                      height: 140,
                      background: `linear-gradient(to bottom, ${turboStops})`,
                    }}
                    onClick={(e) => {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      const y = e.clientY - rect.top;
                      const t = Math.max(0, Math.min(1, y / rect.height));
                      const idx = uniqueCycles.length <= 1 ? 0 : Math.round(t * (uniqueCycles.length - 1));
                      const cycle = uniqueCycles[idx] ? parseInt(uniqueCycles[idx], 10) : null;
                      setCombinedHighlightCycle((prev) => (prev === cycle ? null : cycle));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setCombinedHighlightCycle(null);
                    }}
                    title={`Click to highlight cycle (${minCycle}–${maxCycle}). Escape to clear.`}
                    aria-label={`Color scale: cycle ${minCycle} to ${maxCycle}. Click to highlight.`}
                  />
                  <span className="text-[9px] text-muted-foreground">Cycle {maxCycle}</span>
                </div>
              </div>
              );
            };
            return (
            <div
              className="rounded-lg border border-border bg-card p-4 w-full min-w-0"
              style={
                combinedChartSize
                  ? { minWidth: combinedChartSize.width + 32, minHeight: combinedChartSize.height + 32 }
                  : undefined
              }
            >
              <ResponsiveChartContainer aspectRatio={800 / 360} minHeight={240} overrideSize={combinedChartSize}>
                {({ width, height }) => renderChart(width, height)}
              </ResponsiveChartContainer>
            </div>
            );
          })()}

          <div
            className="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0"
            style={
              chartSize
                ? { minWidth: chartSize.width + 32, minHeight: chartSize.height + 32 }
                : undefined
            }
          >
            {filteredCells.length > 0 && (
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                <Label className="text-xs text-muted-foreground shrink-0">Cycles</Label>
                <Input
                  value={cycleFilter}
                  onChange={(e) => setCycleFilter(e.target.value)}
                  placeholder="All or 1, 2, 5 or 1-5"
                  className="h-9 w-48 text-xs"
                />
              </div>
            )}
            {traces.length > 0 ? (
              <ResponsiveChartContainer aspectRatio={800 / 480} minHeight={280} overrideSize={chartSize}>
                {({ width, height }) => {
                  const w = width;
                  const h = height;
                  return (
                  <div className="relative bg-white dark:bg-card rounded" style={{ width: w, height: h }}>
                    <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                      <PlotlyChart
                        key={`gcd-${w}-${h}`}
                        data={traces}
                        layout={{ ...layout, width: w, height: h }}
                        config={{ responsive: true }}
                        style={{ width: w, height: h }}
                        traceIndexToCell={gcdTraceIndexToCell}
                        onContextMenu={(cell) => setSelectedCellIds([cell.idNo])}
                        onClick={(ev) => {
                          const pt = ev.points?.[0];
                          if (pt && selectedCell) setSelectedCellIds([selectedCell.idNo]);
                        }}
                      />
                    </div>
                    <ChartEditPopover
                      config={{
                        chartTitle,
                        xAxisLabel,
                        yAxisLabel,
                        fontFamily,
                        titleFontSize,
                        labelFontSize,
                        legendFontSize,
                        showLegend,
                        legendPosition,
                        showConnectedLine,
                      }}
                      onConfigChange={(k, v) => {
                        if (k === 'chartTitle') setChartTitle(v);
                        else if (k === 'xAxisLabel') setXAxisLabel(v);
                        else if (k === 'yAxisLabel') setYAxisLabel(v);
                        else if (k === 'fontFamily') setFontFamily(v);
                        else if (k === 'titleFontSize') setTitleFontSize(v);
                        else if (k === 'labelFontSize') setLabelFontSize(v);
                        else if (k === 'legendFontSize') setLegendFontSize(v);
                        else if (k === 'showLegend') setShowLegend(v);
                        else if (k === 'legendPosition') setLegendPosition(v);
                        else if (k === 'showConnectedLine') setShowConnectedLine(v ?? false);
                      }}
                      showConnectedLineOption
                      chartLabel="GCD"
                    />
                    <div
                      role="button"
                      tabIndex={0}
                      onMouseDown={(e) => handleResizeStart(e, setChartSize, { width: w, height: h })}
                      className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                      title="Drag to resize"
                      aria-label="Resize chart"
                    >
                      <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                    </div>
                  </div>
                  );
                }}
              </ResponsiveChartContainer>
            ) : (
              <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                {cellIndex === null ? (
                  <p>No record data found.</p>
                ) : filteredCells.length === 0 ? (
                  <p>No cells match the current filters. Try different cathode or separator settings.</p>
                ) : (
                  <p>No V–Q data for the selected cell.</p>
                )}
              </div>
            )}
          </div>

          {/* Rate performance chart - below GCD, for selected cell */}
          {selectedCellRatePerf && ratePerfTraces.length > 0 && (
            <div
              className="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0"
              style={
                ratePerfChartSize
                  ? { minWidth: ratePerfChartSize.width + 32, minHeight: ratePerfChartSize.height + 32 }
                  : undefined
              }
            >
              <ResponsiveChartContainer aspectRatio={800 / 360} minHeight={240} overrideSize={ratePerfChartSize}>
                {({ width, height }) => (
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <PlotlyChart
                        key={`rateperf-${width}-${height}`}
                        data={ratePerfTraces}
                        layout={{ ...ratePerfLayout, width, height }}
                        config={{ responsive: true }}
                        style={{ width, height }}
                      />
                      <ChartEditPopover
                        config={{
                          chartTitle,
                          xAxisLabel,
                          yAxisLabel,
                          fontFamily,
                          titleFontSize,
                          labelFontSize,
                          legendFontSize,
                          showLegend,
                          legendPosition,
                          showConnectedLine,
                        }}
                        onConfigChange={(k, v) => {
                          if (k === 'chartTitle') setChartTitle(v);
                          else if (k === 'xAxisLabel') setXAxisLabel(v);
                          else if (k === 'yAxisLabel') setYAxisLabel(v);
                          else if (k === 'fontFamily') setFontFamily(v);
                          else if (k === 'titleFontSize') setTitleFontSize(v);
                          else if (k === 'labelFontSize') setLabelFontSize(v);
                          else if (k === 'legendFontSize') setLegendFontSize(v);
                          else if (k === 'showLegend') setShowLegend(v);
                          else if (k === 'legendPosition') setLegendPosition(v);
                          else if (k === 'showConnectedLine') setShowConnectedLine(v ?? false);
                        }}
                        showConnectedLineOption
                        chartLabel="Rate performance"
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onMouseDown={(e) => handleResizeStart(e, setRatePerfChartSize, { width, height })}
                        className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                        title="Drag to resize"
                        aria-label="Resize chart"
                      >
                        <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                      </div>
                    </div>
                  )}
                </ResponsiveChartContainer>
            </div>
          )}

          {/* Initial voltage vs cycle */}
          {initialVoltageTraces.length > 0 && (
            <div
              className="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0"
              style={
                initialVoltageChartSize
                  ? { minWidth: initialVoltageChartSize.width + 32, minHeight: initialVoltageChartSize.height + 32 }
                  : { minWidth: 532 }
              }
            >
              <ResponsiveChartContainer aspectRatio={800 / 320} minHeight={200} minWidth={500} overrideSize={initialVoltageChartSize}>
                {({ width, height }) => (
                    <div className="relative bg-white dark:bg-card rounded overflow-visible" style={{ width, height }}>
                      <PlotlyChart
                        key={`initial-${width}-${height}`}
                        data={initialVoltageTraces}
                        layout={initialVoltageLayout}
                        config={{ responsive: true }}
                        style={{ width, height }}
                      />
                      <ChartEditPopover
                        config={{
                          chartTitle,
                          xAxisLabel,
                          yAxisLabel,
                          fontFamily,
                          titleFontSize,
                          labelFontSize,
                          legendFontSize,
                          showLegend,
                          legendPosition,
                        }}
                        onConfigChange={(k, v) => {
                          if (k === 'chartTitle') setChartTitle(v);
                          else if (k === 'xAxisLabel') setXAxisLabel(v);
                          else if (k === 'yAxisLabel') setYAxisLabel(v);
                          else if (k === 'fontFamily') setFontFamily(v);
                          else if (k === 'titleFontSize') setTitleFontSize(v);
                          else if (k === 'labelFontSize') setLabelFontSize(v);
                          else if (k === 'legendFontSize') setLegendFontSize(v);
                          else if (k === 'showLegend') setShowLegend(v);
                          else if (k === 'legendPosition') setLegendPosition(v);
                        }}
                        chartLabel="Initial voltage"
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        onMouseDown={(e) => handleResizeStart(e, setInitialVoltageChartSize, { width, height })}
                        className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                        title="Drag to resize"
                        aria-label="Resize chart"
                      >
                        <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                      </div>
                    </div>
                  )}
                </ResponsiveChartContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GcdDashboard;
