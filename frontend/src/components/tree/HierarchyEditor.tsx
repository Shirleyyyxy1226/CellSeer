import { useRef, useState } from 'react';

/** Minimal shape: j, header, cardinality, isNumeric (from API or treeUtils) */
interface ColCandidate {
  j: number;
  header: string;
  cardinality?: number;
  isNumeric?: boolean;
}

interface HierarchyEditorProps {
  allCandidates: ColCandidate[];
  activeJs: number[];
  onChangeOrder: (newJs: number[]) => void;
  onReset: () => void;
}

function displayHeader(header: string): string {
  if (header.trim().toLowerCase() === 'repeat') return 'Cell';
  return header;
}

export function HierarchyEditor({
  allCandidates,
  activeJs,
  onChangeOrder,
  onReset,
}: HierarchyEditorProps) {
  const dragSrcIdx = useRef<number | null>(null);
  const [dropOverIdx, setDropOverIdx] = useState<number | null>(null);

  const statsByJ = Object.fromEntries(allCandidates.map(c => [c.j, c]));
  const activeSet = new Set(activeJs);
  const pool = allCandidates.filter(c => !activeSet.has(c.j));

  function handleDrop(targetIdx: number) {
    const src = dragSrcIdx.current;
    if (src === null || src === targetIdx) return;
    const next    = [...activeJs];
    const [moved] = next.splice(src, 1);
    const insertAt = targetIdx > src ? targetIdx - 1 : targetIdx;
    next.splice(insertAt, 0, moved);
    onChangeOrder(next);
    dragSrcIdx.current = null;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap min-h-[38px] px-3 py-2 rounded-md border border-border bg-muted/50">
      {/* Label */}
      <span className="shrink-0 whitespace-nowrap text-[9px] font-medium tracking-wider uppercase text-muted-foreground">
        Hierarchy order
      </span>

      {/* Active chips */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {activeJs.map((j, i) => {
          const col = statsByJ[j];
          if (!col) return null;
          const isDropTarget = dropOverIdx === i;
          return (
            <div
              key={j}
              draggable
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] select-none whitespace-nowrap cursor-grab border transition-colors ${
                isDropTarget
                  ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
                  : 'bg-primary text-primary-foreground border-primary/80'
              }`}
              onDragStart={e => {
                dragSrcIdx.current = i;
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={() => {
                dragSrcIdx.current = null;
                setDropOverIdx(null);
              }}
              onDragOver={e => {
                e.preventDefault();
                setDropOverIdx(i);
              }}
              onDragLeave={() => setDropOverIdx(null)}
              onDrop={e => {
                e.preventDefault();
                setDropOverIdx(null);
                handleDrop(i);
              }}
            >
              <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-primary-foreground/20 shrink-0">
                {i + 1}
              </span>
              <span>{displayHeader(col.header)}</span>
              <span
                className="ml-0.5 shrink-0 cursor-pointer text-xs leading-none opacity-60 hover:opacity-100"
                onClick={e => {
                  e.stopPropagation();
                  onChangeOrder(activeJs.filter((_, idx) => idx !== i));
                }}
              >
                ×
              </span>
            </div>
          );
        })}
      </div>

      {/* Separator */}
      <div className="shrink-0 w-px h-5 bg-border" />

      {/* Pool label */}
      <span className="shrink-0 whitespace-nowrap text-[8px] tracking-wider uppercase text-muted-foreground">
        Available
      </span>

      {/* Pool chips */}
      <div className="flex gap-1.5 flex-wrap items-center">
        {pool.map(col => (
          <div
            key={col.j}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] select-none whitespace-nowrap cursor-pointer border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted hover:text-foreground hover:border-muted-foreground/60 transition-colors"
            title={(col.isNumeric ? 'numeric · ' : '') + col.cardinality + ' distinct values'}
            onClick={() => onChangeOrder([...activeJs, col.j])}
          >
            {displayHeader(col.header)}
          </div>
        ))}
      </div>

      {/* Reset button */}
      <button
        className="ml-auto shrink-0 rounded-md px-2 py-1 text-[9px] tracking-wide cursor-pointer border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        onClick={onReset}
      >
        ↺ reset
      </button>
    </div>
  );
}
