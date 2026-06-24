/**
 * Trajectories — small-multiples grid of capacity-vs-cycle curves, one panel
 * per condition. Each replicate is a faint clickable line;
 * the bold line is the cohort-mean trajectory. A header toggle switches the Y
 * axis between absolute capacity (basis-aware) and own-peak retention %.
 *
 * Panels are sorted best-first by the active metric's cohort mean, coloured by
 * cathode, and the grid scrolls when there are many conditions. Each line is
 * downsampled (see trajectories.ts) so the DOM stays bounded for ~5,000 cells.
 */
import { useMemo, useState } from 'react';
import type { CellSummary, MetricDef } from './metrics';
import type { CondRow } from './conditions';
import { cathodeColor } from '@/lib/cellColorScheme';
import { useBrushDim } from './useBrushDim';
import {
  type TrajPanel,
  type TrajPoint,
  type TrajYMode,
  buildTrajData,
} from './trajectoryData';

const PANEL_W = 220;
const PANEL_H = 120;
const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 4;
const PAD_B = 4;

function pathOf(
  points: TrajPoint[],
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): string {
  const x = (v: number) =>
    PAD_L + ((v - xMin) / Math.max(1e-9, xMax - xMin)) * (PANEL_W - PAD_L - PAD_R);
  const y = (v: number) =>
    PANEL_H - PAD_B - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * (PANEL_H - PAD_T - PAD_B);
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.cycle).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
}

function Panel({
  panel,
  colour,
  yUnit,
  passes,
  onInspect,
  onApplyCondition,
}: {
  panel: TrajPanel;
  colour: string;
  yUnit: string;
  passes: (idNo: number) => boolean;
  onInspect?: (id: string) => void;
  onApplyCondition?: (cond: CondRow) => void;
}) {
  const { xMin, xMax, yMin, yMax } = panel;
  const hasData = panel.lines.length > 0;
  return (
    <div className="rounded-md border bg-card p-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />
        {onApplyCondition ? (
          <button
            type="button"
            className="min-w-0 truncate text-left text-xs font-medium hover:underline"
            title={`${panel.label} — click to filter all views to this condition`}
            onClick={() => onApplyCondition(panel.cond)}
          >
            {panel.label}
          </button>
        ) : (
          <span className="min-w-0 truncate text-xs font-medium" title={panel.label}>
            {panel.label}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          ×{panel.replicateCount}
        </span>
      </div>
      {hasData ? (
        <svg
          viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
          className="block w-full"
          role="img"
          aria-label={`Capacity trajectories for ${panel.label}`}
        >
          {panel.lines.map((line) => (
            <path
              key={line.cellId}
              d={pathOf(line.points, xMin, xMax, yMin, yMax)}
              fill="none"
              stroke={colour}
              strokeWidth={1}
              strokeOpacity={passes(line.idNo) ? 0.28 : 0.05}
              className="cursor-pointer transition-[stroke-opacity,stroke-width] hover:[stroke-opacity:1] hover:stroke-[2px]"
              onClick={() => onInspect?.(line.cellId)}
            >
              <title>{`${line.cellName} — click to inspect`}</title>
            </path>
          ))}
          {panel.meanLine.length >= 2 && (
            <path
              d={pathOf(panel.meanLine, xMin, xMax, yMin, yMax)}
              fill="none"
              stroke={colour}
              strokeWidth={2.25}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}
        </svg>
      ) : (
        <div
          className="flex items-center justify-center text-[10px] text-muted-foreground"
          style={{ height: PANEL_H }}
        >
          No plottable cycles
        </div>
      )}
      <div className="mt-1 flex items-center justify-between text-[9px] text-muted-foreground tabular-nums">
        <span>
          {Math.round(panel.yMin)}–{Math.round(panel.yMax)} {yUnit}
        </span>
        <span>
          {Math.round(panel.xMin)}–{Math.round(panel.xMax)} cyc
        </span>
      </div>
    </div>
  );
}

export default function Trajectories({
  cells,
  metric,
  onInspect,
  onApplyCondition,
}: {
  cells: CellSummary[];
  metric: MetricDef;
  onInspect?: (id: string) => void;
  onApplyCondition?: (cond: CondRow) => void;
}) {
  // Default to retention: own-peak normalisation makes cohorts of different
  // chemistries / capacity scales directly comparable across panels.
  const [yMode, setYMode] = useState<TrajYMode>('retention');
  const brush = useBrushDim();

  const data = useMemo(() => buildTrajData(cells, metric, yMode), [cells, metric, yMode]);

  if (!cells.length) {
    return <p className="p-6 text-sm text-muted-foreground">No cells match the current filters.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">
          Capacity trajectories
          <span className="ml-2 text-xs font-normal text-muted-foreground">bold = mean</span>
        </p>
        <div className="flex items-center gap-1 rounded-md border bg-muted/40 p-0.5 text-[11px]">
          {(
            [
              ['retention', 'Retention (%)'],
              ['absolute', `Capacity (${data.basis})`],
            ] as [TrajYMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={`rounded px-2 py-1 font-medium transition-colors ${
                yMode === mode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={yMode === mode}
              onClick={() => setYMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
          {data.panels.map((panel) => (
            <Panel
              key={panel.cond.key}
              panel={panel}
              colour={cathodeColor(panel.cond.cathode)}
              yUnit={data.yUnit}
              passes={brush.passes}
              onInspect={onInspect}
              onApplyCondition={onApplyCondition}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
