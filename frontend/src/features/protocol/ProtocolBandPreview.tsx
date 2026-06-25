/**
 * Horizontal "band" preview of a protocol — one coloured swatch per
 * segment, sized proportionally to its cycle span. Open-ended segments
 * use a stripe pattern and fill residual width.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { formatCRate, formatCycleRange } from './cRate';
import type { EditableProtocolSegment, OpenEndedProtocolSegment } from './types';

type AnySegment = EditableProtocolSegment | OpenEndedProtocolSegment;

// Neutral-slate ramp: high C-rate = dark, low C-rate = light. Keeps the stage
// bar calm (no saturated hues competing for attention) while still encoding rate.
const RATE_PALETTE = [
  '#334155', // slate-700 — ≥8C (highest rate)
  '#475569', // slate-600 — ≥5C
  '#64748b', // slate-500 — 2C
  '#94a3b8', // slate-400 — 1C
  '#cbd5e1', // slate-300 — 0.5C
  '#dbe2ea', //            — ~0.25C
  '#e2e8f0', // slate-200 — 0.1C (lowest rate)
];

function rateColour(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return RATE_PALETTE[0];
  const bucket = Math.max(0, Math.round(-Math.log2(rate) + 3));
  return RATE_PALETTE[Math.min(bucket, RATE_PALETTE.length - 1)];
}

/** Light stage swatches need dark text; dark ones need light text. */
function isLightFill(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export interface ProtocolBandPreviewProps {
  segments: ReadonlyArray<AnySegment>;
  height?: number;
  className?: string;
  showLabels?: boolean;
}

export function ProtocolBandPreview({
  segments,
  height = 36,
  className,
  showLabels = true,
}: ProtocolBandPreviewProps) {
  const FALLBACK_OPEN_LEN = 50;
  const lengths = segments.map((seg) =>
    seg.cycleEnd == null ? FALLBACK_OPEN_LEN : Math.max(1, seg.cycleEnd - seg.cycleStart + 1),
  );
  const total = lengths.reduce((s, n) => s + n, 0) || 1;

  return (
    <div
      className={cn('flex w-full overflow-hidden rounded-md', className)}
      style={{ height }}
    >
      {segments.length === 0 && (
        <div className="flex w-full items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground">
          No stages yet
        </div>
      )}
      {segments.map((seg, idx) => {
        const isOpen = seg.cycleEnd == null;
        const pct = (lengths[idx] / total) * 100;
        const fill = rateColour(seg.cRate);
        return (
          <div
            key={idx}
            style={{
              width: `${pct}%`,
              minWidth: '20px',
              backgroundColor: fill,
              backgroundImage: isOpen
                ? `repeating-linear-gradient(135deg, transparent 0 5px, rgba(255,255,255,0.15) 5px 10px)`
                : undefined,
            }}
            className="relative flex items-center justify-center border-r border-white/20 last:border-r-0"
            title={`${seg.name || `Stage ${idx + 1}`} · ${formatCRate(seg.cRate)} · cycles ${formatCycleRange(seg.cycleStart, seg.cycleEnd)}`}
          >
            {showLabels && pct >= 9 && (
              <span
                className={cn(
                  'truncate px-1 text-[10px] font-semibold leading-none drop-shadow-sm',
                  isLightFill(fill) ? 'text-slate-900' : 'text-white',
                )}
              >
                {formatCRate(seg.cRate)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
