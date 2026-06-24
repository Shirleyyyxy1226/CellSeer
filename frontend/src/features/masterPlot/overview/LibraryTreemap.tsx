/**
 * Library map — Plotly treemap of the cell library's natural hierarchy
 * (cathode → separator → spacer → cell). Tile area = cell count, colour =
 * selected metric (score space); branches colour by cohort mean. Clicking a
 * group zooms via the pathbar, clicking a cell opens the Inspector.
 *
 * STATUS: IN DEVELOPMENT — intentionally kept, but NOT currently mounted in the
 * Master Plot view tabs. The live views are heatmap / ranking / trajectories /
 * parallel coords (see ProjectOverviewDashboard); nothing imports this component
 * yet. To re-enable it, add a 'treemap' case to the OverviewView type + the view
 * tablist and render it like the other metric-driven views. Left in the tree so
 * the work isn't lost.
 */
import { useCallback, useMemo } from 'react';
import type Plotly from 'plotly.js-strict-dist-min';
import PlotlyChart from '@/components/PlotlyChart';
import type { CellSummary, MetricDef } from './metrics';
import { metricScore } from './metrics';
import { branchPanelColour, branchPanelText, rampColourFrom, rampTextFrom } from './colours';
import { useActiveRamp } from './RampContext';
import { RampLegend } from './shared';

export default function LibraryTreemap({
  cells,
  metric,
  domain,
  valueDomain,
  onInspect,
}: {
  cells: CellSummary[];
  metric: MetricDef;
  domain: { min: number; max: number } | null;
  valueDomain?: { min: number; max: number } | null;
  onInspect: (id: string) => void;
}) {
  const ramp = useActiveRamp();
  const tree = useMemo(() => {
    /** Domain is in score space — raw values go through metricScore first. */
    const norm = (v: number) => {
      const s = metricScore(metric, v);
      return domain && domain.max > domain.min
        ? Math.min(1, Math.max(0, (s - domain.min) / (domain.max - domain.min)))
        : 0.5;
    };
    const ids: string[] = [];
    const labels: string[] = [];
    const parents: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];
    const textColors: string[] = [];
    const hover: string[] = [];
    const text: string[] = [];
    const customdata: (string | null)[] = [];
    const branchVals = new Map<string, number[]>();
    const seen = new Set<string>();
    const panelFill = branchPanelColour();
    const panelText = branchPanelText();

    const addBranch = (id: string, label: string, parent: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
      labels.push(label);
      parents.push(parent);
      values.push(0);
      // Group panels are neutral chrome — never the value ramp — so colour in
      // the treemap always reads as "metric value" on the leaf cells only.
      colors.push(panelFill);
      textColors.push(panelText);
      hover.push('');
      text.push(label); // group/branch tiles always keep their header label
      customdata.push(null);
      branchVals.set(id, []);
    };

    // Leaf tiles are all area = 1, so beyond a small library they become an
    // unreadable field of micro-labels. Above this threshold we drop the
    // per-cell label and let hover / the tooltip carry the cell name, keeping
    // the colour areas clean.
    const showLeafLabels = cells.length <= 48;

    for (const c of cells) {
      const catId = `cat|${c.cathode}`;
      const sepId = `${catId}|${c.separatorType}`;
      const spcId = `${sepId}|${c.spacerMm ?? '—'}`;
      addBranch(catId, c.cathode, '');
      addBranch(sepId, c.separatorType, catId);
      addBranch(spcId, `${c.spacerMm ?? '—'} mm`, sepId);
      const v = metric.value(c);
      ids.push(`cell|${c.cellId}`);
      labels.push(c.cellName);
      text.push(showLeafLabels ? c.cellName : '');
      parents.push(spcId);
      values.push(1);
      const t = v != null ? norm(v) : null;
      colors.push(t != null ? rampColourFrom(ramp, t) : 'rgba(148, 163, 184, 0.35)');
      // Per-leaf label colour by tile luminance: white on dark viridis, near-
      // black on yellow/green — guaranteed contrast across the whole ramp.
      textColors.push(t != null ? rampTextFrom(ramp, t) : 'rgba(100,116,139,0.95)');
      hover.push(
        `${c.cellName}<br>${c.cathode} · ${c.separatorType} · ${c.spacerMm ?? '—'} mm<br>` +
          `${metric.label}: ${v != null ? `${metric.format(v)} ${metric.unit}` : 'no data'}<br>` +
          `${c.cycleCount} cycles`,
      );
      customdata.push(c.cellId);
      if (v != null) {
        branchVals.get(catId)!.push(v);
        branchVals.get(sepId)!.push(v);
        branchVals.get(spcId)!.push(v);
      }
    }

    for (let i = 0; i < ids.length; i++) {
      const vals = branchVals.get(ids[i]);
      if (!vals) continue;
      // Group panels keep their neutral chrome fill; we only fill in the hover
      // so the cohort mean is still discoverable without colour-coding the panel.
      if (vals.length) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        hover[i] = `${labels[i]}<br>${vals.length} cells · mean ${metric.label.toLowerCase()}: ${metric.format(mean)} ${metric.unit}`;
      } else {
        hover[i] = `${labels[i]}<br>no ${metric.label.toLowerCase()} data`;
      }
    }

    return { ids, labels, parents, values, colors, textColors, hover, text, customdata };
  }, [cells, metric, domain, ramp]);

  const data = useMemo(
    () =>
      [
        {
          type: 'treemap',
          ids: tree.ids,
          labels: tree.labels,
          parents: tree.parents,
          values: tree.values,
          customdata: tree.customdata,
          text: tree.text,
          branchvalues: 'remainder',
          // 1px low-opacity neutral border: colour areas read continuously
          // instead of as a strong white grid over the viridis fill.
          marker: { colors: tree.colors, line: { width: 1, color: 'rgba(120,120,120,0.25)' } },
          textinfo: 'text',
          // Per-tile label colour: luminance-matched on leaves, neutral on the
          // (now grey) group panels — so text stays legible everywhere.
          textfont: { size: 11, color: tree.textColors },
          insidetextfont: { size: 11, color: tree.textColors },
          hovertext: tree.hover,
          hoverinfo: 'text',
          // Stronger pathbar header so each cathode group is clearly delimited.
          pathbar: { visible: true, thickness: 26, textfont: { size: 13 } },
          tiling: { pad: 1 },
        },
      ] as unknown as Plotly.Data[],
    [tree],
  );

  const handleClick = useCallback(
    (ev: Plotly.PlotMouseEvent) => {
      const cd = (ev.points?.[0] as unknown as { customdata?: unknown })?.customdata;
      if (typeof cd === 'string') onInspect(cd);
    },
    [onInspect],
  );

  if (!cells.length) {
    return <p className="p-6 text-sm text-muted-foreground">No cells match the current filters.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Library map
        </p>
        <RampLegend metric={metric} domain={domain} valueDomain={valueDomain} showMissing />
      </div>
      <div className="min-h-[460px] flex-1">
        <PlotlyChart
          data={data}
          layout={{ margin: { t: 30, l: 4, r: 4, b: 4 } }}
          onClick={handleClick}
          downloadFilename="cellseer_library_map"
        />
      </div>
    </div>
  );
}
