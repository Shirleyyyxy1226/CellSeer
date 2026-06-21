/**
 * Step 1 of the attach-protocol wizard.
 *
 * Shows the currently-scoped cell IDs as removable chips, and offers a
 * searchable picker to add more cells from the active project.
 *
 * Design intent: keep this step lightweight — we don't reproduce the full
 * hierarchy tree here. Most invocations come from a single-cell entry point
 * (drawer chip, master-plot tooltip), so the scope step is usually just a
 * "confirm" gate. For multi-cell flows the search-add affordance is enough
 * to reach project scale; full tree-based group selection is a v2 concern.
 */

import * as React from 'react';
import { Plus, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { fetchCellRecordIndex, type IndexCellRaw } from '@/lib/api';

export interface ScopeStepProps {
  cellIds: string[];
  onChange: (next: string[]) => void;
}

export function ScopeStep({ cellIds, onChange }: ScopeStepProps) {
  const [cells, setCells] = React.useState<IndexCellRaw[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [pickerOpen, setPickerOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCellRecordIndex();
        if (!cancelled) setCells(res.cells ?? []);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load cells');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = React.useMemo(() => new Set(cellIds), [cellIds]);

  const cellsById = React.useMemo(() => {
    const map = new Map<string, IndexCellRaw>();
    for (const c of cells ?? []) {
      if (c.cellId) map.set(c.cellId, c);
    }
    return map;
  }, [cells]);

  const candidates = React.useMemo(() => {
    if (!cells) return [];
    const q = query.trim().toLowerCase();
    return cells
      .filter((c) => !selected.has(c.cellId))
      .filter((c) => {
        if (!q) return true;
        return (
          c.cellId.toLowerCase().includes(q) ||
          (c.cellName ?? '').toLowerCase().includes(q) ||
          String(c.idNo).includes(q)
        );
      })
      .slice(0, 100);
  }, [cells, selected, query]);

  const addCell = (id: string) => {
    if (!id || selected.has(id)) return;
    onChange([...cellIds, id]);
  };

  const removeCell = (id: string) => {
    onChange(cellIds.filter((c) => c !== id));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Selected cells</h3>
        <p className="text-xs text-muted-foreground">
          {cellIds.length === 0
            ? 'No cells selected yet. Add at least one to continue.'
            : `${cellIds.length} cell${cellIds.length === 1 ? '' : 's'} selected.`}
        </p>
      </div>

      <div
        className={cn(
          'min-h-[80px] rounded-md border border-border bg-muted/20 p-2',
          cellIds.length === 0 && 'flex items-center justify-center text-xs text-muted-foreground',
        )}
      >
        {cellIds.length === 0 ? (
          <span>No cells in scope.</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {cellIds.map((id) => {
              const cell = cellsById.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                >
                  <span className="font-medium">{cell?.cellName || id}</span>
                  {cell?.idNo != null && cell.idNo > 0 && (
                    <span className="text-[10px] text-muted-foreground">#{cell.idNo}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeCell(id)}
                    className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Remove from scope"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!cells && !loadError}
          >
            <Plus className="h-4 w-4" />
            Add cell
            {cells && (
              <span className="text-[10px] text-muted-foreground">
                ({cells.length - cellIds.length} available)
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by cell name or ID…"
                className="h-8 pl-7 text-sm"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {loadError && (
              <div className="p-2 text-xs text-destructive">{loadError}</div>
            )}
            {!loadError && cells && candidates.length === 0 && (
              <div className="p-3 text-xs text-muted-foreground">
                {query.trim() ? 'No matching cells.' : 'No more cells to add.'}
              </div>
            )}
            {candidates.map((c) => (
              <button
                key={c.cellId}
                type="button"
                onClick={() => {
                  addCell(c.cellId);
                  setQuery('');
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">
                    {c.cellName || c.cellId}
                  </span>
                  {c.cathode && (
                    <span className="text-[11px] text-muted-foreground">{c.cathode}</span>
                  )}
                </div>
                {c.protocolName ? (
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    has protocol
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">none</span>
                )}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
