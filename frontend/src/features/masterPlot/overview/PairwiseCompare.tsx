/**
 * Pairwise significance panel. Shown when ≥2 conditions are pinned
 * and "Compare pinned" is active: for the active metric it runs Welch's t-tests
 * across every pinned pair, BH-corrects, and reports whether each pair is
 * statistically distinguishable — so a ranking isn't mistaken for a real
 * difference when it's within noise.
 */
import { useMemo } from 'react';
import type { CondRow } from './conditions';
import { condLabel, pairwiseSignificance } from './conditions';
import type { MetricDef } from './metrics';
import { cathodeColor } from '@/lib/cellColorScheme';

function fmtP(p: number | null): string {
  if (p == null) return 'n/a';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
}

export function PairwiseCompare({
  conditions,
  metric,
}: {
  /** The pinned conditions being compared (already narrowed by the orchestrator). */
  conditions: CondRow[];
  metric: MetricDef;
}) {
  const verdicts = useMemo(() => pairwiseSignificance(conditions, metric), [conditions, metric]);
  const byKey = useMemo(() => new Map(conditions.map((c) => [c.key, c])), [conditions]);

  if (conditions.length < 2) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        Pin at least two conditions to compare them statistically.
      </p>
    );
  }

  const anyTestable = verdicts.some((v) => v.p != null);

  return (
    <div className="mx-4 mb-3 rounded-md border bg-card p-3">
      <p className="mb-2 text-sm font-medium">
        Pairwise significance
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {metric.label.toLowerCase()} · Welch&apos;s t, Benjamini–Hochberg corrected · p&lt;0.05 = distinguishable
        </span>
      </p>
      {!anyTestable ? (
        <p className="text-xs text-muted-foreground">
          Not enough replicates (need n≥2 per condition) to test these pairs.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {verdicts.map((v) => {
            const a = byKey.get(v.aKey);
            const b = byKey.get(v.bKey);
            if (!a || !b) return null;
            return (
              <div
                key={`${v.aKey}__${v.bKey}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded px-2 py-1 text-xs odd:bg-muted/30"
              >
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: cathodeColor(a.cathode) }}
                  />
                  {condLabel(a)}
                </span>
                <span className="text-muted-foreground">vs</span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: cathodeColor(b.cathode) }}
                  />
                  {condLabel(b)}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">p={fmtP(v.p)}</span>
                {v.p == null ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    n too small
                  </span>
                ) : v.significant ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    distinguishable
                  </span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    within noise
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
