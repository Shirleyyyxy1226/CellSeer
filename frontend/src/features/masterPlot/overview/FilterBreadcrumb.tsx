/**
 * Active-filter breadcrumb. Shows the current cathode/separator/
 * spacer filters and the active selection as removable chips, plus Clear all —
 * so a user who drills in can see and retrace what they did. Renders nothing
 * when no filter or selection is active.
 */
import { X } from 'lucide-react';

export interface BreadcrumbChip {
  /** Short label, e.g. "Cathode". */
  label: string;
  /** Active value; the chip is hidden when this equals `cleared`. */
  value: string;
  /** Value that means "no filter" (default 'All'). */
  cleared?: string;
  onClear: () => void;
}

export function FilterBreadcrumb({
  chips,
  selectionCount,
  onClearSelection,
  onClearAll,
}: {
  chips: BreadcrumbChip[];
  selectionCount: number;
  onClearSelection: () => void;
  onClearAll: () => void;
}) {
  const active = chips.filter((c) => c.value !== (c.cleared ?? 'All'));
  if (active.length === 0 && selectionCount === 0) return null;

  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-[11px] uppercase tracking-wide font-semibold text-foreground">Filters</span>
      {active.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onClear}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-primary hover:bg-primary/25 transition-colors"
          title={`Clear ${c.label} filter`}
        >
          <span className="text-primary/70">{c.label}:</span>
          <span className="font-semibold">{c.value}</span>
          <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
      {selectionCount > 0 && (
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2.5 py-0.5 text-primary hover:bg-primary/25 transition-colors"
          title="Clear selection"
        >
          {selectionCount} selected
          <X className="h-3 w-3" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={onClearAll}
        className="ml-1 text-[11px] text-primary/70 underline-offset-2 hover:text-primary hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}
