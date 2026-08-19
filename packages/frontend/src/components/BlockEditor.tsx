import { useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragMoveEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { BlockRow } from './BlockRow';
import { numberedListNumber, sortKeyForMove } from '../lib/blocks';
import { buildDragAnnouncements } from '../lib/dragAnnouncements';
import type { BlockRecord, BlockType, BlockUpdatePayload } from '../api/types';

export interface BlockEditorProps {
  /** The blocks of this page, already in sortKey order. */
  blocks: BlockRecord[];
  /** The new block's id, returned synchronously so the caret can move to it in the same event. */
  onCreateBlock: (args: { type: BlockType; afterBlockId: string | null }) => string;
  onUpdateBlock: (block: BlockRecord, changes: BlockUpdatePayload) => void;
  onDeleteBlock: (block: BlockRecord) => void;
  /** Says something to the user - used when a paste is clamped to the block text limit. */
  onNotice: (message: string) => void;
}

/** Which block should take the caret once it exists in the list, and at which end of its text. */
interface FocusRequest {
  blockId: string;
  caret: 'start' | 'end';
}

/**
 * The page body: a vertical stack of editable blocks with drag-to-reorder. It owns what spans more
 * than one block — inserting, deleting, moving focus between blocks and the drop-to-sortKey maths —
 * while each BlockRow owns its own text, autosave and slash menu.
 */
export function BlockEditor({
  blocks,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
  onNotice,
}: BlockEditorProps) {
  // The textarea of every rendered block, so focus can move to a block this component did not draw.
  const editors = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so clicking into a block's text still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // scrollBehavior: 'auto' makes the viewport scroll instantaneously rather than smoothly during
    // a keyboard drag; instant scroll means the DOM is in its final position before the next
    // keydown fires, giving the coordinate getter an accurate layout to read.
    // Future: at OS auto-repeat rate (~40ms), rapid ArrowDown presses during keyboard drag still
    // drop moves because React has not flushed the previous position update before the next keydown
    // fires and the coordinateGetter reads stale droppable positions. A complete fix requires either
    // `flushSync` around dnd-kit's drag-state dispatch or batching key moves inside the sensor
    // itself — both are upstream changes in @dnd-kit/core's KeyboardSensor.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: 'auto',
    }),
  );

  const registerEditor = (blockId: string, element: HTMLTextAreaElement | null) => {
    if (element) editors.current.set(blockId, element);
    else editors.current.delete(blockId);
  };

  // The caret moves in a layout effect, not a passive one: a passive effect can be deferred past the
  // next keystroke, and then the character the user typed after Enter lands in the block they left.
  // A layout effect runs in the same synchronous commit as the keydown that created the block.
  useLayoutEffect(() => {
    if (!focusRequest) return;
    const element = editors.current.get(focusRequest.blockId);
    if (!element) return;
    element.focus();
    const caret = focusRequest.caret === 'end' ? element.value.length : 0;
    element.setSelectionRange(caret, caret);
    setFocusRequest(null);
  }, [blocks, focusRequest]);

  /** Inserts a new block of the given type after afterBlockId and moves the caret to it. */
  const addBlock = (afterBlockId: string | null, type: BlockType = 'paragraph') => {
    // The id comes back synchronously and the block is already in the snapshot, so this render and
    // the focus below happen before the browser can deliver another keystroke.
    const blockId = onCreateBlock({ type, afterBlockId });
    setFocusRequest({ blockId, caret: 'start' });
  };

  const deleteEmptyBlock = (index: number) => {
    const block = blocks[index];
    if (!block) return;
    const previous = blocks[index - 1];
    onDeleteBlock(block);
    // The caret lands at the end of the block above, which is where the user was heading.
    if (previous) setFocusRequest({ blockId: previous.id, caret: 'end' });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = blocks.findIndex((block) => block.id === active.id);
    const toIndex = blocks.findIndex((block) => block.id === over.id);
    const moved = blocks[fromIndex];
    if (!moved || fromIndex < 0 || toIndex < 0) return;
    // One op on one row: the fractional key does the reordering, so no sibling is rewritten.
    onUpdateBlock(moved, { sortKey: sortKeyForMove(blocks, fromIndex, toIndex) });
  };

  /**
   * Flushes pending React state updates after each keyboard drag step. Without this, rapid
   * ArrowDown presses at OS auto-repeat speed (~40ms) fire before React has committed the
   * previous step's position changes. The droppable coordinate getter then reads stale DOM
   * positions and most presses are silently dropped. flushSync forces a synchronous commit
   * so each keydown reads an accurate layout. Only applied for keyboard drag (activatorEvent
   * is a KeyboardEvent); pointer drag is unaffected.
   * Future: remove when @dnd-kit/core's KeyboardSensor handles inter-key flush internally.
   */
  const handleDragMove = (event: DragMoveEvent) => {
    if (event.activatorEvent instanceof KeyboardEvent) {
      flushSync(() => {});
    }
  };

  // dnd-kit's defaults read raw UUIDs to a screen reader; these name the block and its position.
  const announcements = buildDragAnnouncements(blocks);

  return (
    <section className="mt-7 flex flex-col" data-testid="block-editor" aria-label="Page body">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // A block stack only reorders vertically; sideways movement would just look broken.
        modifiers={[restrictToVerticalAxis]}
        accessibility={{ announcements }}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, index) => {
            const prev = blocks[index - 1];
            // A list run is consecutive blocks of the same list type; tighter spacing reads as one
            // group. Future: if more block types need run-based spacing, extract to a shared helper.
            const continuesList =
              (block.type === 'bulletedList' ||
                block.type === 'numberedList' ||
                block.type === 'todo') &&
              prev?.type === block.type;

            return (
              <BlockRow
                key={block.id}
                block={block}
                continuesList={continuesList}
                listNumber={numberedListNumber(blocks, index)}
                registerEditor={registerEditor}
                onChangeText={(text) => onUpdateBlock(block, { text })}
                // One op carries both: the slash query the user typed was a command, never content,
                // so the conversion clears the text the same write that changes the type.
                onConvertType={(type) => onUpdateBlock(block, { type, text: '' })}
                onToggleChecked={(checked) => onUpdateBlock(block, { checked })}
                onEnter={(type) => addBlock(block.id, type)}
                onDeleteEmpty={() => deleteEmptyBlock(index)}
                onDelete={() => onDeleteBlock(block)}
                onNotice={onNotice}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {blocks.length === 0 ? (
        // Empty page: a dashed placeholder the user clicks to add the first block.
        <button
          type="button"
          className="mt-1.5 flex w-full cursor-text flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-surface-sunken px-6.5 pt-6 pb-6.5 text-left hover:border-amber"
          onClick={() => addBlock(null)}
        >
          <span className="text-base font-[650]">This page is empty</span>
          <span className="max-w-[54ch] text-sm leading-relaxed text-text-muted">
            Click here to start writing, then type &quot;/&quot; for headings, lists, to-dos,
            quotes, code and callouts.
          </span>
        </button>
      ) : (
        // A click below the last block appends one, which is how a page grows without a toolbar.
        // Tall enough that the last block can still scroll up far enough to show its slash menu.
        <button
          type="button"
          className="block h-45 w-full cursor-text border-0 bg-transparent"
          aria-label="Add a block at the end of the page"
          onClick={() => addBlock(blocks[blocks.length - 1]?.id ?? null)}
        />
      )}
    </section>
  );
}
