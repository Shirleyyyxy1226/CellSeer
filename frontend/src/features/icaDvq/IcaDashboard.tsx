import { useMemo, useState, useCallback, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useIcaDvqData } from './useIcaDvqData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { cycleFadeColor } from '@/lib/icaDvqUtils';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { Surface3dPlot } from './plots/Surface3dPlot';
import { PeakAnalysisPlot } from './plots/PeakAnalysisPlot';

type ViewMode = 'baseline' | 'range';

interface Props {
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
}

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.max(0.3, Math.min(1, opacity));
  return `rgba(${r},${g},${b},${a})`;
}

function findPeak(arr: number[]): { index: number; value: number } {
  let index = 0;
  let value = arr[0];
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > value) { value = arr[i]; index = i; }
  }
  return { index, value };
}

const IcaDashboard = ({ cathodeFilter, spacerFilter, separatorFilter }: Props) => {
  const { multiselectionMode, selectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const [direction, setDirection] = useState<'discharge' | 'charge'>('discharge');
  const { icaData, cells, loading, error, noIcaDvqHint } = useIcaDvqData(
    cathodeFilter,
    spacerFilter,
    separatorFilter,
    direction,
  );
  const data = icaData;
  const { apiData, matchPathToIdNos } = useProjectHierarchy();
  const activeAnalysis = apiData?.analysis ?? null;

  const pathToColorMap = useMemo(
    () => apiData?.pathToColorMap && Object.keys(apiData.pathToColorMap).length > 0
      ? new Map(Object.entries(apiData.pathToColorMap))
      : new Map<string, string>(),
    [apiData?.pathToColorMap]
  );

  const cycles = data?.cycles ?? [];
  const [cycleIndex, setCycleIndex] = useState(Math.max(0, cycles.length - 1));
  const [viewMode, setViewMode] = useState<ViewMode>('baseline');
  const [cycleInput, setCycleInput] = useState(() => String(cycles[cycles.length - 1] ?? 0));
  const selectedCycle = cycles[cycleIndex] ?? 0;

  useEffect(() => {
    const lastIdx = Math.max(0, cycles.length - 1);
    setCycleIndex((prev) => Math.min(prev, lastIdx));
    setCycleInput(String(cycles[lastIdx] ?? 0));
  }, [cycles.length]);

  useEffect(() => setCycleInput(String(selectedCycle)), [selectedCycle]);

  const commitCycleInput = useCallback(() => {
    const num = parseInt(cycleInput, 10);
    if (Number.isNaN(num)) { setCycleInput(String(selectedCycle)); return; }
    let best = 0;
    let bestDiff = Math.abs(cycles[0] - num);
    for (let i = 1; i < cycles.length; i++) {
      const d = Math.abs(cycles[i] - num);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    setCycleIndex(best);
    setCycleInput(String(cycles[best]));
  }, [cycleInput, selectedCycle, cycles]);

  const filteredCellIds = useMemo(() => {
    const allIds = new Set((data?.cellData ?? []).map((cd) => cd.cell.id));
    if (multiselectionMode && selectedCellIds.length > 0) {
      const selIds = new Set(cells.filter((c) => selectedCellIds.includes(c.idNo)).map((c) => c.cellId));
      return new Set([...allIds].filter((id) => selIds.has(id)));
    }
    if (treeFilterPath.length > 0) {
      const matchedIdNos = matchPathToIdNos(treeFilterPath);
      if (matchedIdNos && matchedIdNos.size > 0) {
        const treeIds = new Set(cells.filter((c) => matchedIdNos.has(c.idNo)).map((c) => c.cellId));
        return new Set([...allIds].filter((id) => treeIds.has(id)));
      }
      if (!multiselectionMode && selectedCellIds.length > 0) {
        const selIds = new Set(cells.filter((c) => selectedCellIds.includes(c.idNo)).map((c) => c.cellId));
        return new Set([...allIds].filter((id) => selIds.has(id)));
      }
      return new Set<string>();
    }
    return allIds;
  }, [data?.cellData, cells, treeFilterPath, multiselectionMode, selectedCellIds, matchPathToIdNos]);

  const hierCols = activeAnalysis?.hierCols ?? [];

  const traces3d = useMemo(() => {
    if (!data?.cellData?.length) return [] as Plotly.Data[];
    const result: Plotly.Data[] = [];
    data.cellData.forEach((cd) => {
      if (!filteredCellIds.has(cd.cell.id)) return;
      const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
      const color = cellMatch ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap) : cd.cell.color;
      const total = cd.cycleTraces.length;
      cd.cycleTraces.forEach((ct, idx) => {
        result.push({
          x: data.voltages, y: new Array(data.voltages.length).fill(ct.cycle), z: ct.dqdv,
          type: 'scatter3d', mode: 'lines',
          name: `${cd.cell.name} - Cycle ${ct.cycle}`,
          line: { color: cycleFadeColor(color, total <= 1 ? 1 : idx / (total - 1)), width: 3 },
          legendgroup: cd.cell.id, showlegend: idx === total - 1,
          hovertemplate: `${cd.cell.name}<br>Voltage: %{x:.2f} V<br>Cycle: %{y}<br>IC: %{z:.2f} Ah/V<extra></extra>`,
        });
      });
    });
    return result;
  }, [data, filteredCellIds, cells, treeFilterPath, hierCols, pathToColorMap]);

  const BASELINE_IDX = 1;

  const traces2d = useMemo(() => {
    if (!data?.cellData?.length) return [] as Plotly.Data[];
    const result: Plotly.Data[] = [];

    if (viewMode === 'range') {
      const rangeTraces: Plotly.Data[] = [];
      const lines: Plotly.Data[] = [];
      const peaks: Plotly.Data[] = [];
      data.cellData.forEach((cd) => {
        if (!filteredCellIds.has(cd.cell.id)) return;
        const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
        const color = cellMatch ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap) : cd.cell.color;
        const xParts: (number | null)[] = [];
        const yParts: (number | null)[] = [];
        cd.cycleTraces.forEach((ct, idx) => {
          if (idx > 0) { xParts.push(null); yParts.push(null); }
          xParts.push(...data.voltages); yParts.push(...ct.dqdv);
        });
        rangeTraces.push({ x: xParts, y: yParts, type: 'scatter', mode: 'lines', name: `${cd.cell.name} range`, line: { color: hexToRgba(color, 0.25), width: 1.5 }, hovertemplate: `${cd.cell.name}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`, showlegend: true, connectgaps: false });
        const ct = cd.cycleTraces[cycleIndex];
        if (ct) {
          lines.push({ x: data.voltages, y: ct.dqdv, type: 'scatter', mode: 'lines', name: `${cd.cell.name} Cycle ${ct.cycle}`, line: { color, width: 2 }, hovertemplate: `${cd.cell.name}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>` });
          const { index: pi, value: pv } = findPeak(ct.dqdv);
          peaks.push({ x: [data.voltages[pi]], y: [pv], type: 'scatter', mode: 'markers', name: `${cd.cell.name} peak`, marker: { size: 10, color, symbol: 'diamond', line: { width: 1, color: '#fff' } }, hovertemplate: `${cd.cell.name} peak<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>` });
        }
      });
      return [...rangeTraces, ...lines, ...peaks];
    }

    const baselineLines: Plotly.Data[] = [];
    const lines: Plotly.Data[] = [];
    const peaks: Plotly.Data[] = [];
    data.cellData.forEach((cd) => {
      if (!filteredCellIds.has(cd.cell.id)) return;
      const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
      const color = cellMatch ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap) : cd.cell.color;
      const ct = cd.cycleTraces[cycleIndex];
      if (!ct) return;
      const baseline = cd.cycleTraces[BASELINE_IDX];
      if (baseline) baselineLines.push({ x: data.voltages, y: baseline.dqdv, type: 'scatter', mode: 'lines', name: `${cd.cell.name} Cycle 2`, line: { color: hexToRgba(color, 0.4), width: 1.5 }, hovertemplate: `${cd.cell.name} Cycle 2<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>` });
      const { index: pi, value: pv } = findPeak(ct.dqdv);
      lines.push({ x: data.voltages, y: ct.dqdv, type: 'scatter', mode: 'lines', name: cd.cell.name, line: { color, width: 2 }, hovertemplate: `${cd.cell.name}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<br>Peak: ${data.voltages[pi].toFixed(2)} V, ${pv.toFixed(2)} Ah/V<extra></extra>` });
      peaks.push({ x: [data.voltages[pi]], y: [pv], type: 'scatter', mode: 'markers', name: `${cd.cell.name} peak`, marker: { size: 10, color, symbol: 'diamond', line: { width: 1, color: '#fff' } }, hovertemplate: `${cd.cell.name} peak<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>` });
    });
    return [...baselineLines, ...lines, ...peaks];
  }, [data, filteredCellIds, cycleIndex, viewMode, cells, treeFilterPath, hierCols, pathToColorMap]);

  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const title2d = viewMode === 'range'
    ? `${directionLabel} · Range (all cycles)`
    : `${directionLabel} · Cycle ${selectedCycle}`;

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex flex-col gap-3">
      {loading && <p className="text-sm text-muted-foreground">Loading cell data from database…</p>}
      {error && !loading && <p className="text-sm text-amber-600">Database unavailable: {error}</p>}
      {noIcaDvqHint && !loading && <p className="text-sm text-muted-foreground">{noIcaDvqHint}</p>}
      <div className="flex items-center justify-end gap-3 shrink-0 flex-wrap">
        <div className="inline-flex items-center rounded-full border border-border bg-muted/60 p-1">
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full px-4 ${direction === 'discharge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
            onClick={() => setDirection('discharge')}
          >
            Discharge
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`rounded-full px-4 ${direction === 'charge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
            onClick={() => setDirection('charge')}
          >
            Charge
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 min-h-[520px] lg:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-border bg-card p-4 overflow-hidden flex justify-center items-center">
          <Surface3dPlot traces={traces3d} xValues={data?.voltages ?? []} xLabel="Voltage (V)" zLabel="dQ/dV (Ah/V)" title={`Incremental Capacity Analysis (ICA) — ${directionLabel}`} uirevision="ica-3d" />
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-card p-4 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">View:</span>
            <Button variant={viewMode === 'baseline' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('baseline')}>Cycle 2 baseline</Button>
            <Button variant={viewMode === 'range' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('range')}>Range (intensity)</Button>
          </div>
          <PeakAnalysisPlot traces={traces2d} xLabel="Voltage (V)" yLabel="Incremental Capacity (Ah/V)" title={title2d} uirevision="ica-2d" />
          <div className="flex items-center gap-3 pt-1 shrink-0">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Cycle:</span>
            <Slider value={[cycleIndex]} onValueChange={([v]) => { setCycleIndex(v); setCycleInput(String(cycles[v])); }} min={0} max={Math.max(0, cycles.length - 1)} step={1} className="flex-1" />
            <input type="text" inputMode="numeric" value={cycleInput} onChange={(e) => setCycleInput(e.target.value)} onBlur={commitCycleInput} onKeyDown={(e) => e.key === 'Enter' && commitCycleInput()} className="w-14 rounded border border-input bg-background px-2 py-1 text-xs font-medium tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default IcaDashboard;
