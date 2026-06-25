import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

const HEADER_LABEL_OVERRIDES: Record<string, string> = {
  cathode: 'Cathode',
  anode: 'Anode',
  separator: 'Separator',
  spacer: 'Spacer',
  electrolyte: 'Electrolyte',
};

// eslint-disable-next-line react-refresh/only-export-components
export function displayHeader(header: string): string {
  const norm = header.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (norm === 'repeat' || norm === 'cell' || norm === 'cell id' || norm === 'cell_id') return 'Cell';
  return HEADER_LABEL_OVERRIDES[norm] ?? header;
}

/** One draggable hierarchy chip. Drag is bound to the ⠿ handle only, so clicking
 *  the × (remove) or the chip body never starts a drag. */
function SortableChip({
  j,
  index,
  label,
  onRemove,
}: {
  j: number;
  index: number;
  label: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: j,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : undefined,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] select-none whitespace-nowrap border bg-primary text-primary-foreground border-primary/80"
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag ${label} to reorder`}
        title="Drag to reorder"
        style={{ fontSize: 11, opacity: 0.6, cursor: 'grab', touchAction: 'none' }}
      >
        ⠿
      </span>
      <span className="text-[8px] font-semibold px-1 py-0.5 rounded bg-primary-foreground/20 shrink-0">
        {index + 1}
      </span>
      <span>{label}</span>
      <span
        className="ml-0.5 shrink-0 cursor-pointer text-xs leading-none opacity-60 hover:opacity-100"
        onClick={e => {
          e.stopPropagation();
          onRemove();
        }}
      >
        ×
      </span>
    </div>
  );
}

export function HierarchyEditor({
  allCandidates,
  activeJs,
  onChangeOrder,
  onReset,
}: HierarchyEditorProps) {
  const statsByJ = Object.fromEntries(allCandidates.map(c => [c.j, c]));
  const activeSet = new Set(activeJs);
  const pool = allCandidates.filter(c => !activeSet.has(c.j));

  // distance constraint: a small drag threshold so the × / add clicks still fire
  // as plain clicks instead of being swallowed as drag starts.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = activeJs.indexOf(Number(active.id));
    const newIndex = activeJs.indexOf(Number(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChangeOrder(arrayMove(activeJs, oldIndex, newIndex));
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 rounded-md border border-border bg-muted/50">
      {/* Label row with help tooltip */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-[11px] font-medium tracking-wider uppercase text-muted-foreground">Hierarchy order</span>
          <span className="ml-1.5 text-[8.5px] text-muted-foreground/55 font-normal"> · drag to reorder</span>
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap min-h-[28px]">
        {/* Active chips — flexible drag-to-reorder via @dnd-kit */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={activeJs} strategy={horizontalListSortingStrategy}>
            <div className="flex items-center flex-wrap gap-1.5">
              {activeJs.map((j, idx) => {
                const col = statsByJ[j];
                if (!col) return null;
                return (
                  <SortableChip
                    key={j}
                    j={j}
                    index={idx}
                    label={displayHeader(col.header)}
                    onRemove={() => onChangeOrder(activeJs.filter((_, i) => i !== idx))}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>

        {/* Separator */}
        <div className="shrink-0 w-px h-5 bg-border" />

        {/* Pool */}
        <span className="shrink-0 whitespace-nowrap">
          <span className="text-[8px] tracking-wider uppercase text-muted-foreground">Available</span>
          <span className="ml-1 text-[8px] text-muted-foreground/55 font-normal"> · click to add</span>
        </span>
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

        {/* Reset */}
        <button
          className="ml-auto shrink-0 rounded-md px-2 py-1 text-[9px] tracking-wide cursor-pointer border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={onReset}
        >
          ↺ reset
        </button>
      </div>
    </div>
  );
}
