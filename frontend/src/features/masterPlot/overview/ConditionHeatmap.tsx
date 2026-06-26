/**
 * Condition heatmap — the default "project at a glance" view. One row per
 * cathode × separator × spacer condition; tiles are replicate cells coloured
 * by the selected metric (in score space), with cohort mean ± CV chips,
 * cathode group headers and best / most-scattered highlights.
 */
import { useMemo, useState } from 'react';
import { Pin } from 'lucide-react';
import type { MetricDef } from './metrics';
import { metricScore } from './metrics';
import {
  type CondRow,
  type HeatmapSort,
  EMPTY_COND_STAT,
  computeCondStats,
  condLabel,
} from './conditions';
import { MISSING_TILE_BG, MISSING_TILE_FG, rampColourFrom, rampTextFrom } from './colours';
import { cathodeColor } from '@/lib/cellColorScheme';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useActiveRamp } from './RampContext';
import { CondStatCard, RampLegend } from './shared';

/** Max replicate tiles shown per row before collapsing to "+N more". */
const MAX_TILES_PER_ROW = 80;

export default function ConditionHeatmap({
  conditions,
  metric,
  domain,
  valueDomain,
  inspectedId,
  onInspect,
  onCathodeFilter,
  pinnedKeys,
  onTogglePin,
}: {
  conditions: CondRow[];
  metric: MetricDef;
  domain: { min: number; max: number } | null;
  valueDomain?: { min: number; max: number } | null;
  inspectedId: string | null;
  onInspect: (id: string) => void;
  onCathodeFilter?: (v: string) => void;
  pinnedKeys?: Set<string>;
  onTogglePin?: (key: string) => void;
}) {
  const ramp = useActiveRamp();
  const [sortMode, setSortMode] = useState<HeatmapSort>('condition');
  // Cap replicate tiles per row so a huge cohort doesn't put thousands of DOM
  // nodes on screen (one tile = one cell); the rest collapse to "+N more".
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const stats = useMemo(() => computeCondStats(conditions, metric), [conditions, metric]);

  const sortedConditions = useMemo(() => {
    if (sortMode === 'condition') return conditions;
    const arr = [...conditions];
    if (sortMode === 'best') {
      arr.sort((a, b) => {
        const ma = stats.get(a.key)?.mean;
        const mb = stats.get(b.key)?.mean;
        if (ma == null && mb == null) return 0;
        if (ma == null) return 1;
        if (mb == null) return -1;
        return metric.higherIsBetter ? mb - ma : ma - mb;
      });
    } else {
      arr.sort((a, b) => (stats.get(b.key)?.cv ?? -1) - (stats.get(a.key)?.cv ?? -1));
    }
    return arr;
  }, [conditions, sortMode, stats, metric]);

  const highlights = useMemo(() => {
    let best: CondRow | null = null;
    let bestMean: number | null = null;
    let variable: CondRow | null = null;
    let maxCv: number | null = null;
    for (const cond of conditions) {
      const s = stats.get(cond.key);
      if (!s) continue;
      if (s.mean != null && s.n >= 2) {
        if (bestMean == null || metricScore(metric, s.mean) > metricScore(metric, bestMean)) {
          bestMean = s.mean;
          best = cond;
        }
      }
      if (s.cv != null && (maxCv == null || s.cv > maxCv)) {
        maxCv = s.cv;
        variable = cond;
      }
    }
    return { best, bestMean, variable, maxCv };
  }, [conditions, stats, metric]);

  if (!conditions.length) {
    return <p className="p-6 text-sm text-muted-foreground">No cells match the current filters.</p>;
  }
  /** Domain is in score space — raw values go through metricScore before normalising. */
  const norm = (v: number) => {
    const s = metricScore(metric, v);
    return domain && domain.max > domain.min
      ? Math.min(1, Math.max(0, (s - domain.min) / (domain.max - domain.min)))
      : 0.5;
  };

  const showGroupHeaders = sortMode === 'condition';
  let lastCathode: string | null = null;

  return (
    <div>
      {/* The view tab already names this view, so the redundant sub-title is
          dropped — the sort control sits flush-left and the legend flush-right
          to reclaim the vertical band. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex overflow-hidden rounded-md border border-input shadow-sm" role="tablist" aria-label="Sort conditions">
          {(
            [
              ['condition', 'By condition'],
              ['best', 'Best first'],
              ['variable', 'Most variable'],
            ] as [HeatmapSort, string][]
          ).map(([key, label], i) => (
            <button
              key={key}
              role="tab"
              aria-selected={sortMode === key}
              onClick={() => setSortMode(key)}
              className={`px-2 py-1 text-[10px] font-medium transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                sortMode === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <RampLegend metric={metric} domain={domain} valueDomain={valueDomain} showMissing />
      </div>

      {(highlights.best || highlights.variable) && (
        <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {highlights.best && highlights.bestMean != null && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Best
              </div>
              <div className="mt-0.5 text-xs font-medium text-foreground">
                {condLabel(highlights.best)}
              </div>
              {(() => {
                const bs = stats.get(highlights.best!.key);
                return (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {highlights.bestMean != null && `mean ${metric.format(highlights.bestMean)}`}
                    {bs?.sd != null && ` · SD ±${metric.format(bs.sd)}`}
                    {bs?.n != null && ` · n=${bs.n}`}
                  </div>
                );
              })()}
            </div>
          )}
          {highlights.variable && highlights.maxCv != null && (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Most scattered
              </div>
              <div className="mt-0.5 text-xs font-medium text-foreground">
                {condLabel(highlights.variable)}
              </div>
              {(() => {
                const vs = stats.get(highlights.variable!.key);
                return vs?.sd != null && vs.mean != null ? (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    SD ±{metric.format(vs.sd)} · CV {highlights.maxCv.toFixed(1)}%
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>
      )}

      <TooltipProvider delayDuration={150}>
      <div className="space-y-1">
        {sortedConditions.map((cond) => {
          const stat = stats.get(cond.key) ?? EMPTY_COND_STAT;
          const groupHeader =
            showGroupHeaders && cond.cathode !== lastCathode ? (
              <div className="mt-2 flex items-center gap-1.5 first:mt-0" key={`hdr-${cond.cathode}`}>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cathodeColor(cond.cathode) }}
                />
                {onCathodeFilter ? (
                  <button
                    type="button"
                    className="text-[11px] font-semibold hover:underline"
                    title={`Filter to ${cond.cathode}`}
                    onClick={() => onCathodeFilter(cond.cathode)}
                  >
                    {cond.cathode}
                  </button>
                ) : (
                  <span className="text-[11px] font-semibold">{cond.cathode}</span>
                )}
                <div className="h-px flex-1 bg-border" />
              </div>
            ) : null;
          lastCathode = cond.cathode;
          const pinned = pinnedKeys?.has(cond.key) ?? false;
          return (
            <div key={cond.key}>
              {groupHeader}
              <div className="flex items-start gap-2">
                {/* Label column: wider gutter so labels aren't truncated. Line 1
                    is the chemistry name in medium weight at full width; line 2
                    is the separator/spacer + replicate/stat caption one step
                    smaller and lighter, with the n badge right-aligned. The
                    least-significant token (spacer) truncates first; a hover
                    tooltip always carries the full condition string. */}
                <div className="flex w-80 shrink-0 items-start gap-1.5 pt-0.5 text-xs">
                  {onTogglePin && (
                    <button
                      type="button"
                      onClick={() => onTogglePin(cond.key)}
                      className={`mt-0.5 shrink-0 ${pinned ? 'text-amber-600' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                      title={pinned ? 'Unpin condition' : 'Pin condition for comparison'}
                      aria-label={pinned ? 'Unpin condition' : 'Pin condition'}
                      aria-pressed={pinned}
                    >
                      <Pin className={`h-3 w-3 ${pinned ? 'fill-amber-600' : ''}`} />
                    </button>
                  )}
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: cathodeColor(cond.cathode) }}
                  />
                  <div className="min-w-0 flex-1">
                    {/* Line 1 — chemistry name, full width, medium weight. */}
                    <div
                      className="font-medium leading-snug text-foreground"
                      title={condLabel(cond)}
                    >
                      {cond.cathode}
                    </div>
                    {/* Line 2 — separator · spacer caption + cell count. The
                        stats jargon (±CI / CV) lives in the hover card on the
                        average badge; here we keep only the plain cell count and
                        a caution icon when the cohort is unreliable. */}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-tight text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate" title={condLabel(cond)}>
                        {cond.separatorType} · {cond.spacerMm ?? '—'} mm
                      </span>
                      {stat.mean != null ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="tabular-nums">
                            {stat.n} cell{stat.n === 1 ? '' : 's'}
                          </span>
                        </span>
                      ) : (
                        <span className="shrink-0">no data</span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Fixed numeric gutter: the cohort average pill, right-aligned.
                    Hover shows a plain-language stat card. */}
                <div className="flex w-16 shrink-0 items-center justify-end pt-0.5">
                  {stat.mean != null ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="cursor-default rounded px-1.5 py-0.5 text-right tabular-nums"
                          style={{
                            backgroundColor: rampColourFrom(ramp, norm(stat.mean)),
                            color: rampTextFrom(ramp, norm(stat.mean)),
                          }}
                        >
                          <span className="block text-[11px] font-semibold leading-tight">
                            {metric.format(stat.mean)}
                          </span>
                          {stat.sd != null && (
                            <span className="block text-[9px] font-normal leading-tight opacity-75">
                              ±{metric.format(stat.sd)}
                            </span>
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <CondStatCard stat={stat} metric={metric} />
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">—</span>
                  )}
                </div>
                <div className="flex flex-1 flex-wrap gap-0.5 pt-0.5">
                  {(() => {
                    const expanded = expandedRows.has(cond.key);
                    const overCap = cond.cells.length > MAX_TILES_PER_ROW && !expanded;
                    const shown = overCap ? cond.cells.slice(0, MAX_TILES_PER_ROW) : cond.cells;
                    const hidden = cond.cells.length - shown.length;
                    return (
                      <>
                        {shown.map((cell) => {
                          const v = metric.value(cell);
                          const isInspected = cell.cellId === inspectedId;
                          const t = v != null ? norm(v) : 0;
                          return (
                            <button
                              key={cell.cellId}
                              onClick={() => onInspect(cell.cellId)}
                              title={`${cell.cellName}\n${metric.label}: ${v != null ? `${metric.format(v)} ${metric.unit}` : 'no data'}`}
                              aria-label={`Inspect cell ${cell.cellName}`}
                              className={`group relative flex h-7 w-9 items-center justify-center rounded-[3px] text-[9px] font-medium leading-none transition-[transform,opacity] hover:scale-110 ${
                                isInspected ? 'ring-2 ring-foreground ring-offset-1' : ''
                              }`}
                              style={
                                v != null
                                  ? { backgroundColor: rampColourFrom(ramp, t), color: rampTextFrom(ramp, t) }
                                  : {
                                      backgroundColor: MISSING_TILE_BG,
                                      color: MISSING_TILE_FG,
                                      backgroundImage:
                                        'repeating-linear-gradient(45deg, hsl(var(--muted-foreground)/0.18) 0 1.5px, transparent 1.5px 5px)',
                                    }
                              }
                            >
                              {/* Always show the metric value on every tile;
                                  missing tiles show a dash. */}
                              <span>
                                {v != null ? metric.format(v) : '—'}
                              </span>
                            </button>
                          );
                        })}
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRows((prev) => {
                                const next = new Set(prev);
                                next.add(cond.key);
                                return next;
                              })
                            }
                            className="h-7 rounded-[3px] border border-dashed border-muted-foreground/40 px-1.5 text-[9px] font-medium text-muted-foreground hover:bg-muted"
                            title={`Show ${hidden} more replicate${hidden === 1 ? '' : 's'}`}
                          >
                            +{hidden}
                          </button>
                        )}
                        {expanded && cond.cells.length > MAX_TILES_PER_ROW && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRows((prev) => {
                                const next = new Set(prev);
                                next.delete(cond.key);
                                return next;
                              })
                            }
                            className="h-7 rounded-[3px] border border-dashed border-muted-foreground/40 px-1.5 text-[9px] font-medium text-muted-foreground hover:bg-muted"
                            title="Collapse"
                          >
                            −
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </TooltipProvider>
    </div>
  );
}
