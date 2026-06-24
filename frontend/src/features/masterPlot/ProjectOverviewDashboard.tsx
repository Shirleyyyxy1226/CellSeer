/**
 * Master Plot tab orchestrator. Owns the shared state (metric, view,
 * inspected cell), derives summaries/conditions/flags from the shared data
 * hooks, and routes between the five views:
 *
 *   heatmap / ranking / trajectories — metric-driven views (overview/ modules)
 *   parcoords                                  — full panel (MasterPlot2)
 *
 * View internals live in ./overview — this file should stay thin.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Lock, Pin, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCellRecordIndexQuery,
  useMasterPlotOverviewQuery,
  useMasterPlotPeakShiftQuery,
  useRatePerformanceQuery,
} from '@/hooks/useCellData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { currentProjectIdFromLocation } from '@/lib/projectScope';
import { type CellSummary, METRICS, metricAvailability, metricScore, percentile, summariseCell } from './overview/metrics';
import { DEFAULT_RAMP_ID, RAMPS, type RampId } from './overview/colours';
import { RampProvider } from './overview/RampContext';
import RampPicker from './overview/RampPicker';
import { summariesFromOverview } from './overview/aggregate';
import { MAX_PINS, cellConditionKey, groupConditions } from './overview/conditions';
import { MetricLockedNotice, MetricMassNotice, MetricUnavailableNotice } from './overview/shared';
import { FilterBreadcrumb } from './overview/FilterBreadcrumb';
import { BrushBar } from './overview/BrushBar';
import { PairwiseCompare } from './overview/PairwiseCompare';
import { useOverviewUrlState } from './overview/useOverviewUrlState';
import { useMasterPlotBridge } from '@/contexts/MasterPlotBridgeContext';
import { AttachProtocolButton, useAttachProtocol } from '@/features/protocol';
import ConditionHeatmap from './overview/ConditionHeatmap';
import ConditionRanking from './overview/ConditionRanking';
import Trajectories from './overview/Trajectories';
import Inspector from './overview/Inspector';
import MasterPlot2Panel from './ParallelCoordsPanel';

export interface ProjectOverviewDashboardProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter: (v: string) => void;
  onSeparatorFilter: (v: string) => void;
  onSpacerFilter: (v: string) => void;
}

type OverviewView = 'heatmap' | 'ranking' | 'trajectories' | 'parcoords';

/** Views driven by the shared metric selector (heatmap colour / ranking bars / trajectory sort). */
const METRIC_DRIVEN_VIEWS: OverviewView[] = ['heatmap', 'ranking', 'trajectories'];

/**
 * Project cell count at or above which the condition views switch from the
 * client-side per-cycle pipeline to the server overview aggregate.
 * Real replicate cohorts are a few hundred cells (client path stays the default
 * and is measured-fast); this only trips on large libraries like the 5k P5K
 * benchmark, where shipping the full payload would freeze the tab.
 */
const AGGREGATE_CELL_THRESHOLD = 5000;

