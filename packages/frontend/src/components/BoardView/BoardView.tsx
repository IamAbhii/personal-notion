import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type {
  Announcements,
  DragEndEvent,
  DragStartEvent,
  KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/cn';
import { optionColorClass } from '../../lib/optionColors';
import { cardMoveNewValue } from '../../lib/viewData';
import type { BoardColumn } from '../../lib/viewData';
import type { OptionColor, PageRecord, PropertyRecord } from '../../api/types';

// ── Keyboard coordinate getter ────────────────────────────────────────────────

/**
 * Custom keyboard coordinate getter for board views. ArrowLeft/ArrowRight move the dragged card
 * between columns; other keys are handled by the default sensor (ArrowUp/Down move within the
 * dragged item's current bounds). Returns the center of the target column's droppable rect.
 *
 * Without this, the KeyboardSensor has no reference points to navigate between columns because
 * column droppables are adjacent siblings, not a sortable list (DEF-077).
 */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) return;
  event.preventDefault();

  const { droppableContainers, droppableRects, over } = context;

  // Collect all droppable entries that have a known rect, sorted left-to-right by centre x.
  const sorted = [...droppableContainers.values()]
    .map((container) => {
      const rect = droppableRects.get(container.id);
      if (!rect) return null;
      return {
        id: container.id,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .sort((a, b) => a.cx - b.cx);

  if (sorted.length === 0) return;

  const currentIndex = sorted.findIndex((d) => d.id === over?.id);
  if (currentIndex === -1) {
    // Not yet over any column — navigate to the first one.
    const first = sorted[0];
    if (!first) return;
    return { x: first.cx, y: first.cy };
  }

  const delta = event.code === KeyboardCode.Right ? 1 : -1;
  const nextIndex = Math.max(0, Math.min(sorted.length - 1, currentIndex + delta));
  const next = sorted[nextIndex];
  const current = sorted[currentIndex];
  if (!next || !current || next.id === current.id) return;
  return { x: next.cx, y: next.cy };
};

// ── Drag announcements ────────────────────────────────────────────────────────

/**
 * Builds accessible live-region announcements for board card drags.
 * The card is named by its row title rather than its UUID (DEF-074).
 * The onDragEnd announcement is intentionally neutral ("Released over … column") rather than
 * claiming success, because the actual value.set op is async and may fail if offline (DEF-078).
 * Success or failure is announced by a separate notify call after the mutation settles.
 */
function buildBoardAnnouncements(columns: BoardColumn[], allRows: PageRecord[]): Announcements {
  const describeColumn = (optionId: string | null) => {
    const col = columns.find((c) => c.optionId === optionId);
    return col?.label ?? 'a column';
  };

  const cardTitle = (id: string | number) => {
    const row = allRows.find((r) => r.id === String(id));
    return row?.title ?? String(id);
  };

  return {
    onDragStart: ({ active }: DragStartEvent) =>
      `Picked up card "${cardTitle(active.id)}". Drag over a column to move it.`,
    onDragOver: ({ active, over }: DragEndEvent) =>
      over
        ? `Card "${cardTitle(active.id)}" is over the "${describeColumn(over.id === 'uncat' ? null : String(over.id))}" column.`
        : `Card "${cardTitle(active.id)}" is not over a column.`,
    onDragEnd: ({ active, over }: DragEndEvent) =>
      over
        ? `Released "${cardTitle(active.id)}" over the "${describeColumn(over.id === 'uncat' ? null : String(over.id))}" column.`
        : `Card "${cardTitle(active.id)}" was dropped outside a column and stayed in place.`,
    onDragCancel: ({ active }: DragEndEvent) => `Cancelled moving "${cardTitle(active.id)}".`,
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
    // role="listitem" pairs with the parent drop zone's role="list" (DEF-087).
    <div
      ref={setNodeRef}
      role="listitem"
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

      {/* Title button — opens the row page. flex + overflow-hidden lets the inner truncate span clip. */}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center overflow-hidden text-left text-sm font-medium text-text hover:text-blue-fg"
        onClick={() => onOpen(row.id)}
      >
        <span className="mr-1.5 flex-none font-emoji text-xs" aria-hidden>
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

  // Unique id for the column heading so role="region" can reference it (DEF-087).
  const headingId = `board-col-heading-${droppableId}`;

  return (
    // role="region" + aria-labelledby associates the column with its heading so a screen reader
    // can navigate between named columns (DEF-087).
    <div
      role="region"
      aria-labelledby={headingId}
      className="flex w-[min(260px,80vw)] flex-shrink-0 flex-col gap-2"
      data-testid="board-column"
      data-column-id={droppableId}
    >
      {/* Column header */}
      <div id={headingId} className="flex items-center gap-2 px-1">
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
        <span
          className="ml-auto text-xs text-text-muted"
          aria-label={`${column.rows.length} cards`}
        >
          {column.rows.length}
        </span>
      </div>

      {/* Drop zone: expands to fill available height so a drop is easy even in empty columns.
          role="list" so each card's role="listitem" is valid (DEF-087). */}
      <div
        ref={setNodeRef}
        role="list"
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
  /**
   * Optional notification callback. Called after a card move resolves to report the actual
   * outcome — success or failure — so the user is not misled by the neutral drag announcement
   * (DEF-078).
   */
  notify?: (message: string) => void;
}

/**
 * Board view: one column per select option, plus a trailing uncategorised column. Cards are
 * draggable between columns with @dnd-kit/core; a drop writes a `value.set` op on the group
 * property so the move shows in the table view and survives a refresh (criterion 3).
 *
 * Pointer-based collision detection (`pointerWithin`) is used so the drop target is determined
 * from where the pointer is, not from the overlay card rectangle (DEF-075).
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
  notify,
}: BoardViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // boardKeyboardCoordinates maps ArrowLeft/Right to adjacent column centres (DEF-077).
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
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

    const row = allRows.find((r) => r.id === rowId);
    const cardName = row?.title ?? rowId;
    const targetColumn = columns.find((c) => c.optionId === targetOptionId);
    const columnName = targetColumn?.label ?? 'No value';

    // Write the card's new group-property value. The announcement is neutral (DEF-078); we
    // notify the actual outcome after the async mutation settles.
    // Future: Phase 6 will apply this optimistically and queue the op durably, so the card
    // moves immediately and the notify fires on sync confirmation.
    void (async () => {
      try {
        await new Promise<void>((resolve, reject) => {
          try {
            onSetValue({
              rowPageId: rowId,
              propertyId: groupProperty.id,
              value: cardMoveNewValue(targetOptionId),
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        });
        notify?.(`Moved "${cardName}" to "${columnName}".`);
      } catch {
        notify?.(`Could not move "${cardName}" — please try again.`);
      }
    })();
  };

  // Builds a per-column "Add card" handler that also sets the group property value so the
  // card appears in the correct column rather than "No value" (DEF-076).
  const makeCreateRow = (column: BoardColumn) => async () => {
    const rowId = await onCreateRow();
    if (rowId && groupProperty && column.optionId !== null) {
      onSetValue({
        rowPageId: rowId,
        propertyId: groupProperty.id,
        value: cardMoveNewValue(column.optionId),
      });
    }
  };

  const draggingRow = draggingId ? allRows.find((r) => r.id === draggingId) : undefined;

  // Total rows across all columns (after any active filter) — used for the empty state (DEF-072).
  const totalFilteredRows = columns.reduce((n, c) => n + c.rows.length, 0);

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
      // pointerWithin uses the pointer position as the collision origin rather than the
      // drag-overlay rectangle, so a card released inside a column always lands there (DEF-075).
      collisionDetection={pointerWithin}
      accessibility={{ announcements: buildBoardAnnouncements(columns, allRows) }}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      {/* Horizontal scroll container — allows the board to extend past the viewport on narrow
          screens while preventing overflow on the containing page. autoScroll (default true)
          detects this container as a scrollable ancestor and scrolls it during a drag (DEF-075). */}
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
            onCreateRow={() => void makeCreateRow(col)()}
          />
        ))}
      </div>

      {/* Empty state: distinguish a genuinely empty database from a filtered-to-empty one (DEF-085). */}
      {totalFilteredRows === 0 && (
        <div className="py-8 text-center text-sm text-text-muted">
          {allRows.length === 0
            ? 'This database is empty. Add a card to get started.'
            : 'No rows match the current filters.'}
        </div>
      )}

      {/* DragOverlay renders the floating card at the pointer during a drag. */}
      <DragOverlay>
        <DragOverlayCard row={draggingRow} />
      </DragOverlay>
    </DndContext>
  );
}
