import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { Announcements, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { optionColorClass } from '../../lib/optionColors';
import { cardMoveNewValue } from '../../lib/viewData';
import type { BoardColumn } from '../../lib/viewData';
import type { OptionColor, PageRecord, PropertyRecord } from '../../api/types';

// ── Drag announcements ────────────────────────────────────────────────────────

/** Builds accessible live-region announcements for board card drags. */
function buildBoardAnnouncements(columns: BoardColumn[]): Announcements {
  const describeColumn = (optionId: string | null) => {
    const col = columns.find((c) => c.optionId === optionId);
    return col?.label ?? 'a column';
  };

  return {
    onDragStart: ({ active }: DragStartEvent) =>
      `Picked up card "${String(active.id)}". Drag over a column to move it.`,
    onDragOver: ({ active, over }: DragEndEvent) =>
      over
        ? `Card "${String(active.id)}" is over the "${describeColumn(over.id === 'uncat' ? null : String(over.id))}" column.`
        : `Card "${String(active.id)}" is not over a column.`,
    onDragEnd: ({ active, over }: DragEndEvent) =>
      over
        ? `Moved "${String(active.id)}" to "${describeColumn(over.id === 'uncat' ? null : String(over.id))}".`
        : `Card "${String(active.id)}" was dropped outside a column and stayed in place.`,
    onDragCancel: ({ active }: DragEndEvent) => `Cancelled moving "${String(active.id)}".`,
  };
}

// ── Draggable card ────────────────────────────────────────────────────────────

interface BoardCardProps {
  row: PageRecord;
  /** Whether this card is being dragged (hidden when the DragOverlay is active). */
  isDragging?: boolean;
  onOpen: (rowId: string) => void;
}

/**
 * A single board card. Uses `useDraggable` so it can be lifted into a DragOverlay
 * and dropped on any column. The card is keyboard-reachable via the drag handle role.
 */
function BoardCard({ row, isDragging, onOpen }: BoardCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: row.id });

  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2.5 shadow-sm transition-opacity',
        isDragging && 'opacity-0',
      )}
      data-testid="board-card"
      data-row-id={row.id}
    >
      {/* Drag handle — keyboard-draggable, separate from the click-to-open button */}
      <button
        type="button"
        aria-label={`Drag "${row.title}"`}
        className="flex min-h-9 min-w-9 cursor-grab touch-none items-center justify-center rounded-sm text-text-muted/50 hover:bg-surface-hover hover:text-text-muted active:cursor-grabbing"
        {...listeners}
        {...attributes}
      >
        <span aria-hidden className="text-xs leading-none">
          ⠿
        </span>
      </button>

      {/* Title button — opens the row page */}
      <button
        type="button"
        className="min-w-0 flex-1 text-left text-sm font-medium text-text hover:text-blue-fg"
        onClick={() => onOpen(row.id)}
      >
        <span className="mr-1.5 font-emoji text-xs" aria-hidden>
          {row.icon}
        </span>
        <span className="truncate">{row.title}</span>
      </button>
    </div>
  );
}

// ── Droppable column ──────────────────────────────────────────────────────────

interface BoardColumnCardProps {
  column: BoardColumn;
  /** The card id currently being dragged, so we can hide its ghost in this column. */
  draggingId: string | null;
  onOpenRow: (rowId: string) => void;
  onCreateRow: () => void;
}

/**
 * One board column. The entire column is a `useDroppable` target so cards can be dropped
 * anywhere in the column, not just on existing cards. The uncategorised column uses the
 * synthetic id "uncat" so it has a stable droppable id.
 */
function BoardColumnCard({ column, draggingId, onOpenRow, onCreateRow }: BoardColumnCardProps) {
  // Synthetic id for the uncategorised column avoids null in dnd-kit identifiers.
  const droppableId = column.optionId ?? 'uncat';
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  return (
    <div
      className="flex w-[min(260px,80vw)] flex-shrink-0 flex-col gap-2"
      data-testid="board-column"
      data-column-id={droppableId}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-1">
        {column.color ? (
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
              optionColorClass(column.color as OptionColor),
            )}
          >
            {column.label}
          </span>
        ) : (
          <span className="text-xs font-medium text-text-muted">{column.label}</span>
        )}
        <span className="ml-auto text-xs text-text-muted">{column.rows.length}</span>
      </div>

      {/* Drop zone: expands to fill available height so a drop is easy even in empty columns */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-h-[120px] flex-col gap-2 rounded-lg border-2 p-2 transition-colors',
          isOver ? 'border-blue/60 bg-blue/5' : 'border-transparent bg-surface/40',
        )}
      >
        {column.rows.map((row) => (
          <BoardCard key={row.id} row={row} isDragging={row.id === draggingId} onOpen={onOpenRow} />
        ))}
      </div>

      {/* Add card button — always at the bottom of each column */}
      <button
        type="button"
        className="flex min-h-10 w-full items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
        onClick={onCreateRow}
        aria-label={`Add card to ${column.label}`}
      >
        <Plus size={13} aria-hidden />
        Add card
      </button>
    </div>
  );
}

