/**
 * Tabular editor for the protocol "Sequence" step.
 *
 * End cycle: leave blank to run a stage until the test ends (open-ended).
 * C-rate: enter a decimal (0.1) or fraction (1/10); the "C" unit is shown
 * as a label suffix — no need to type it.
 */

import * as React from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { formatCRateInput, parseCRate } from './cRate';
import { makeBlankSegment, validateSequence } from './segmentUtils';
import type { EditableProtocolSegment } from './types';

export interface ProtocolSegmentEditorProps {
  segments: EditableProtocolSegment[];
  onChange: (next: EditableProtocolSegment[]) => void;
}

// Fixed column widths so header and rows always align.
const COLS = 'grid grid-cols-[1fr_5.5rem_6rem_7.5rem_2.25rem]';

export function ProtocolSegmentEditor({ segments, onChange }: ProtocolSegmentEditorProps) {
  const errors = React.useMemo(() => validateSequence(segments), [segments]);

  const update = (id: string, patch: Partial<EditableProtocolSegment>) =>
    onChange(segments.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => onChange(segments.filter((s) => s.id !== id));
  const append = () => onChange([...segments, makeBlankSegment(segments[segments.length - 1])]);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {/* Header */}
      <div className={cn(COLS, 'gap-2 border-b border-border bg-muted/30 px-3 py-2')}>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stage name</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start</span>
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">End</span>
          <span className="text-[10px] text-muted-foreground/50">blank = to end</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">C-rate</span>
          <span className="text-[10px] text-muted-foreground/50">0.1 or 1/10</span>
        </div>
        <span className="sr-only">Actions</span>
      </div>

      {/* Rows */}
      <div className="divide-y divide-border">
        {segments.length === 0 && (
          <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            No stages yet — add one below.
          </div>
        )}
        {segments.map((seg, idx) => (
          <SegmentRow
            key={seg.id}
            segment={seg}
            error={errors[idx]}
            onUpdate={(patch) => update(seg.id, patch)}
            onRemove={() => remove(seg.id)}
          />
        ))}
      </div>

      {/* Add row */}
      <button
        type="button"
        onClick={append}
        className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-border bg-transparent px-3 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
        Add stage
      </button>
    </div>
  );
}

interface SegmentRowProps {
  segment: EditableProtocolSegment;
  error: string;
  onUpdate: (patch: Partial<EditableProtocolSegment>) => void;
  onRemove: () => void;
}

function SegmentRow({ segment, error, onUpdate, onRemove }: SegmentRowProps) {
  // C-rate has its own draft so typing "0." mid-entry doesn't collapse to 0.
  const [cDraft, setCDraft] = React.useState(() => formatCRateInput(segment.cRate));
  React.useEffect(() => { setCDraft(formatCRateInput(segment.cRate)); }, [segment.cRate]);

  const commitCRate = () => {
    const parsed = parseCRate(cDraft);
    if (parsed != null) {
      onUpdate({ cRate: parsed });
      setCDraft(formatCRateInput(parsed));
    } else {
      setCDraft(formatCRateInput(segment.cRate));
    }
  };

  const openEnded = segment.cycleEnd == null;

  return (
    <div className={cn('px-3 py-2', error && 'bg-destructive/5')}>
      <div className={cn(COLS, 'items-center gap-2')}>
        {/* Name */}
        <Input
          value={segment.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="e.g. formation"
          className="h-8 text-sm"
        />

        {/* Start cycle */}
        <Input
          type="number"
          min={1}
          step={1}
          value={segment.cycleStart}
          onChange={(e) => {
            const n = Number(e.target.value);
            onUpdate({ cycleStart: Number.isFinite(n) ? Math.max(1, Math.floor(n)) : segment.cycleStart });
          }}
          className="h-8 text-sm"
        />

        {/* End cycle — blank means open-ended */}
        <Input
          type="number"
          min={segment.cycleStart}
          step={1}
          value={openEnded ? '' : (segment.cycleEnd ?? '')}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '' || raw === null) {
              onUpdate({ cycleEnd: null });
            } else {
              const n = Number(raw);
              onUpdate({ cycleEnd: Number.isFinite(n) && n > 0 ? Math.floor(n) : segment.cycleEnd });
            }
          }}
          placeholder="to end"
          className={cn('h-8 text-sm', openEnded && 'text-muted-foreground placeholder:text-muted-foreground/50')}
        />

        {/* C-rate with "C" suffix label */}
        <div className="flex items-center gap-1">
          <Input
            value={cDraft}
            onChange={(e) => setCDraft(e.target.value)}
            onBlur={commitCRate}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCRate(); } }}
            placeholder="0.1"
            className="h-8 min-w-0 flex-1 text-sm font-mono"
          />
          <span className="shrink-0 text-[13px] font-medium text-muted-foreground">C</span>
        </div>

        {/* Row actions */}
        <div className="flex items-center justify-end">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10" onClick={onRemove} title="Remove stage">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