export default function ProjectOverviewDashboard(props: ProjectOverviewDashboardProps) {
  const { cathodeFilter, spacerFilter, separatorFilter, onCathodeFilter, onSeparatorFilter, onSpacerFilter } = props;
  const navigate = useNavigate();
  const { selectedCellIds, setSelectedCellIds } = useCellSelection();
  const { brushPassingIds, setBrushPassingIds } = useMasterPlotBridge();
  const { open: openAttachProtocol } = useAttachProtocol();

  const [metricId, setMetricId] = useState('capacity-raw');
  const [view, setView] = useState<OverviewView>('heatmap');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [deadCellsOpen, setDeadCellsOpen] = useState(false);
  // Active colour ramp for the metric-driven views. Default is the intuitive
  // red→green (DEFAULT_RAMP_ID); the picker offers CVD-safe viridis/cividis.
  const [rampId, setRampId] = useState<RampId>(DEFAULT_RAMP_ID);
  const activeRamp = RAMPS[rampId];

  // scale path. The full per-cycle rate-performance payload is
  // ~6.6 MB at 5k cells and freezes the tab beyond that, yet the condition
  // views (heatmap/ranking) only need per-cell scalars.
  // So above a threshold we drive them from the lightweight overview aggregate
  // and defer the full payload until a cell-level view (trajectories / inspector
  // here; parcoords self-fetches) actually needs per-cycle data — and then we
  // pull only the *drawn cohort* (the active dropdown filters), not the whole
  // project. Below the threshold we keep today's measured-fast client
  // path: one full fetch that builds everything. Gating uses the cheap index
  // count as an upper bound on cycling cells, so the decision is made before any
  // heavy fetch.
  const indexQuery = useCellRecordIndexQuery();
  const totalCellCount = indexQuery.data?.cells?.length ?? 0;
  const indexReady = indexQuery.isSuccess;
  const useAggregate = indexReady && totalCellCount >= AGGREGATE_CELL_THRESHOLD;
  const needsPerCycle = view === 'trajectories' || inspectedId != null;

  // On the aggregate path scope the per-cycle fetch to the drawn cohort; on the
  // small path leave it unscoped (the client path needs every cell to build all
  // conditions). The same scope is handed to parcoords so the two share a fetch.
  const rateScope = useAggregate
    ? { cathode: cathodeFilter, separator: separatorFilter, spacer: spacerFilter }
    : undefined;
  const rateQuery = useRatePerformanceQuery({
    enabled: indexReady && (!useAggregate || needsPerCycle),
    scope: rateScope,
  });
  const overviewQuery = useMasterPlotOverviewQuery({ enabled: useAggregate });
  const rawCells = useMemo(() => rateQuery.data?.cells ?? [], [rateQuery.data]);
  const aggregate = overviewQuery.data ?? null;

  // dQ/dV peak-shift is lazy: only fetched when that metric is
  // selected, because its reduction reads the large differential Parquet per
  // cell. When loaded, the scalars merge into `summaries` by cellId below.
  const peakShiftQuery = useMasterPlotPeakShiftQuery({ enabled: metricId === 'dqdv-peak-shift' });
  const peakShiftByCellId = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const c of peakShiftQuery.data?.cells ?? []) m.set(c.cellId, c.peakShiftMv);
    return m;
  }, [peakShiftQuery.data]);

  // Canonical list driving the condition views, filters and KPIs: the full
  // client payload on the small path, the aggregate on the large path. On the
  // large path it must NOT switch to the scoped per-cycle payload — that covers
  // only the filtered cohort and would drop the other conditions. The lazy
  // peak-shift scalars are merged in by cellId when present.
  const summaries = useMemo<CellSummary[]>(() => {
    const base = useAggregate
      ? aggregate
        ? summariesFromOverview(aggregate)
        : []
      : rawCells.map(summariseCell);
    if (!peakShiftByCellId.size) return base;
    return base.map((c) =>
      peakShiftByCellId.has(c.cellId) ? { ...c, peakShiftMv: peakShiftByCellId.get(c.cellId)! } : c,
    );
  }, [useAggregate, aggregate, rawCells, peakShiftByCellId]);

  // Per-cycle enrichment for the cell-level views (trajectories / inspector):
  // on the large path the scoped payload carries capacitySeries + real
  // protocol/idNo the aggregate lacks. Empty on the small path (summaries are
  // already full), so the enrichment below is a no-op there.
  const perCycleByCellId = useMemo(() => {
    const m = new Map<string, CellSummary>();
    if (useAggregate) for (const r of rawCells) { const s = summariseCell(r); m.set(s.cellId, s); }
    return m;
  }, [useAggregate, rawCells]);

  const loading =
    !indexReady ||
    (useAggregate ? overviewQuery.isLoading && !aggregate : rateQuery.isLoading);
  // When the user promotes a cross-view brush via "Filter to brush", the
  // passing id-set becomes a sticky hard filter on the shown cells.
  const [brushFilterIds, setBrushFilterIds] = useState<Set<number> | null>(null);
  // Page-wide categorical filters for the Master Plot views. Cathode/Separator/
  // Spacer are owned upstream (props); Electrolyte/Protocol are owned here and apply
  // to every Master Plot view via the same `filtered` cohort.
  const [electrolyteFilter, setElectrolyteFilter] = useState('All');
  const [protocolFilter, setProtocolFilter] = useState('All');
  // Pinned conditions for side-by-side comparison (capped at MAX_PINS).
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  const [comparePinned, setComparePinned] = useState(false);

  const togglePin = useCallback((key: string) => {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_PINS) next.add(key);
      return next;
    });
  }, []);

  // Deep-link URL state: view, metric and the three filters round-trip through
  // the query string so an exact overview is shareable.
  useOverviewUrlState([
    { key: 'mpView', value: view, default: 'heatmap', onRestore: (v) => setView(v as OverviewView) },
    { key: 'mpMetric', value: metricId, default: 'capacity-raw', onRestore: setMetricId },
    {
      key: 'mpRamp',
      value: rampId,
      default: DEFAULT_RAMP_ID,
      onRestore: (v) => {
        if (v in RAMPS) setRampId(v as RampId);
      },
    },
    { key: 'mpCathode', value: cathodeFilter, default: 'All', onRestore: onCathodeFilter },
    { key: 'mpSeparator', value: separatorFilter, default: 'All', onRestore: onSeparatorFilter },
    { key: 'mpSpacer', value: spacerFilter, default: 'All', onRestore: onSpacerFilter },
  ]);

  const clearAllFilters = useCallback(() => {
    onCathodeFilter('All');
    onSeparatorFilter('All');
    onSpacerFilter('All');
    setElectrolyteFilter('All');
    setProtocolFilter('All');
    setSelectedCellIds([]);
    setBrushFilterIds(null);
    setBrushPassingIds(null, 'overview');
  }, [onCathodeFilter, onSeparatorFilter, onSpacerFilter, setSelectedCellIds, setBrushPassingIds]);

  const filterToBrush = useCallback(() => {
    if (brushPassingIds) setBrushFilterIds(new Set(brushPassingIds));
    setBrushPassingIds(null, 'overview');
  }, [brushPassingIds, setBrushPassingIds]);

  // Prefer mAh/g when most cells actually have cathode mass; otherwise raw mAh.
  const specCoverage = useMemo(() => {
    if (!summaries.length) return 0;
    return summaries.filter((c) => c.peakCapacitySpec != null).length / summaries.length;
  }, [summaries]);

  useEffect(() => {
    setMetricId((prev) =>
      prev === 'capacity-raw' && specCoverage > 0.5 ? 'capacity-spec' : prev,
    );
  }, [specCoverage]);

  // Electrolyte lives only on the cell index (not on CellSummary), so map it by
  // idNo with the SAME normalization the parcoords panel uses ('—' for blanks) so
  // the page filter and the plot agree on values.
  const electrolyteByIdNo = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of indexQuery.data?.cells ?? []) {
      m.set(c.idNo, (c.electrolyte ?? '').trim() || '—');
    }
    return m;
  }, [indexQuery.data]);

  const filtered = useMemo(
    () =>
      summaries.filter((c) => {
        if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
        if (spacerFilter !== 'All' && String(c.spacerMm ?? '') !== spacerFilter) return false;
        if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
        if (electrolyteFilter !== 'All' && (electrolyteByIdNo.get(c.idNo) ?? '—') !== electrolyteFilter)
          return false;
        if (
          protocolFilter !== 'All' &&
          ((c.protocolName ?? '').trim() || '(no protocol)') !== protocolFilter
        )
          return false;
        if (brushFilterIds && !brushFilterIds.has(c.idNo)) return false;
        return true;
      }),
    [
      summaries,
      cathodeFilter,
      spacerFilter,
      separatorFilter,
      electrolyteFilter,
      protocolFilter,
      electrolyteByIdNo,
      brushFilterIds,
    ],
  );

  // "Compare pinned" narrows every view to just the pinned conditions, held
  // side-by-side as the user flips views.
  const pinnedActive = comparePinned && pinnedKeys.size > 0;
  const displayCells = useMemo(
    () => (pinnedActive ? filtered.filter((c) => pinnedKeys.has(cellConditionKey(c))) : filtered),
    [filtered, pinnedActive, pinnedKeys],
  );

  // The cell-level views (trajectories / inspector) need per-cycle data, so swap
  // in the full per-cell summary where the scoped payload has loaded it. On the
  // small path perCycleByCellId is empty, so this is displayCells unchanged.
  const displayCellsForDetail = useMemo(
    () =>
      perCycleByCellId.size
        ? displayCells.map((c) => perCycleByCellId.get(c.cellId) ?? c)
        : displayCells,
    [displayCells, perCycleByCellId],
  );

  // "Never cycled" cells: zero-constant rule — peak raw capacity not positive,
  // so the cell never produced measurable capacity. No tunable threshold. Drives
  // both the KPI count and the drawer list.
  const deadCells = useMemo(
    () => displayCells.filter((c) => !(c.peakCapacityRaw != null && c.peakCapacityRaw > 0)),
    [displayCells],
  );

  const cathodes = useMemo(
    () => Array.from(new Set(summaries.map((c) => c.cathode))).sort(),
    [summaries],
  );
  const separators = useMemo(
    () => Array.from(new Set(summaries.map((c) => c.separatorType))).sort(),
    [summaries],
  );
  const spacers = useMemo(
    () =>
      Array.from(new Set(summaries.map((c) => String(c.spacerMm ?? '')))).filter(Boolean).sort(),
    [summaries],
  );
  const electrolytes = useMemo(
    () => Array.from(new Set(summaries.map((c) => electrolyteByIdNo.get(c.idNo) ?? '—'))).sort(),
    [summaries, electrolyteByIdNo],
  );
  const protocols = useMemo(
    () =>
      Array.from(
        new Set(summaries.map((c) => (c.protocolName ?? '').trim() || '(no protocol)')),
      ).sort(),
    [summaries],
  );

  const metric = METRICS.find((m) => m.id === metricId) ?? METRICS[0];
  // Whether any cell has a resolved protocol — gates the protocol-locked metrics.
  // On the full path this reads per-cell hasProtocol; on the aggregate path the
  // per-cell flag is absent, so we use the project-level count from the endpoint.
  const protocolMissing = useMemo(() => {
    // On the aggregate path `summaries` are scalar-only (hasProtocol always
    // false), so the project-level protocolCellCount is the only honest signal —
    // and it must win even after a scoped per-cycle payload loads (which would
    // otherwise flip the rawCells branch and falsely lock the metrics).
    if (useAggregate) {
      return aggregate ? aggregate.cellCount > 0 && aggregate.protocolCellCount === 0 : false;
    }
    return summaries.length > 0 && summaries.every((c) => !c.hasProtocol);
  }, [useAggregate, summaries, aggregate]);
  // Mirror of protocolMissing for specific capacity: when no cell has a
  // cathode-mass-derived value (specCoverage 0), the spec metric is locked —
  // surfaced like a protocol lock (icon + "needs cathode mass"), not bare "no data".
  const massMissing = summaries.length > 0 && specCoverage === 0;
  const protocolLocked = metric.requiresProtocol && protocolMissing;
  const massLocked = !!metric.requiresMass && massMissing;
  const metricLocked = protocolLocked || massLocked;
  // per-metric coverage over the whole project (not the filtered
  // view), so a metric with no computable value greys out with a reason instead
  // of rendering a blank chart. Protocol-lock takes precedence over this.
  // dQ/dV peak-shift coverage comes from the cell index (which lists each
  // cell's datasets), NOT from summaries — its scalar is lazy and null until the
  // metric is selected, so the summary-based check would wrongly grey it out and
  // make it unselectable (and thus never fetch). The index signal is available
  // on both the small and aggregate paths without any extra fetch.
  const differentialAvailable = useMemo(
    () =>
      (indexQuery.data?.cells ?? []).some((c) =>
        c.datasets?.some((d) => d.name === 'discharge_dqdv'),
      ),
    [indexQuery.data],
  );
  const metricAvailable = useMemo(() => {
    const a = metricAvailability(METRICS, summaries);
    a['dqdv-peak-shift'] = differentialAvailable;
    return a;
  }, [summaries, differentialAvailable]);
  const metricUnavailable = !metricLocked && summaries.length > 0 && !metricAvailable[metric.id];
  // Peak-shift selected, project has differential data, scalars still loading.
  const peakShiftLoading =
    metric.id === 'dqdv-peak-shift' && !metricUnavailable && peakShiftQuery.isLoading;
  const missingProtocolCellIds = useMemo(
    () => Array.from(new Set(displayCells.filter((c) => !c.hasProtocol).map((c) => c.cellId))),
    [displayCells],
  );

  const conditions = useMemo(() => groupConditions(displayCells), [displayCells]);

  /** Colour domain in score space (2–98 pct), so CE colours by closeness to 100%. */
  const metricDomain = useMemo(() => {
    const vals = displayCells
      .map((c) => metric.value(c))
      .filter((v): v is number => v != null)
      .map((v) => metricScore(metric, v))
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    return { min: percentile(vals, 0.02), max: percentile(vals, 0.98) };
  }, [displayCells, metric]);

  /** Raw value domain (2–98 pct) — drives the legend's human-readable end labels
   *  (the score-space domain would show negated/centred values). */
  const metricValueDomain = useMemo(() => {
    const vals = displayCells
      .map((c) => metric.value(c))
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    if (!vals.length) return null;
    return { min: percentile(vals, 0.02), max: percentile(vals, 0.98) };
  }, [displayCells, metric]);

  const kpis = useMemo(() => {
    const useSpec = specCoverage > 0.5;
    const median = (xs: number[]): number | null => {
      if (!xs.length) return null;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    };
    const capValues = displayCells
      .map((c) => (useSpec ? c.peakCapacitySpec : c.peakCapacityRaw))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const cycleCounts = displayCells
      .map((c) => c.cycleCount)
      .filter((n) => Number.isFinite(n) && n > 0);
    // Data readiness (cohort-aware). Mass = cells with a cathode-mass-derived
    // specific capacity. Protocol per-cell is synthetic-false on the aggregate
    // path, so use the honest project-level count there.
    const n = displayCells.length;
    const massReady = n
      ? displayCells.filter((c) => c.peakCapacitySpec != null).length / n
      : 0;
    const protocolReady =
      useAggregate && aggregate
        ? aggregate.cellCount
          ? aggregate.protocolCellCount / aggregate.cellCount
          : 0
        : n
          ? displayCells.filter((c) => c.hasProtocol).length / n
          : 0;
    return {
      cellCount: n,
      chemistries: new Set(displayCells.map((c) => c.cathode)).size,
      capValues,
      cycleMedian: median(cycleCounts),
      cycleMin: cycleCounts.length ? Math.min(...cycleCounts) : null,
      cycleMax: cycleCounts.length ? Math.max(...cycleCounts) : null,
      massReady,
      protocolReady,
    };
  }, [displayCells, specCoverage, useAggregate, aggregate]);

  const inspected = inspectedId
    ? displayCellsForDetail.find((c) => c.cellId === inspectedId) ?? null
    : null;

  const openInTab = useCallback(
    (tab: string, cell: CellSummary) => {
      setSelectedCellIds([cell.idNo]);
      navigate(`?tab=${tab}`);
    },
    [navigate, setSelectedCellIds],
  );

  const inspectorPanel = inspected && (
    <Inspector
      cell={inspected}
      onClose={() => setInspectedId(null)}
      onOpenInTab={openInTab}
    />
  );
  const attachProtocolAction =
    metricLocked && missingProtocolCellIds.length > 0 ? (
      <AttachProtocolButton
        prefill={{
          cellIds: missingProtocolCellIds,
          onSaved: () => {
            void indexQuery.refetch();
            void rateQuery.refetch();
            void overviewQuery.refetch();
          },
        }}
        label={
          missingProtocolCellIds.length === 1
            ? 'Attach protocol to 1 cell'
            : `Attach protocol to ${missingProtocolCellIds.length} cells`
        }
      />
    ) : undefined;

  // Readiness-card quick actions. Protocol reuses the real attach wizard
  // (scoped to the cells missing one); mass has no in-place importer yet, so it
  // routes to the project page where cathode mass is set.
  const handleAttachProtocol = () => {
    openAttachProtocol({
      cellIds: missingProtocolCellIds,
      onSaved: () => {
        void indexQuery.refetch();
        void rateQuery.refetch();
        void overviewQuery.refetch();
      },
    });
  };
  const handleAttachMass = () => {
    // No in-place mass importer yet — send the user to the project page, where
    // cathode mass is set (metadata upload or per-cell edit).
    const pid = currentProjectIdFromLocation();
    if (pid) navigate(`/projects/${pid}`);
  };
  // Action button for the mass-lock notice — the mirror of attachProtocolAction.
  const setMassAction = massLocked ? (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleAttachMass}>
      <Plus className="h-4 w-4" />
      Add cathode mass
    </Button>
  ) : undefined;

  // Notice shown in place of a metric-driven view when the active metric can't
  // render: protocol-locked, mass-locked, no data for the project, or
  // (peak-shift) its lazy scalars are still loading. Shared by the metric views.
  const metricNotice = protocolLocked ? (
    <MetricLockedNotice metric={metric} action={attachProtocolAction} />
  ) : massLocked ? (
    <MetricMassNotice metric={metric} action={setMassAction} />
  ) : metricUnavailable ? (
    <MetricUnavailableNotice metric={metric} />
  ) : peakShiftLoading ? (
    <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
      Computing dQ/dV peak shifts…
    </div>
  ) : null;

  /* ------------------------------------------------------------------ */

  if (loading) {
    return <div className="p-8 text-sm text-muted-foreground">Loading project overview…</div>;
  }

  if (!summaries.length) {
    return (
      <div className="m-4 rounded-lg border border-dashed p-10 text-center">
        <p className="text-sm font-medium">No cycling data in this project yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Import cells from DIGIBAT or upload cycling files, then the project overview builds itself.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const pid = currentProjectIdFromLocation();
              navigate(pid ? `/digibat?projectId=${encodeURIComponent(pid)}` : '/digibat');
            }}
          >
            Import from DIGIBAT
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>
            Go to projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* KPI strip — a single hairline divider beneath it separates the
          "summary" band from the "controls" band, instead of relying on three
          similar-weight stacked grey zones. */}
      <div className="mx-4 mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3 lg:grid-cols-11">
        <Kpi
          className="lg:col-span-2"
          label="Cells with cycling"
          value={`${kpis.cellCount}`}
          sub={totalCellCount ? `of ${totalCellCount} in project` : undefined}
        />
        <Kpi className="lg:col-span-2" label="Chemistries" value={`${kpis.chemistries}`} sub="cathode types" />
        <KpiReadiness
          className="lg:col-span-2"
          label="Data readiness"
          rows={[
            { name: 'Mass', pct: kpis.massReady, onAdd: handleAttachMass, addTitle: 'Add cathode mass' },
            { name: 'Protocol', pct: kpis.protocolReady, onAdd: handleAttachProtocol, addTitle: 'Attach protocol' },
          ]}
        />
        <Kpi
          className="lg:col-span-2"
          label="Cycle depth"
          value={kpis.cycleMedian != null ? `${Math.round(kpis.cycleMedian)}` : '—'}
          sub={
            kpis.cycleMin != null && kpis.cycleMax != null
              ? `median · ${kpis.cycleMin}–${kpis.cycleMax}`
              : 'cycles'
          }
        />
        <KpiDistribution
          className="col-span-2 lg:col-span-3"
          label="Peak capacity"
          values={kpis.capValues}
          deadCount={deadCells.length}
          onOpenDead={() => setDeadCellsOpen(true)}
        />
      </div>

      {/* Hairline divider: summary (above) vs controls (below). */}
      <div className="mx-4 mt-3 border-t border-border" />

      {/* Toolbar row 1: filters + metric/ramp */}
      <div className="mx-4 mt-3 flex flex-wrap items-center gap-2">
        <FilterSelect label="Cathode" value={cathodeFilter} options={cathodes} onChange={onCathodeFilter} />
        <FilterSelect label="Separator" value={separatorFilter} options={separators} onChange={onSeparatorFilter} />
        <FilterSelect label="Spacer (mm)" value={spacerFilter} options={spacers} onChange={onSpacerFilter} />
        <FilterSelect label="Electrolyte" value={electrolyteFilter} options={electrolytes} onChange={setElectrolyteFilter} />
        <FilterSelect label="Protocol" value={protocolFilter} options={protocols} onChange={setProtocolFilter} />
        {METRIC_DRIVEN_VIEWS.includes(view) && (
          <div className="ml-auto flex items-center gap-2 border-l pl-3">
            <Select value={metricId} onValueChange={setMetricId}>
              <SelectTrigger className="h-8 w-[230px] text-sm bg-muted border-input shadow-sm" aria-label="Heatmap metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => {
                  const unavailable = summaries.length > 0 && !metricAvailable[m.id];
                  const protocolLock = m.requiresProtocol && protocolMissing;
                  const massLock = !!m.requiresMass && massMissing;
                  // Locks read as "fixable, needs X"; only genuinely-empty metrics say "no data".
                  const reason = massLock ? ' — needs mass' : unavailable ? ' — no data' : '';
                  return (
                    <SelectItem key={m.id} value={m.id} disabled={unavailable}>
                      <span className="inline-flex items-center gap-1.5">
                        <span>
                          {m.label}
                          {m.unit ? ` (${m.unit})` : ''}
                          {reason}
                        </span>
                        {(protocolLock || massLock) && (
                          <Lock
                            className="h-3 w-3 text-muted-foreground/50 shrink-0"
                            aria-label={massLock ? 'needs cathode mass' : 'needs protocol'}
                          />
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <RampPicker value={rampId} onChange={setRampId} />
          </div>
        )}
      </div>
      {/* Toolbar row 2: view tabs — always fixed position, never wraps with filters */}
      <div className="mx-4 mt-2 flex items-center">
        <div
          className="inline-flex items-center overflow-hidden rounded-md border border-input shadow-sm"
          role="tablist"
          aria-label="Overview view"
        >
          {(
            [
              ['heatmap', 'Heatmap'],
              ['ranking', 'Ranking'],
              ['trajectories', 'Trajectories'],
              ['parcoords', 'Parallel coords'],
            ] as [OverviewView, string][]
          ).map(([key, label], i) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`inline-flex h-7 items-center px-3 text-[11px] transition-colors ${
                i > 0 ? 'border-l border-border' : ''
              } ${
                view === key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view !== 'parcoords' && <FilterBreadcrumb
        chips={[
          { label: 'Cathode', value: cathodeFilter, onClear: () => onCathodeFilter('All') },
          { label: 'Separator', value: separatorFilter, onClear: () => onSeparatorFilter('All') },
          { label: 'Spacer', value: spacerFilter, onClear: () => onSpacerFilter('All') },
          { label: 'Electrolyte', value: electrolyteFilter, onClear: () => setElectrolyteFilter('All') },
          { label: 'Protocol', value: protocolFilter, onClear: () => setProtocolFilter('All') },
          ...(brushFilterIds
            ? [{ label: 'Brush', value: `${brushFilterIds.size} cells`, cleared: '', onClear: () => setBrushFilterIds(null) }]
            : []),
        ]}
        selectionCount={selectedCellIds.length}
        onClearSelection={() => setSelectedCellIds([])}
        onClearAll={clearAllFilters}
      />}

      {brushPassingIds != null && (
        <BrushBar
          passingCount={filtered.filter((c) => brushPassingIds.has(c.idNo)).length}
          onFilterToBrush={filterToBrush}
        />
      )}

      {pinnedKeys.size > 0 && (
        <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs dark:border-amber-700 dark:bg-amber-950">
          <Pin className="h-3.5 w-3.5 text-amber-600" />
          <span className="font-medium text-amber-700 dark:text-amber-300">
            {pinnedKeys.size} pinned{pinnedKeys.size >= MAX_PINS ? ' (max)' : ''}
          </span>
          <button
            type="button"
            onClick={() => setComparePinned((v) => !v)}
            className={`ml-auto rounded-md border px-2 py-0.5 ${
              comparePinned
                ? 'border-amber-600 bg-amber-600 text-white'
                : 'border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900'
            }`}
          >
            {comparePinned ? 'Comparing pinned' : 'Compare pinned'}
          </button>
          <button
            type="button"
            onClick={() => {
              setPinnedKeys(new Set());
              setComparePinned(false);
            }}
            className="rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
          >
            Clear pins
          </button>
        </div>
      )}

      {pinnedActive && !metricLocked && (
        <PairwiseCompare conditions={conditions} metric={metric} />
      )}

      {/* Body */}
      <RampProvider ramp={activeRamp}>
      {view === 'heatmap' ? (
        <div className="mx-4 my-3 flex flex-1 items-stretch gap-3 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto rounded-md border bg-card p-3">
            {metricNotice ?? (
              <ConditionHeatmap
                conditions={conditions}
                metric={metric}
                domain={metricDomain}
                valueDomain={metricValueDomain}
                inspectedId={inspectedId}
                onInspect={setInspectedId}
                onCathodeFilter={onCathodeFilter}
                pinnedKeys={pinnedKeys}
                onTogglePin={togglePin}
              />
            )}
          </div>
          {inspectorPanel}
        </div>
      ) : view === 'ranking' ? (
        <div className="mx-4 my-3 flex flex-1 items-stretch gap-3 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-auto rounded-md border bg-card p-3">
            {metricNotice ?? (
              <ConditionRanking
                conditions={conditions}
                metric={metric}
                onInspect={setInspectedId}
                onApplyCondition={(cond) => {
                  onCathodeFilter(cond.cathode);
                  onSeparatorFilter(cond.separatorType);
                  onSpacerFilter(cond.spacerMm != null ? String(cond.spacerMm) : 'All');
                }}
                pinnedKeys={pinnedKeys}
                onTogglePin={togglePin}
              />
            )}
          </div>
          {inspectorPanel}
        </div>
      ) : view === 'trajectories' ? (
        <div className="mx-4 my-3 flex flex-1 items-stretch gap-3 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden rounded-md border bg-card p-3">
            <Trajectories
              cells={displayCellsForDetail}
              metric={metric}
              onInspect={setInspectedId}
              onApplyCondition={(cond) => {
                onCathodeFilter(cond.cathode);
                onSeparatorFilter(cond.separatorType);
                onSpacerFilter(cond.spacerMm != null ? String(cond.spacerMm) : 'All');
              }}
            />
          </div>
          {inspectorPanel}
        </div>
      ) : (
        <div className="mx-4 my-3 flex flex-1 items-stretch gap-3 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">
            <MasterPlot2Panel
              visibleCells={props.visibleCells}
              cathodeFilter={cathodeFilter}
              spacerFilter={spacerFilter}
              separatorFilter={separatorFilter}
              electrolyteFilter={electrolyteFilter}
              protocolFilter={protocolFilter}
              rateScope={rateScope}
              onInspect={setInspectedId}
            />
          </div>
          {inspectorPanel}
        </div>
      )}
      </RampProvider>

      <DeadCellsDrawer
        open={deadCellsOpen}
        cells={deadCells}
        onClose={() => setDeadCellsOpen(false)}
        onOpenInTab={openInTab}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Kpi({
  label,
  value,
  sub,
  locked,
  warn,
  className,
}: {
  label: string;
  value?: string;
  sub?: string;
  locked?: boolean;
  warn?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col justify-center px-3 py-2.5 ${warn ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-card'} ${className ?? ''}`}
    >
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.12em] ${
          warn ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
        }`}
      >
        {label}
      </p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span
          className={`text-2xl font-bold leading-none tabular-nums ${
            warn ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'
          }`}
        >
          {locked ? (
            <Lock className="inline h-4 w-4 text-muted-foreground/50" aria-label="needs protocol" />
          ) : (value ?? '—')}
        </span>
        {sub && (
          <span
            className={`text-[11px] font-normal ${
              warn ? 'text-amber-700/80 dark:text-amber-400/80' : 'text-muted-foreground'
            }`}
          >
            {sub}
          </span>
        )}
      </p>
    </div>
  );
}

/** Data-readiness card: one labelled gauge bar per metadata dimension (Mass,
 *  Protocol). Shows coverage at a glance — what fraction of the cohort can
 *  actually feed specific-capacity / retention metrics. */
function KpiReadiness({
  label,
  rows,
  className,
}: {
  label: string;
  rows: { name: string; pct: number; onAdd?: () => void; addTitle?: string }[];
  className?: string;
}) {
  return (
    <div className={`flex flex-col justify-center bg-card px-3 py-2.5 ${className ?? ''}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = Math.round(Math.max(0, Math.min(1, r.pct)) * 100);
          const addTitle = r.addTitle ?? `Add ${r.name.toLowerCase()}`;
          return (
            <div key={r.name} className="flex items-center gap-1.5">
              <span className="w-12 shrink-0 text-[10px] text-muted-foreground">{r.name}</span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-7 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">
                {pct}%
              </span>
              {r.onAdd && (
                <button
                  type="button"
                  onClick={r.onAdd}
                  title={addTitle}
                  aria-label={addTitle}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Performance card: a big "never cycled" count (click the chevron to list those
 *  cells) beside a distribution sparkline. The histogram's near-zero pile-up
 *  shows dead cells without a threshold; the count makes them actionable. */
function KpiDistribution({
  label,
  values,
  deadCount,
  onOpenDead,
  className,
}: {
  label: string;
  values: number[];
  deadCount?: number;
  onOpenDead?: () => void;
  className?: string;
}) {
  const hasDead = deadCount != null && deadCount > 0;
  return (
    <div className={`flex flex-col justify-center bg-card px-3 py-2.5 ${className ?? ''}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-3">
        {hasDead ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
              {deadCount}
            </span>
            <span className="text-[11px] text-muted-foreground">never cycled</span>
            <button
              type="button"
              onClick={onOpenDead}
              title="View the cells that never cycled"
              aria-label={`View ${deadCount} cells that never cycled`}
              className="group inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">all cells cycled</span>
        )}
        <div className="min-w-0 flex-1">
          <MiniHistogram values={values} height={28} />
        </div>
      </div>
    </div>
  );
}

/** Tiny axis-free histogram (Tufte sparkline) over [0, max], so a near-zero
 *  cluster reads on the left. SVG bars, stretched to fill the card width. */
function MiniHistogram({
  values,
  bins = 22,
  height = 26,
}: {
  values: number[];
  bins?: number;
  height?: number;
}) {
  const { counts, max } = useMemo(() => {
    const vals = values.filter((v) => Number.isFinite(v));
    if (!vals.length) return { counts: [] as number[], max: 0 };
    const hi = vals.reduce((a, b) => Math.max(a, b), 0);
    const span = hi || 1; // domain [0, hi] so a near-zero pile-up reads on the left
    const c = new Array(bins).fill(0);
    for (const v of vals) {
      let i = Math.floor((v / span) * bins);
      if (i < 0) i = 0;
      if (i >= bins) i = bins - 1;
      c[i] += 1;
    }
    return { counts: c, max: c.reduce((a, b) => Math.max(a, b), 0) };
  }, [values, bins]);

  if (!counts.length || max === 0) return <div style={{ height }} />;
  const W = 100;
  const gap = 0.6;
  const bw = (W - gap * (bins - 1)) / bins;
  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Distribution"
      className="text-muted-foreground/70"
    >
      {counts.map((c, i) => {
        const h = c === 0 ? 0 : Math.max(1, (c / max) * (height - 1));
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={h}
            className="fill-current"
          />
        );
      })}
    </svg>
  );
}

/** Right-hand drawer for the "never cycled" cells. Two modes in the same panel:
 *  a list, and — once a row is picked — the cell's Inspector embedded in place,
 *  with a back-to-list button and ‹ › to step through the dead cells. The
 *  Inspector's drill buttons (GCD / dQ/dV / rate) jump to the raw data. */
function DeadCellsDrawer({
  open,
  cells,
  onClose,
  onOpenInTab,
}: {
  open: boolean;
  cells: CellSummary[];
  onClose: () => void;
  onOpenInTab: (tab: string, cell: CellSummary) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Reset to the list whenever the drawer is closed, and keep the index valid if
  // the cohort changes underneath us.
  useEffect(() => {
    if (!open) setSelectedIdx(null);
  }, [open]);
  if (!open) return null;

  const selected =
    selectedIdx != null && selectedIdx >= 0 && selectedIdx < cells.length
      ? cells[selectedIdx]
      : null;

  return (
    <div className="absolute inset-0 z-40 flex">
      <button
        type="button"
        aria-label="Close never-cycled panel"
        className="flex-1 bg-foreground/10"
        onClick={onClose}
      />
      <aside className="flex w-[320px] shrink-0 flex-col border-l bg-card shadow-xl">
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
              <button
                type="button"
                onClick={() => setSelectedIdx(null)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                List
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous cell"
                  disabled={selectedIdx === 0}
                  onClick={() => setSelectedIdx((i) => (i != null && i > 0 ? i - 1 : i))}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-muted-foreground">
                  {(selectedIdx ?? 0) + 1} / {cells.length}
                </span>
                <button
                  type="button"
                  aria-label="Next cell"
                  disabled={selectedIdx === cells.length - 1}
                  onClick={() =>
                    setSelectedIdx((i) => (i != null && i < cells.length - 1 ? i + 1 : i))
                  }
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Inspector
                cell={selected}
                embedded
                onClose={() => setSelectedIdx(null)}
                onOpenInTab={(tab, c) => {
                  onClose();
                  onOpenInTab(tab, c);
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <h3 className="text-sm font-semibold">Never cycled</h3>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={onClose}
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {cells.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  No never-cycled cells in this cohort.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {cells.map((cell, i) => (
                    <li key={cell.cellId}>
                      <button
                        type="button"
                        onClick={() => setSelectedIdx(i)}
                        className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{cell.cellName}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {cell.cathode} · {cell.cycleCount} cycle
                            {cell.cycleCount === 1 ? '' : 's'} logged
                          </span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[150px] text-sm bg-muted border-input shadow-sm" aria-label={`Filter by ${label}`}>
        <span className="mr-1 text-xs text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
