/**
 * Cross-view brush bar. Appears when a brush is active in any view;
 * shows how many cells pass and offers "Filter to brush" (promote the brush
 * into a hard filter — the default is dim-only, this makes it stick) and Clear.
 */
import { Filter, X } from 'lucide-react';
import { useMasterPlotBridge } from '@/contexts/MasterPlotBridgeContext';

export function BrushBar({
  passingCount,
  onFilterToBrush,
}: {
  /** How many of the currently-shown cells pass the brush. */
  passingCount: number;
  /** Promote the brush into a sticky filter (then clears the brush). */
  onFilterToBrush: () => void;
}) {
  const { brushPassingIds, setBrushPassingIds } = useMasterPlotBridge();
  if (brushPassingIds == null) return null;

  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">
      <span className="font-medium text-primary">Brushed</span>
      <span className="text-muted-foreground">
        {passingCount} cell{passingCount === 1 ? '' : 's'} highlighted · others dimmed
      </span>
      <button
        type="button"
        onClick={onFilterToBrush}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-primary/40 px-2 py-0.5 text-primary hover:bg-primary/10"
      >
        <Filter className="h-3 w-3" /> Filter to brush
      </button>
      <button
        type="button"
        onClick={() => setBrushPassingIds(null, 'brushbar')}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" /> Clear
      </button>
    </div>
  );
}
