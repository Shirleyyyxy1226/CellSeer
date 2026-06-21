/**
 * Step 3 — read-only summary before commit.
 */

import * as React from 'react';
import { Info, TriangleAlert } from 'lucide-react';

import { ProtocolBandPreview } from '../ProtocolBandPreview';
import type { EditableProtocolSegment } from '../types';
import type { IndexCellRaw } from '@/lib/api';

export interface VerifyStepProps {
  cellIds: string[];
  segments: EditableProtocolSegment[];
  protocolName: string;
  affectedCells?: IndexCellRaw[];
}

export function VerifyStep({
  cellIds,
  segments,
  protocolName,
  affectedCells = [],
}: VerifyStepProps) {
  const overwrites = React.useMemo(
    () => affectedCells.filter((c) => c.protocolName && c.protocolName !== protocolName),
    [affectedCells, protocolName],
  );

  return (
    <div className="space-y-4">
      {/* Protocol summary card */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Protocol</p>
            <h4 className="mt-0.5 text-[15px] font-semibold text-foreground">
              {protocolName || 'Untitled protocol'}
            </h4>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">Applying to</p>
            <p className="text-[15px] font-semibold text-foreground">
              {cellIds.length} cell{cellIds.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <ProtocolBandPreview segments={segments} height={40} className="rounded-none border-t border-b-0 border-x-0" />
        <div className="flex items-center gap-3 px-4 py-2.5">
          {segments.map((seg, i) => (
            <span key={seg.id} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              {i > 0 && <span className="text-border">·</span>}
              <span className="font-medium text-foreground">{seg.name || `Stage ${i + 1}`}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Overwrite warning / info notice */}
      {overwrites.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1.5">
            <p className="font-semibold">
              {overwrites.length} cell{overwrites.length === 1 ? ' already has' : 's already have'} a different protocol
            </p>
            <ul className="space-y-0.5 text-amber-800 dark:text-amber-400">
              {overwrites.slice(0, 5).map((c) => (
                <li key={c.cellId} className="flex items-baseline gap-1">
                  <span className="font-medium text-amber-900 dark:text-amber-300">{c.cellName || c.cellId}</span>
                  <span className="text-[11px]">→ {c.protocolName}</span>
                </li>
              ))}
              {overwrites.length > 5 && (
                <li className="text-[11px]">…and {overwrites.length - 5} more</li>
              )}
            </ul>
            <p className="text-amber-700 dark:text-amber-400">Saving will replace the existing protocol on these cells.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 text-[12px] text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" />
          <p>Saving will assign this protocol to all selected cells.</p>
        </div>
      )}
    </div>
  );
}
