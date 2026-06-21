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
 * The note + tag store (`/api/cell-annotation/{cellId}`) is a **separate**
 * persistence layer from `cell.notes` (the metadata-sheet column). Both
 * coexist on purpose: `cell.notes` is what the upload sheet provides and
 * lives on the cell row; the annotation store is what users add ad-hoc in
 * the dashboard and is keyed off `cell_id`. This panel keeps the annotation
 * editor at the bottom so existing notes/tags aren't lost.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Check, X } from 'lucide-react';
import { CellMetadataCard } from '@/components/CellMetadataCard';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { putCellAnnotation } from '@/lib/api';
import { useCellRecordIndexQuery } from '@/hooks/useCellData';
import type { IndexCellRaw } from '@/lib/cellTypes';
import { TAG_CATALOG } from '@/lib/cellTags';

type IndexStatus = 'loading' | 'loaded' | 'error';

const PRESET_TAG_IDS = TAG_CATALOG.map((t) => t.id);

export function CellDetailPanel() {
  const {
    selectedCellIds,
    multiselectionMode,
    annotationsByCell,
    refetchAnnotations,
    dismissDetailPanel,
  } = useCellSelection();
  const { triggerDataRefresh } = useDataRefresh();
  const { data: indexData, isLoading: indexLoading, isError: indexError } = useCellRecordIndexQuery();
  const cellIndex = (indexData?.cells ?? []) as IndexCellRaw[];
  const indexStatus: IndexStatus = indexLoading ? 'loading' : indexError ? 'error' : 'loaded';
  const [localNote, setLocalNote] = useState<string>('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const selectedCells = useMemo(() => {
    if (selectedCellIds.length === 0) return [];
    const byId = new Map(cellIndex.map((c) => [c.idNo, c]));
    return selectedCellIds.map((id) => byId.get(id)).filter(Boolean) as IndexCellRaw[];
  }, [selectedCellIds, cellIndex]);

  const singleCell = selectedCells.length === 1 ? selectedCells[0] : null;

  useEffect(() => {
    if (singleCell) {
      const ann = annotationsByCell[singleCell.idNo];
      setLocalNote(ann?.note ?? '');
      setLocalTags(ann?.tags ?? []);
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
        const body: { note?: string; tags?: string[] } = { tags: localTags };
        if (singleCell && singleCell.idNo === cell.idNo) {
          body.note = localNote;
        }
        await putCellAnnotation(cell.cellId, body);
      }
      // Close the panel for prompt feedback, but keep the selection so any
      // selection-driven plots (e.g. dQ/dV, dV/dQ) stay rendered for the
      // cell the user just annotated. Annotations refetch in the background.
      dismissDetailPanel();
      void refetchAnnotations();
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
    indexStatus,
  ]);

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

        {/* Annotation section — note + tag store keyed on cell_id. Separate
            from the metadata `notes` column edited above. */}
        <div className="space-y-3 pt-3 border-t border-border/60">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Annotation
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
    </div>
  );
}
