/**
 * Right-side cell-detail sidebar. Renders when exactly one cell is selected
 * and the user is not in multi-select mode (gated by `showRightPanel` in
 * `pages/Index.tsx`).
 *
 * The body delegates to the shared {@link CellMetadataCard} so the surface
 * stays in lock-step with the project-upload row drawer: metadata grid,
 * protocol chip, cycling-file attach, and inline metadata edit are all the
 * same control here as on the project page.
 *
 * Note vs. tags: the bottom editor's **note** is the single source of truth on
 * the cell row — `cell.notes` (the metadata-sheet column) — written via
 * `PATCH /api/cells/{cellId}`, the same field shown in `CellMetadataCard`'s
 * NOTES section and editable from its "Edit metadata" mode. **Tags** are the
 * only thing that lives in the separate annotation store
 * (`/api/cell-annotation/{cellId}`), keyed off `cell_id`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Check, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CellMetadataCard } from '@/components/CellMetadataCard';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useToast } from '@/hooks/use-toast';
import { deleteCell, putCellAnnotation, updateCellMetadata } from '@/lib/api';
import { useCellRecordIndexQuery } from '@/hooks/useCellData';
import type { IndexCell } from '@/lib/cell/cellTypes';
import { TAG_CATALOG } from '@/lib/cell/cellTags';

type IndexStatus = 'loading' | 'loaded' | 'error';

const PRESET_TAG_IDS = TAG_CATALOG.map((t) => t.id);

export function CellDetailPanel() {
  const {
    selectedCellIds,
    multiselectionMode,
    annotationsByCell,
    refetchAnnotations,
    dismissDetailPanel,
    clearSelection,
  } = useCellSelection();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Structural changes (metadata edit, file upload, protocol attach) still bump
  // the global dataVersion so every view refetches. Saving a note/tag does not,
  // to avoid remounting the hierarchy sidebar (see handleSave).
  const { triggerDataRefresh } = useDataRefresh();
  const { data: indexData, isLoading: indexLoading, isError: indexError } = useCellRecordIndexQuery();
  const cellIndex = (indexData?.cells ?? []) as IndexCell[];
  const indexStatus: IndexStatus = indexLoading ? 'loading' : indexError ? 'error' : 'loaded';
  const [localNote, setLocalNote] = useState<string>('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectedCells = useMemo(() => {
    if (selectedCellIds.length === 0) return [];
    const byId = new Map(cellIndex.map((c) => [c.idNo, c]));
    return selectedCellIds.map((id) => byId.get(id)).filter(Boolean) as IndexCell[];
  }, [selectedCellIds, cellIndex]);

  const singleCell = selectedCells.length === 1 ? selectedCells[0] : null;

  useEffect(() => {
    if (singleCell) {
      // Note is the cell-row `cell.notes` field (single source of truth, same
      // value shown in CellMetadataCard's NOTES); tags come from the annotation store.
      setLocalNote(singleCell.notes ?? '');
      setLocalTags(annotationsByCell[singleCell.idNo]?.tags ?? []);
    } else if (selectedCells.length > 1) {
      setLocalNote('');
      const tagSet = new Set<string>();
      selectedCellIds.forEach((id) => {
        (annotationsByCell[id]?.tags ?? []).forEach((t) => tagSet.add(t));
      });
      setLocalTags(Array.from(tagSet));
    } else {
      setLocalNote('');
      setLocalTags([]);
    }
  }, [singleCell, selectedCellIds, annotationsByCell, selectedCells.length]);

  const handleSave = useCallback(async () => {
    if (selectedCells.length === 0) {
      if (indexStatus === 'loading') {
        setSaveError('Still loading cell info — try again in a moment.');
      } else {
        setSaveError("This cell isn't in the metadata index, so notes/tags can't be saved.");
      }
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      for (const cell of selectedCells) {
        if (!cell.cellId) continue;
        // Tags live in the annotation store (all selected cells).
        await putCellAnnotation(cell.cellId, { tags: localTags });
        // Note writes through to the cell-row `cell.notes` column — only for the
        // single focused cell, since that field is per-cell metadata.
        if (singleCell && singleCell.idNo === cell.idNo) {
          await updateCellMetadata(cell.cellId, { notes: localNote });
        }
      }
      // Close the panel for prompt feedback, but keep the selection so any
      // selection-driven plots (e.g. dQ/dV, dV/dQ) stay rendered for the
      // cell the user just annotated. Refetch tags, and invalidate only the
      // cell index (which carries `cell.notes`) so it refreshes in place. A
      // global dataVersion bump would change every query key and briefly empty
      // the cell index, remounting the hierarchy sidebar and losing its
      // expand/scroll state.
      dismissDetailPanel();
      void refetchAnnotations();
      void queryClient.invalidateQueries({ queryKey: ['cell-record-index'] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save annotation.');
    } finally {
      setSaving(false);
    }
  }, [
    selectedCells,
    singleCell,
    localNote,
    localTags,
    refetchAnnotations,
    dismissDetailPanel,
    queryClient,
    indexStatus,
  ]);

  const handleDelete = useCallback(async () => {
    if (!singleCell?.cellId) return;
    setDeleting(true);
    try {
      await deleteCell(singleCell.cellId);
      setPendingDelete(false);
      // The cell is gone from every view — drop it from the selection, close the
      // panel, and bump dataVersion so index / rate / master-plot all refetch.
      clearSelection();
      dismissDetailPanel();
      triggerDataRefresh();
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Could not delete the cell.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  }, [singleCell, clearSelection, dismissDetailPanel, triggerDataRefresh, toast]);

  const toggleTag = useCallback((tag: string) => {
    setLocalTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  if (selectedCellIds.length === 0) return null;
  // Multi-select mode reuses the selection as a chart filter — the per-cell
  // editor surface doesn't make sense there.
  if (multiselectionMode) return null;

  return (
    <div className="h-full w-full min-w-0 flex flex-col">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-semibold text-sm">
            Cell details
            {selectedCellIds.length > 1 && (
              <span className="ml-1 text-muted-foreground font-normal">
                ({selectedCellIds.length} selected)
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {singleCell && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => setPendingDelete(true)}
              aria-label={`Delete cell ${singleCell.cellName || singleCell.cellId || singleCell.idNo}`}
              title="Delete cell"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={dismissDetailPanel}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {singleCell ? (
          <CellMetadataCard
            cell={singleCell}
            layout="narrow"
            onCellMetadataUpdated={triggerDataRefresh}
            onTestFileUploaded={triggerDataRefresh}
            onProtocolAttached={triggerDataRefresh}
          />
        ) : selectedCells.length > 1 ? (
          <div className="space-y-2">
            <Label className="text-xs">Selected cells</Label>
            <ul className="text-sm space-y-1">
              {selectedCells.map((c) => (
                <li key={c.idNo}>
                  {c.cellName} ({c.cathode || '—'})
                </li>
              ))}
            </ul>
          </div>
        ) : indexStatus === 'loading' ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Loading cell info…</p>
            <p className="text-xs">
              Cell {selectedCellIds.join(', ')} selected — fetching metadata.
            </p>
          </div>
        ) : indexStatus === 'error' ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Couldn't load the cell index.</p>
            <p className="text-xs">
              Notes and tags can't be saved until the metadata loads. Try refreshing.
            </p>
          </div>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Cell {selectedCellIds.join(', ')} isn't in the metadata index.</p>
            <p className="text-xs">Notes and tags can't be saved for this cell.</p>
          </div>
        )}

        {/* Note writes through to the cell-row `cell.notes` (same field as the
            metadata card's NOTES); tags are stored per cell_id in the annotation store. */}
        <div className="space-y-3 pt-3 border-t border-border/60">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Note &amp; tags
          </div>
          {singleCell && (
            <div className="space-y-2">
              <Label className="text-xs">Note</Label>
              <Textarea
                placeholder="Add a note…"
                value={localNote}
                onChange={(e) => setLocalNote(e.target.value)}
                className="min-h-[72px] text-sm"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-xs">Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {TAG_CATALOG.map((cfg) => {
                const active = localTags.includes(cfg.id);
                const Icon = cfg.icon;
                return (
                  <Tooltip key={cfg.id} delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleTag(cfg.id)}
                        aria-pressed={active}
                        className="group inline-flex items-center gap-1 rounded-full border h-7 px-2 text-xs font-medium transition-colors"
                        style={
                          active
                            ? {
                                background: cfg.bg,
                                color: cfg.fg,
                                borderColor: cfg.outline,
                              }
                            : {
                                background: 'transparent',
                                color: 'hsl(var(--muted-foreground))',
                                borderColor: 'hsl(var(--border))',
                              }
                        }
                      >
                        <Icon
                          className="h-3.5 w-3.5"
                          style={active ? { color: cfg.fg } : undefined}
                          aria-hidden
                        />
                        <span>{cfg.label}</span>
                        {active && <Check className="h-3 w-3 opacity-70" aria-hidden />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px]">
                      <p className="text-xs leading-snug">
                        <span className="font-medium">{cfg.label}</span>
                        {' — '}
                        {cfg.description}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
            {/* Free-form / legacy tags that aren't in the catalog */}
            {localTags.some((t) => !PRESET_TAG_IDS.includes(t)) && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {localTags
                  .filter((t) => !PRESET_TAG_IDS.includes(t))
                  .map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className="inline-flex items-center gap-1 rounded-full bg-muted h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {tag}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="p-3 border-t border-border space-y-2">
        {saveError && (
          <p className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        )}
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={saving || selectedCells.length === 0}
          title={
            selectedCells.length === 0
              ? indexStatus === 'loading'
                ? 'Loading cell info…'
                : "This cell isn't in the metadata index"
              : 'Save note and tags'
          }
        >
          {saving
            ? 'Saving…'
            : selectedCells.length === 0 && indexStatus === 'loading'
              ? 'Loading…'
              : 'Save note & tags'}
        </Button>
      </div>

      <Dialog
        open={pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete cell?</DialogTitle>
            <DialogDescription>
              {singleCell
                ? `"${singleCell.cellName || singleCell.cellId || `Cell ${singleCell.idNo}`}" and its data will be removed from this project. This cannot be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete cell'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
