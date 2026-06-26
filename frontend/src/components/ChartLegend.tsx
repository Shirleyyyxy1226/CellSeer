/**
 * ChartLegend — a discrete series legend rendered as its OWN block BELOW a plot,
 * instead of inside the Plotly figure. Keeping it out of the figure means it can
 * never collide with an axis title, and it can wrap onto several rows / scroll
 * when there are many series, so the show/hide toggle is always available.
 *
 * The toggle is a text control (the word "Legend"), wired to the same per-plot
 * `showLegend` source of truth the edit popover's checkbox writes, so the two
 * controls can never disagree.
 */

import type { LineDash, MarkerSymbol } from '@/charts';
import { cn } from '@/lib/utils';

export interface LegendItem {
  label: string;
  color: string;
  dash?: LineDash;
  symbol?: MarkerSymbol;
  /** Draw a connecting line in the swatch (defaults to true). */
  hasLine?: boolean;
  /** Draw the marker symbol in the swatch. */
  hasMarker?: boolean;
}

interface ChartLegendProps {
  items: LegendItem[];
  /** Whether the swatch list is expanded. */
  shown: boolean;
  onToggle: () => void;
  /** Used in the toggle's aria-label to distinguish multiple charts. */
  chartLabel?: string;
  /** Max height of the swatch list before it scrolls (px). */
  maxHeight?: number;
  /** Optional label font size (px) — honours the popover's "Legend font size". */
  fontSize?: number;
  className?: string;
}

// Plotly dash name → SVG stroke-dasharray. `solid` omits the attribute.
const DASH_ARRAY: Record<LineDash, string | undefined> = {
  solid: undefined,
  dash: '5,3',
  dot: '1,3',
  dashdot: '5,3,1,3',
  longdash: '9,4',
  longdashdot: '9,4,1,4',
};

/** Regular n-gon path centred at (cx,cy), first vertex at `startDeg`. */
function polyPath(cx: number, cy: number, r: number, n: number, startDeg: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = ((startDeg + (360 / n) * i) * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

/** 5-point star path. */
function starPath(cx: number, cy: number, rOuter: number, rInner: number, points: number): string {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

/** Filled plus ("+") path; rotate 45° for an "x". */
function crossPath(cx: number, cy: number, r: number): string {
  const t = r * 0.42; // half-thickness of the arms
  return [
    `M${cx - t},${cy - r}`, `L${cx + t},${cy - r}`, `L${cx + t},${cy - t}`,
    `L${cx + r},${cy - t}`, `L${cx + r},${cy + t}`, `L${cx + t},${cy + t}`,
    `L${cx + t},${cy + r}`, `L${cx - t},${cy + r}`, `L${cx - t},${cy + t}`,
    `L${cx - r},${cy + t}`, `L${cx - r},${cy - t}`, `L${cx - t},${cy - t}`, 'Z',
  ].join(' ');
}

function MarkerShape({ symbol, color }: { symbol: MarkerSymbol; color: string }) {
  const cx = 12;
  const cy = 6;
  const r = 3.2;
  const common = { fill: color, stroke: '#fff', strokeWidth: 0.5 };
  switch (symbol) {
    case 'square':
      return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} {...common} />;
    case 'diamond':
      return <path d={`M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy} Z`} {...common} />;
    case 'triangle-up':
      return <path d={`M${cx},${cy - r} L${cx + r},${cy + r} L${cx - r},${cy + r} Z`} {...common} />;
    case 'star':
      return <path d={starPath(cx, cy, r, r * 0.45, 5)} {...common} />;
    case 'pentagon':
      return <path d={polyPath(cx, cy, r, 5, -90)} {...common} />;
    case 'cross':
      return <path d={crossPath(cx, cy, r)} {...common} />;
    case 'x':
      return <path d={crossPath(cx, cy, r)} transform={`rotate(45 ${cx} ${cy})`} {...common} />;
    case 'circle':
    default:
      return <circle cx={cx} cy={cy} r={r} {...common} />;
  }
}

function Swatch({ item }: { item: LegendItem }) {
  const showLine = item.hasLine !== false;
  return (
    <svg width={24} height={12} viewBox="0 0 24 12" className="shrink-0" aria-hidden="true">
      {showLine && (
        <line
          x1={1}
          y1={6}
          x2={23}
          y2={6}
          stroke={item.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={item.dash ? DASH_ARRAY[item.dash] : undefined}
        />
      )}
      {item.hasMarker && <MarkerShape symbol={item.symbol ?? 'circle'} color={item.color} />}
    </svg>
  );
}

export function ChartLegend({
  items,
  shown,
  onToggle,
  chartLabel,
  maxHeight = 96,
  fontSize,
  className,
}: ChartLegendProps) {
  if (items.length === 0) return null;
  const labelStyle = fontSize ? { fontSize } : undefined;
  return (
    <div className={cn('mt-1.5 w-full', className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={shown}
        aria-label={`${shown ? 'Hide' : 'Show'} legend${chartLabel ? ` — ${chartLabel}` : ''}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span aria-hidden="true" className="inline-block w-3 text-center">
          {shown ? '▾' : '▸'}
        </span>
        <span>Legend{shown ? '' : ` (${items.length})`}</span>
      </button>
      {shown && (
        <ul
          role="list"
          className="mt-1 flex flex-wrap gap-x-4 gap-y-1 overflow-y-auto pr-1"
          style={{ maxHeight }}
        >
          {items.map((item, i) => (
            <li
              key={`${item.label}-${i}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              style={labelStyle}
            >
              <Swatch item={item} />
              <span className="whitespace-nowrap">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ChartLegend;