// ── Drag overlay card ─────────────────────────────────────────────────────────

interface DragOverlayCardProps {
  row: PageRecord | undefined;
}

/** The floating card shown during a drag. No interaction — display only. */
function DragOverlayCard({ row }: DragOverlayCardProps) {
  if (!row) return null;
  return (
    <div className="flex min-h-12 cursor-grabbing items-center gap-2 rounded-md border border-border bg-surface px-3 py-2.5 opacity-95 shadow-pop">
      <span className="mr-0.5 font-emoji text-xs" aria-hidden>
        {row.icon}
      </span>
      <span className="text-sm font-medium text-text">{row.title}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface BoardViewProps {
  /** Pre-grouped columns. Produced by `groupRows()` in the calling screen. */
  columns: BoardColumn[];
  /** All rows in this database (unfiltered), needed to find a card after drag-end. */
  allRows: PageRecord[];
  /** The select property used for grouping; null means no property is set yet. */
  groupProperty: PropertyRecord | null;
  onSelectRow: (rowPageId: string) => void;
  /** Creates a new row (returns its id or null on failure). */
  onCreateRow: () => Promise<string | null>;
  /** Called on a successful card drop with the row and the new raw JSON value. */
  onSetValue: (args: { rowPageId: string; propertyId: string; value: string | null }) => void;
}

/**
 * Board view: one column per select option, plus a trailing uncategorised column. Cards are
 * draggable between columns with @dnd-kit/core; a drop writes a `value.set` op on the group
 * property so the move shows in the table view and survives a refresh (criterion 3).
 *
 * The board scrolls horizontally on narrow screens so the column layout always has room to
 * breathe without horizontal overflow on the page itself.
 */
export function BoardView({
  columns,
  allRows,
  groupProperty,
  onSelectRow,
  onCreateRow,
  onSetValue,
}: BoardViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setDraggingId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null);
    if (!over || !groupProperty) return;

    const rowId = String(active.id);
    // Translate the synthetic "uncat" droppable id back to null.
    const targetOptionId = over.id === 'uncat' ? null : String(over.id);

    // Find the column the card was dragged FROM to avoid a no-op write.
    const sourceColumn = columns.find((c) => c.rows.some((r) => r.id === rowId));
    if (sourceColumn?.optionId === targetOptionId) return;

    // Write the card's new group-property value. cardMoveNewValue handles null → null.
    onSetValue({
      rowPageId: rowId,
      propertyId: groupProperty.id,
      value: cardMoveNewValue(targetOptionId),
    });
  };

  const draggingRow = draggingId ? allRows.find((r) => r.id === draggingId) : undefined;

  if (!groupProperty) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border-2 border-dashed border-border p-6 text-sm text-text-muted">
        Pick a Select property to group by using the Filter / Sort control above.
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements: buildBoardAnnouncements(columns) }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      {/* Horizontal scroll container — allows the board to extend past the viewport on narrow
          screens while preventing overflow on the containing page. */}
      <div
        className="flex gap-4 overflow-x-auto pb-4"
        style={{ WebkitOverflowScrolling: 'touch' }}
        data-testid="board-view"
      >
        {columns.map((col) => (
          <BoardColumnCard
            key={col.optionId ?? 'uncat'}
            column={col}
            draggingId={draggingId}
            onOpenRow={onSelectRow}
            onCreateRow={() => void onCreateRow()}
          />
        ))}
      </div>

      {/* DragOverlay renders the floating card at the pointer during a drag. */}
      <DragOverlay>
        <DragOverlayCard row={draggingRow} />
      </DragOverlay>
    </DndContext>
  );
}
