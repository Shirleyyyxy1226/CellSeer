/** Small presentational pieces shared by the metric-driven overview views. */
import type { ReactNode } from 'react';
import { CircleSlash, Lock } from 'lucide-react';
import type { MetricDef } from './metrics';
import { type CondStat, formatMagnitude } from './conditions';
import { useActiveRamp } from './RampContext';

/**
 * Compact, plain-language stat card for a condition cohort — shown on hovering
 * the average in the heatmap / ranking views. Deliberately jargon-free: just
 * Average, ± range (CI half-width as a magnitude), and the cell count.
 */
export function CondStatCard({ stat, metric }: { stat: CondStat; metric: MetricDef }) {
  if (stat.mean == null) return <span>No data for this metric.</span>;
  const unit = metric.unit ? ` ${metric.unit}` : '';
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <span className="text-muted-foreground">Average</span>
      <span className="font-medium tabular-nums">{metric.format(stat.mean)}{unit}</span>
      {stat.ciHalf != null && (
        <>
          <span className="text-muted-foreground">± range</span>
          <span className="font-medium tabular-nums">{formatMagnitude(metric, stat.ciHalf)}{unit}</span>
        </>
      )}
      <span className="text-muted-foreground">Cells</span>
      <span className="font-medium tabular-nums">{stat.n}</span>
    </div>
  );
}

/**
 * Compact metric legend that ties tile colour to value, adapting to the metric
 * type so the colour is never misleading:
 *
 *  - **Sequential** metrics (higher- or lower-is-better) render the active ramp
 *    left→right with the worse / better end values; green is always the good end.
 *  - **On-target / diverging** metrics (`metric.target` set, e.g. CE→100%) mirror
 *    the ramp so the good (green) end sits in the CENTRE, with the target marked
 *    and the value range on each side — so too-low and too-high both read as bad.
 *
 * `domain` is the colour (score-space) domain — only used to gate "no data".
 * `valueDomain` is the raw value range, used for the human-readable end labels.
 * Pass `showMissing` for the coloured views that render a neutral null tile.
 */
export function RampLegend({
  metric,
  domain,
  valueDomain,
  showMissing = false,
}: {
  metric: MetricDef;
  domain: { min: number; max: number } | null;
  valueDomain?: { min: number; max: number } | null;
  showMissing?: boolean;
}) {
  const ramp = useActiveRamp();
  if (!domain) return null;

  const unit = metric.unit ? ` ${metric.unit}` : '';
  const vd = valueDomain ?? domain;
  const isDiverging = metric.target != null;

  // Gradient: sequential = ramp as-is (start = bad, end = good); diverging =
  // ramp mirrored so the good end lands in the centre (bad ◀ good ▶ bad).
  const gradientStops = isDiverging
    ? [...ramp, ...ramp.slice(0, -1).reverse()]
    : ramp;

  // End / centre labels. Sequential is oriented by direction (worse end first);
  // diverging shows the value reach on each side of the target.
  let leftLabel: string;
  let rightLabel: string;
  let centreLabel: string | null = null;
  if (isDiverging) {
    leftLabel = `${metric.format(vd.min)}${unit}`;
    rightLabel = `${metric.format(vd.max)}${unit}`;
    centreLabel = `${metric.format(metric.target as number)}${unit}`;
  } else if (metric.higherIsBetter) {
    leftLabel = `${metric.format(vd.min)}${unit}`; // low = worse
    rightLabel = `${metric.format(vd.max)}${unit}`; // high = better
  } else {
    leftLabel = `${metric.format(vd.max)}${unit}`; // high = worse
    rightLabel = `${metric.format(vd.min)}${unit}`; // low = better
  }

  return (
    <div className="flex items-center gap-3 text-[10px]">
      <div className="w-[200px] shrink-0">
        <div className="relative">
          <div
            className="h-2.5 w-full rounded-sm border border-border/60"
            style={{ background: `linear-gradient(to right, ${gradientStops.join(',')})` }}
          />
          {isDiverging && (
            <span className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-background/80" />
          )}
        </div>
        <div className="mt-0.5 flex justify-between font-medium tabular-nums text-foreground/80">
          <span>{leftLabel}</span>
          {centreLabel != null && <span aria-hidden>{centreLabel}</span>}
          <span>{rightLabel}</span>
        </div>
        {/* Direction cue. Diverging metrics are best at the (green) centre, so
            both ends are off-target — labelled by direction, never "better".
            Sequential metrics simply improve toward the green end. */}
        <div className="mt-px flex justify-between text-[8.5px] uppercase tracking-wide text-muted-foreground/70">
          {isDiverging ? (
            <>
              <span>below</span>
              <span aria-hidden>on&nbsp;target</span>
              <span>above</span>
            </>
          ) : (
            <>
              <span>worse</span>
              <span>better</span>
            </>
          )}
        </div>
      </div>
      {showMissing && (
        <span
          className="flex items-center gap-1 self-start text-muted-foreground"
          title="No value for the selected metric — distinct from a low score"
        >
          <span
            className="h-2.5 w-2.5 rounded-[2px] border border-border bg-muted"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, hsl(var(--muted-foreground)/0.35) 0 1.5px, transparent 1.5px 4px)',
            }}
          />
          no data
        </span>
      )}
    </div>
  );
}

export function MetricLockedNotice({
  metric,
  action,
}: {
  metric: MetricDef;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
      <Lock className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">{metric.label} needs a protocol</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Attach protocols to enable protocol-aware metrics.
      </p>
      {action}
    </div>
  );
}

/**
 * Shown for a protocol-requiring metric once a protocol is attached: the
 * segment-aware computation is not built yet, so the view is replaced by a
 * plain "coming soon" rather than a misleading full-series number.
 */
export function MetricComingSoonNotice() {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
    </div>
  );
}

/**
 * Mass-lock — the mirror of MetricLockedNotice for specific capacity: it can't
 * be computed until cells have a cathode mass. Framed as a fixable lock (like
 * "needs a protocol"), not a dead-end "no data".
 */
export function MetricMassNotice({
  metric,
  action,
}: {
  metric: MetricDef;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
      <Lock className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">{metric.label} needs cathode mass</p>
      <p className="max-w-md text-xs text-muted-foreground">
        Set the cathode mass on cells to enable specific-capacity metrics.
      </p>
      {action}
    </div>
  );
}

/**
 * Shown when the selected metric has no computable value for any cell in the
 * project (e.g. a dQ/dV-derived metric with no differential data). Distinct
 * from the protocol / mass locks: the data simply isn't there, so the view
 * greys out with the reason rather than rendering an empty chart.
 */
export function MetricUnavailableNotice({ metric }: { metric: MetricDef }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
      <CircleSlash className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">No {metric.label.toLowerCase()} data in this project</p>
      <p className="max-w-md text-xs text-muted-foreground">
        No cell has a computable {metric.label.toLowerCase()} value — pick another metric.
      </p>
    </div>
  );
}
