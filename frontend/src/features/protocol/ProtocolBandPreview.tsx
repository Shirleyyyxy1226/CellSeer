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

const RATE_PALETTE = [
  '#94a3b8', // slate-400  — very low rate
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#fb923c', // orange-400
  '#f87171', // red-400
  '#a78bfa', // violet-400 — very high rate
];

function rateColour(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return RATE_PALETTE[0];
  const bucket = Math.max(0, Math.round(-Math.log2(rate) + 3));
  return RATE_PALETTE[Math.min(bucket, RATE_PALETTE.length - 1)];
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
              <span className="truncate px-1 text-[10px] font-semibold leading-none text-white drop-shadow-sm">
                {formatCRate(seg.cRate)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
