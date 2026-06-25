/**
 * Inspector side panel — per-cell drill-down shared by the heatmap, ranking
 * and trajectories views: capacity sparkline, protocol state, key stats, cohort
 * flags, and jump-to-detail-tab buttons.
 */
import { ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CellSummary } from './metrics';

function Sparkline({ series }: { series: { cycle: number; value: number }[] }) {
  if (series.length < 2) {
    return <p className="text-xs text-muted-foreground">Not enough cycles to plot.</p>;
  }
  const w = 240;
  const h = 64;
  const pad = 4;
  const xs = series.map((d) => d.cycle);
  const ys = series.map((d) => d.value);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const x = (v: number) => pad + ((v - xMin) / Math.max(1e-9, xMax - xMin)) * (w - 2 * pad);
  const y = (v: number) => h - pad - ((v - yMin) / Math.max(1e-9, yMax - yMin)) * (h - 2 * pad);
  const path = series.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(d.cycle).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="block" role="img" aria-label="Specific capacity vs cycle">
      <path d={path} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
      {series.map((d, i) => (
        <circle key={i} cx={x(d.cycle)} cy={y(d.value)} r={1.8} fill="hsl(var(--primary))" />
      ))}
    </svg>
  );
}

function MiniStat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="bg-card px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}

export default function Inspector({
  cell,
  onClose,
  onOpenInTab,
  embedded = false,
}: {
  cell: CellSummary;
  onClose: () => void;
  onOpenInTab: (tab: string, cell: CellSummary) => void;
  /** When embedded in another panel (e.g. the never-cycled drawer), drop the
   *  standalone width/border/scroll so it fills the host. */
  embedded?: boolean;
}) {
  const hasSeries = cell.capacitySeries.length >= 2;
  return (
    <aside
      className={
        embedded
          ? 'flex flex-col p-3'
          : 'flex w-[300px] shrink-0 flex-col overflow-y-auto rounded-md border bg-card p-3'
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{cell.cellName}</h3>
          <p className="text-xs text-muted-foreground">
            {cell.cathode} · {cell.separatorType} · {cell.spacerMm ?? '—'} mm spacer
          </p>
        </div>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} aria-label="Close inspector">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Discharge capacity profile
        </p>
        {hasSeries ? (
          <>
            <Sparkline series={cell.capacitySeries} />
            <p
              className={`mt-1 rounded px-2 py-1 text-[11px] ${cell.hasProtocol ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}
            >
              {cell.hasProtocol
                ? `✓ Protocol: ${cell.protocolName ?? 'attached'} — cycle sequence resolved.`
                : 'Cycles are raw / unsegmented. Step changes may be rate-test transitions, not degradation.'}
            </p>
          </>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            No discharge capacity recorded
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border bg-border">
        <MiniStat
          label="Peak cap."
          value={
            cell.capacityBasis === 'mAh/g'
              ? cell.peakCapacitySpec != null
                ? cell.peakCapacitySpec.toFixed(0)
                : '—'
              : cell.peakCapacityRaw != null
                ? cell.peakCapacityRaw.toFixed(2)
                : '—'
          }
          unit={cell.capacityBasis}
        />
        <MiniStat label="Median CE" value={cell.medianCE != null ? cell.medianCE.toFixed(2) : '—'} unit="%" />
        <MiniStat label="Cycles" value={String(cell.cycleCount)} unit="" />
      </div>


      <div className="mt-3">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Drill into detail
        </p>
        <div className="flex flex-col gap-1">
          {(
            [
              ['voltagecap', 'GCD curves'],
              ['dqdv', 'dQ/dV 3D'],
              ['rateperf-hier', 'Rate performance'],
            ] as [string, string][]
          ).map(([tab, label]) => (
            <Button
              key={tab}
              size="sm"
              variant="outline"
              className="justify-between"
              onClick={() => onOpenInTab(tab, cell)}
            >
              {label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          ))}
        </div>
      </div>
    </aside>
  );
}
