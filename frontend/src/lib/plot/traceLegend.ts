/**
 * traceLegend — derive a discrete legend (for <ChartLegend>) from a Plotly trace
 * array. Used by charts whose traces are built in the dashboard (GCD) or emitted
 * by the plot component (rate performance, voltage-vs-time).
 *
 * Mirrors Plotly's own legend semantics: traces flagged `showlegend: false`
 * (range-band fills, secondary per-cycle lines, peak markers, …) are skipped, so
 * multi-trace charts collapse to one entry per visible series automatically.
 */

import type { LegendItem } from '@/components/ChartLegend';
import type { LineDash, MarkerSymbol } from '@/charts';

interface MinimalTrace {
  name?: string;
  mode?: string;
  showlegend?: boolean;
  line?: { color?: string; dash?: string };
  marker?: { color?: string; symbol?: string };
  fillcolor?: string;
}

export function tracesToLegendItems(traces: readonly unknown[]): LegendItem[] {
  const out: LegendItem[] = [];
  const seen = new Set<string>();
  for (const raw of traces) {
    const t = raw as MinimalTrace;
    if (t.showlegend === false) continue; // mirror Plotly; de-dups multi-trace charts
    const label = (t.name ?? '').trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    const mode = t.mode ?? '';
    out.push({
      label,
      // Same resolution order PlotlyChart uses to colour the legend marker.
      color: t.line?.color ?? t.marker?.color ?? t.fillcolor ?? '#6b7280',
      dash: t.line?.dash as LineDash | undefined,
      symbol: t.marker?.symbol as MarkerSymbol | undefined,
      hasLine: mode ? mode.includes('lines') : true,
      hasMarker: mode.includes('markers'),
    });
  }
  return out;
}
