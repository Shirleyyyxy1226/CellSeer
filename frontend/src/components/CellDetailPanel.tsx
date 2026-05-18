import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { X } from 'lucide-react';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { fetchCellRecordIndex, putCellAnnotation } from '@/lib/api';

interface CellMeta {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
}

const PRESET_TAGS = ['Review', 'Exclude', 'Best', 'Anomaly', 'Repeat'];

export function CellDetailPanel() {
  const { selectedCellIds, multiselectionMode, annotationsByCell, refetchAnnotations, clearSelection } =
    useCellSelection();
  const [cellIndex, setCellIndex] = useState<CellMeta[]>([]);
  const [localNote, setLocalNote] = useState<string>('');
  const [localTags, setLocalTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchCellRecordIndex()
      .then((d) => { if (d?.cells) setCellIndex(d.cells as CellMeta[]); })
      .catch(() => {});
  }, []);

  const selectedCells = useMemo(() => {
    if (selectedCellIds.length === 0) return [];
    const byId = new Map(cellIndex.map((c) => [c.idNo, c]));
    return selectedCellIds
      .map((id) => byId.get(id))
      .filter(Boolean) as CellMeta[];
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
  }, [singleCell, selectedCellIds, annotationsByCell]);

  const handleSave = useCallback(async () => {
    if (selectedCellIds.length === 0) return;
    setSaving(true);
    try {
      for (const idNo of selectedCellIds) {
        const body: { note?: string; tags?: string[] } = { tags: localTags };
        if (singleCell && singleCell.idNo === idNo) {
          body.note = localNote;
        }
        await putCellAnnotation(idNo, body);
      }
      await refetchAnnotations();
      clearSelection();
    } finally {
      setSaving(false);
    }
  }, [selectedCellIds, singleCell, localNote, localTags, refetchAnnotations, clearSelection]);

  const toggleTag = useCallback(
    (tag: string) => {
      setLocalTags((prev) =>
        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
      );
    },
    []
  );


  if (selectedCellIds.length === 0) return null;
  // When multiselection mode is on, selection is used as chart filter — don't show this panel
  if (multiselectionMode) return null;

  return (
    <div className="h-full w-full min-w-0 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h3 className="font-semibold text-sm">
          Cell details
          {selectedCellIds.length > 1 && (
            <span className="ml-1 text-muted-foreground font-normal">
              ({selectedCellIds.length} selected)
            </span>
          )}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={clearSelection}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {singleCell ? (
          <>
            <div className="space-y-2">
              <div className="text-sm font-medium">{singleCell.cellName}</div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Cathode: {singleCell.cathode}</div>
                <div>Separator: {singleCell.separatorType}</div>
                <div>Spacer: {singleCell.spacerMm ?? '—'} mm</div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Note</Label>
              <Textarea
                placeholder="Add a note..."
                value={localNote}
                onChange={(e) => setLocalNote(e.target.value)}
                className="min-h-[80px] text-sm"
              />
            </div>
          </>
        ) : selectedCells.length > 0 ? (
          <div className="space-y-2">
            <Label className="text-xs">Selected cells</Label>
            <ul className="text-sm space-y-1">
              {selectedCells.map((c) => (
                <li key={c.idNo}>
                  {c.cellName} ({c.cathode})
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Cell {selectedCellIds.join(', ')} selected.</p>
            <p className="text-xs">Metadata not found in index. Tags and notes can still be edited below.</p>
          </div>
        )}
        <div className="space-y-2">
          <Label className="text-xs">Tags</Label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_TAGS.map((tag) => (
              <Button
                key={tag}
                variant={localTags.includes(tag) ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {localTags
              .filter((t) => !PRESET_TAGS.includes(t))
              .map((tag) => (
                <Button
                  key={tag}
                  variant="secondary"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => toggleTag(tag)}
                >
                  {tag} <X className="h-3 w-3" />
                </Button>
              ))}
          </div>
        </div>
      </div>
      <div className="p-4 border-t border-border">
        <Button
          className="w-full"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
