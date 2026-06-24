/**
 * Condition ranking — ranked bar/strip plot answering "which condition is
 * winning, and can I trust it?". Bar = cohort mean, whisker = ±1 SD, dots =
 * individual cells (clickable → Inspector). Sorted by metric score, so CE
 * ranks by closeness to 100%.
 */
import { useMemo } from 'react';
import { Pin } from 'lucide-react';
import type { MetricDef } from './metrics';
import { metricScore } from './metrics';
import {
  type CondRow,
  EMPTY_COND_STAT,
  computeCondStats,
  condLabel,
  dotJitter,
} from './conditions';
import { cathodeColor } from '@/lib/cellColorScheme';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CondStatCard } from './shared';
import { useBrushDim } from './useBrushDim';

export default function ConditionRanking({
  conditions,
  metric,
  onInspect,
  onApplyCondition,
  pinnedKeys,
  onTogglePin,
}: {
  conditions: CondRow[];
  metric: MetricDef;
  onInspect?: (id: string) => void;
  onApplyCondition?: (cond: CondRow) => void;
  pinnedKeys?: Set<string>;
  onTogglePin?: (key: string) => void;
}) {
  const brush = useBrushDim();
  const stats = useMemo(() => computeCondStats(conditions, metric), [conditions, metric]);

  const rows = useMemo(() => {
    const arr = conditions.map((cond) => ({
      cond,
      stat: stats.get(cond.key) ?? EMPTY_COND_STAT,
    }));
    arr.sort((a, b) => {
      if (a.stat.mean == null && b.stat.mean == null) return 0;
      if (a.stat.mean == null) return 1;
      if (b.stat.mean == null) return -1;
      return metricScore(metric, b.stat.mean) - metricScore(metric, a.stat.mean);
    });
    return arr;
  }, [conditions, stats, metric]);

  // One shared 0-based scale so bar lengths are comparable; sized to fit every
  // replicate dot and whisker end, not just the means.
  const maxV = useMemo(() => {
    let m = 0;
    for (const { cond, stat } of rows) {
      for (const c of cond.cells) {
        const v = metric.value(c);
        if (v != null && Number.isFinite(v) && v > m) m = v;
      }
      if (stat.mean != null) m = Math.max(m, stat.mean + (stat.sd ?? 0));
    }
    return m > 0 ? m : 1;
  }, [rows, metric]);

  if (!conditions.length) {
    return <p className="p-6 text-sm text-muted-foreground">No cells match the current filters.</p>;
  }

  const pct = (v: number) => Math.min(100, Math.max(0, (v / maxV) * 100));

  return (
    <div>
      {/* The view tab already names this view; the redundant sub-title is
          dropped and the marks legend keeps the header row useful. */}
      <div className="mb-3 flex flex-wrap items-center justify-end gap-3">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-4 rounded-sm bg-foreground/25 dark:bg-foreground/30" /> 95% CI (mean)
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-[2px] w-4 rounded-full bg-foreground/55" /> ±1 SD (cells)
          </span>
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
      <div className="space-y-1.5">
        {rows.map(({ cond, stat }, i) => {
          const colour = cathodeColor(cond.cathode);
          return (
            <div key={cond.key} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
                {stat.mean != null ? i + 1 : ''}
              </span>
              <div className="flex w-56 shrink-0 items-center gap-1.5 text-xs">
                {onTogglePin && (
                  <button
                    type="button"
                    onClick={() => onTogglePin(cond.key)}
                    className={`shrink-0 ${pinnedKeys?.has(cond.key) ? 'text-amber-600' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                    title={pinnedKeys?.has(cond.key) ? 'Unpin condition' : 'Pin condition for comparison'}
                    aria-label={pinnedKeys?.has(cond.key) ? 'Unpin condition' : 'Pin condition'}
                    aria-pressed={pinnedKeys?.has(cond.key) ?? false}
                  >
                    <Pin className={`h-3 w-3 ${pinnedKeys?.has(cond.key) ? 'fill-amber-600' : ''}`} />
                  </button>
                )}
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colour }}
                />
                {onApplyCondition ? (
                  <button
                    type="button"
                    className="truncate text-left hover:underline"
                    title={`${condLabel(cond)} — click to filter all views to this condition`}
                    onClick={() => onApplyCondition(cond)}
                  >
                    {condLabel(cond)}
                  </button>
                ) : (
                  <span className="truncate" title={condLabel(cond)}>
                    {condLabel(cond)}
                  </span>
                )}
                <span className="ml-auto pr-1 text-[10px] text-muted-foreground">
                  ×{cond.cells.length}
                </span>
              </div>
              <div className="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-muted/40">
                {/* Chemistry identity reads as a thin 3px left rule only, not a
                    full-width colour wash — so the coloured dots and the grey
                    CI/SD summary own the data layer instead of fighting a band. */}
                <div
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ backgroundColor: colour }}
                />
                {stat.mean != null && (
                  <>
                    {/* Neutral mean-extent tint (very low-contrast grey) just to
                        ground the bar length — no chemistry hue, so it never
                        carries false semantic weight. */}
                    <div
                      className="absolute inset-y-0 left-0 rounded-r-sm bg-foreground/[0.04]"
                      style={{ width: `${pct(stat.mean)}%` }}
                    />
                    {/* 95% CI on the mean — uncertainty of the mean. Strong neutral
                        so the summary reads as the primary mark on the row. */}
                    {stat.ciHalf != null && (
                      <div
                        className="absolute inset-y-1 rounded-sm bg-foreground/25 dark:bg-foreground/30"
                        style={{
                          left: `${pct(stat.mean - stat.ciHalf)}%`,
                          width: `${Math.max(0.5, pct(stat.mean + stat.ciHalf) - pct(stat.mean - stat.ciHalf))}%`,
                        }}
                        title={`95% CI of the mean: ±${metric.format(stat.ciHalf)} (n=${stat.n})`}
                      />
                    )}
                    {/* ±1 SD — spread of the observed cells (thin strong line). */}
                    {stat.sd != null && (
                      <div
                        className="absolute top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-foreground/55"
                        style={{
                          left: `${pct(stat.mean - stat.sd)}%`,
                          width: `${Math.max(0.5, pct(stat.mean + stat.sd) - pct(stat.mean - stat.sd))}%`,
                        }}
                        title={`±1 SD of replicates: ${metric.format(stat.sd)}`}
                      />
                    )}
                    {/* Mean marker — strong near-black tick. */}
                    <div
                      className="absolute inset-y-0.5 w-[3px] rounded-full bg-foreground"
                      style={{ left: `calc(${pct(stat.mean)}% - 1.5px)` }}
                    />
                  </>
                )}
                {cond.cells.map((c) => {
                  const v = metric.value(c);
                  if (v == null || !Number.isFinite(v)) return null;
                  return (
                    <button
                      key={c.cellId}
                      type="button"
                      className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background transition-[transform,opacity] hover:scale-150 focus-visible:scale-150"
                      style={{
                        left: `${pct(v)}%`,
                        top: `calc(50% + ${(dotJitter(c.idNo) * 12).toFixed(1)}px)`,
                        backgroundColor: colour,
                        opacity: brush.passes(c.idNo) ? 0.85 : 0.1,
                      }}
                      title={`${c.cellName}: ${metric.format(v)} ${metric.unit} — click to inspect`}
                      aria-label={`Inspect cell ${c.cellName}`}
                      onClick={() => onInspect?.(c.cellId)}
                    />
                  );
                })}
              </div>
              {/* Primary value in its own fixed, right-aligned column; the plain
                  cell count (with a caution when the cohort is shaky) sits
                  beneath, and the ± detail lives in the hover card. */}
              <div className="w-24 shrink-0 text-right text-xs">
                {stat.mean != null ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-default font-semibold leading-tight tabular-nums">
                          {metric.format(stat.mean)}
                          {metric.unit && (
                            <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{metric.unit}</span>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <CondStatCard stat={stat} metric={metric} />
                      </TooltipContent>
                    </Tooltip>
                    <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-tight text-muted-foreground">
                      <span className="tabular-nums">
                        {stat.n} cell{stat.n === 1 ? '' : 's'}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">no data</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      </TooltipProvider>
    </div>
  );
}
