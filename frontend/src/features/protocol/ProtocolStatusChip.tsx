/**
 * Compact, consistent "Protocol: …" surface used everywhere a cell carries
 * a (possibly null) protocol. Click → opens the attach-protocol wizard
 * pre-scoped to this cell.
 *
 * Visual states:
 *   - attached  → solid pill with the synthesised name (e.g. "FORM-3 | 1C")
 *   - missing   → dashed pill with "Attach protocol"
 *   - mismatch  → solid pill in amber when ``mismatch`` is true (the
 *                 caller decides what "mismatch" means; rate-performance
 *                 sets it when sibling cells in the same group have
 *                 different protocols)
 *
 * The chip is a single button — keep this primitive small so it can sit
 * inside breadcrumbs, table cells, tooltips, and the cell drawer header
 * without restyling.
 */

import * as React from 'react';
import { ListChecks, Plus, TriangleAlert } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useAttachProtocol } from './useAttachProtocol';
import type { OpenAttachProtocolOptions, OpenEndedProtocolSegment } from './types';

export interface ProtocolStatusChipProps {
  protocolName?: string | null;
  segments?: OpenEndedProtocolSegment[] | null;
  /** When provided, clicking the chip opens the wizard scoped to these IDs. */
  cellIds?: string[];
  /** When true, render in amber to signal inter-cell disagreement. */
  mismatch?: boolean;
  /** Hide the click-to-attach affordance when there's no associated scope. */
  readOnly?: boolean;
  className?: string;
  /** Override label (e.g. "3 protocols" when summarising a group). */
  label?: string;
  /** Optional callback invoked after successful save. */
  onSaved?: OpenAttachProtocolOptions['onSaved'];
  /** Size preset; ``sm`` is the table-cell default, ``md`` for headers. */
  size?: 'sm' | 'md';
}

export function ProtocolStatusChip({
  protocolName,
  segments,
  cellIds,
  mismatch = false,
  readOnly = false,
  className,
  label,
  onSaved,
  size = 'sm',
}: ProtocolStatusChipProps) {
  const { open } = useAttachProtocol();
  const hasProtocol = Boolean(protocolName) || (segments && segments.length > 0);
  const isClickable = !readOnly && (cellIds?.length ?? 0) > 0;

  const display =
    label ??
    (hasProtocol ? (protocolName || `${segments?.length ?? 0} segments`) : 'Attach protocol');

  const handleClick = () => {
    if (!isClickable) return;
    open({
      cellIds: cellIds ?? [],
      seedSegments: segments ?? undefined,
      seedName: protocolName ?? undefined,
      onSaved,
    });
  };

  const baseSize =
    size === 'md'
      ? 'h-7 px-2.5 text-xs'
      : 'h-6 px-2 text-[11px]';

  const colour = mismatch
    ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
    : hasProtocol
      ? 'border-emerald-200/70 bg-emerald-100 text-emerald-700 hover:bg-emerald-100/80 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground';

  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={handleClick}
      title={hasProtocol ? protocolName ?? undefined : 'Attach a cycling protocol'}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        'transition-colors',
        baseSize,
        colour,
        !isClickable && 'cursor-default opacity-90',
        className,
      )}
    >
      {mismatch ? (
        <TriangleAlert className="h-3 w-3" />
      ) : hasProtocol ? (
        <ListChecks className="h-3 w-3" />
      ) : (
        <Plus className="h-3 w-3" />
      )}
      <span className="max-w-[16rem] truncate">{display}</span>
    </button>
  );
}
