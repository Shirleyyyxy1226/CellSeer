import { useMemo, useState, useCallback, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { useIcaDvqData } from './useIcaDvqData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { Surface3dPlot } from './plots/Surface3dPlot';
import { PeakAnalysisPlot } from './plots/PeakAnalysisPlot';
import { buildIcaFigure, type Dataset } from '@/cellviz-lib';

type ViewMode = 'baseline' | 'range';

interface Props {
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
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

  const cycles = useMemo(() => data?.cycles ?? [], [data?.cycles]);
  const closestCycleIndex = useCallback((num: number): number => {
    if (cycles.length === 0) return 0;
    let best = 0;
    let bestDiff = Math.abs(cycles[0] - num);
    for (let i = 1; i < cycles.length; i++) {
      const d = Math.abs(cycles[i] - num);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
  }, [cycles]);
  const [cycleIndex, setCycleIndex] = useState(Math.max(0, cycles.length - 1));
  const [viewMode, setViewMode] = useState<ViewMode>('baseline');
  const [cycleInput, setCycleInput] = useState(() => String(cycles[cycles.length - 1] ?? 0));
  const [baselineCycleInput, setBaselineCycleInput] = useState('2');
  const selectedCycle = cycles[cycleIndex] ?? 0;
  const baselineCycleExact = useMemo(() => {
    if (baselineCycleInput.trim() === '') return undefined;
    const parsed = Number.parseInt(baselineCycleInput, 10);
    if (Number.isNaN(parsed)) return undefined;
    return cycles.includes(parsed) ? parsed : undefined;
  }, [baselineCycleInput, cycles]);

  useEffect(() => {
    const lastIdx = Math.max(0, cycles.length - 1);
    setCycleIndex((prev) => Math.min(prev, lastIdx));
    setCycleInput(String(cycles[lastIdx] ?? 0));
  }, [cycles]);

  useEffect(() => setCycleInput(String(selectedCycle)), [selectedCycle]);

  const commitCycleInput = useCallback(() => {
    if (cycles.length === 0) return;
    const num = parseInt(cycleInput, 10);
    if (Number.isNaN(num)) { setCycleInput(String(selectedCycle)); return; }
    const best = closestCycleIndex(num);
    setCycleIndex(best);
    setCycleInput(String(cycles[best]));
  }, [cycleInput, selectedCycle, cycles, closestCycleIndex]);

  const commitBaselineCycleInput = useCallback(() => {
    const next = baselineCycleInput.trim();
    if (next === '') {
      setBaselineCycleInput('');
      return;
    }
    const parsed = Number.parseInt(next, 10);
    if (Number.isNaN(parsed)) {
      setBaselineCycleInput('');
      return;
    }
    setBaselineCycleInput(String(parsed));
  }, [baselineCycleInput]);

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

  const hierCols = useMemo(() => activeAnalysis?.hierCols ?? [], [activeAnalysis?.hierCols]);

  const datasets = useMemo<Dataset[]>(() => {
    if (!data?.cellData?.length) return [];
    return data.cellData
      .filter((cd) => filteredCellIds.has(cd.cell.id))
      .map((cd) => {
        const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
        const color = cellMatch
          ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap)
          : cd.cell.color;
        return {
          id: cd.cell.id,
          label: cd.cell.name,
          color,
          cycles: cd.cycleTraces.map((ct) => ({
            cycle: ct.cycle,
            x: data.voltages,
            y: ct.dqdv,
          })),
        };
      });
  }, [data, filteredCellIds, cells, treeFilterPath, hierCols, pathToColorMap]);

  const { data: traces3d, layout: layout3D } = useMemo(
    () => buildIcaFigure(datasets, { mode: '3d' }),
    [datasets]
  );
  const { data: traces2d, layout: layout2D } = useMemo(
    () => buildIcaFigure(datasets, {
      mode: '2d',
      viewMode,
      cycleIndex,
      selectedCycle,
      baselineCycle: baselineCycleExact,
    }),
    [datasets, viewMode, cycleIndex, selectedCycle, baselineCycleExact]
  );

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
          <Surface3dPlot traces={traces3d} xValues={data?.voltages ?? []} xLabel="Voltage (V)" zLabel="dQ/dV (Ah/V)" title={`Incremental Capacity Analysis (ICA) — ${directionLabel}`} uirevision="ica-3d" layoutOverride={layout3D} />
        </div>
        <div className="min-w-0 rounded-lg border border-border bg-card p-4 flex flex-col gap-2 overflow-hidden">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">View:</span>
            <Button variant={viewMode === 'baseline' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('baseline')}>Baseline cycle</Button>
            <Button variant={viewMode === 'range' ? 'default' : 'outline'} size="sm" onClick={() => setViewMode('range')}>Range (intensity)</Button>
            {viewMode === 'baseline' && (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Baseline:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={baselineCycleInput}
                  onChange={(e) => setBaselineCycleInput(e.target.value)}
                  onBlur={commitBaselineCycleInput}
                  onKeyDown={(e) => e.key === 'Enter' && commitBaselineCycleInput()}
                  className="w-14 rounded border border-input bg-background px-2 py-1 text-xs font-medium tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                />
              </div>
            )}
          </div>
          <PeakAnalysisPlot traces={traces2d} xLabel="Voltage (V)" yLabel="Incremental Capacity (Ah/V)" title={title2d} uirevision="ica-2d" layoutOverride={layout2D} />
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
