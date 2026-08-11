import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { BlockRow } from './BlockRow';
import { numberedListNumber, sortKeyForMove } from '../lib/blocks';
import type { BlockRecord, BlockType, BlockUpdatePayload } from '../api/types';

export interface BlockEditorProps {
  /** The blocks of this page, already in sortKey order. */
  blocks: BlockRecord[];
  /** Resolves to the new block's id, or null when the write failed. */
  onCreateBlock: (args: { type: BlockType; afterBlockId: string | null }) => Promise<string | null>;
  onUpdateBlock: (block: BlockRecord, changes: BlockUpdatePayload) => void;
  onDeleteBlock: (block: BlockRecord) => void;
}

/** Which block should take the caret once it exists in the list, and at which end of its text. */
interface FocusRequest {
  blockId: string;
  caret: 'start' | 'end';
}

/**
 * The page body: a vertical stack of editable blocks with drag-to-reorder. It owns what spans more
 * than one block - inserting, deleting, moving focus between blocks and the drop-to-sortKey maths -
 * while each BlockRow owns its own text, autosave and slash menu.
 */
export function BlockEditor({
  blocks,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
}: BlockEditorProps) {
  // The textarea of every rendered block, so focus can move to a block this component did not draw.
  const editors = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);

  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so clicking into a block's text still works.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const registerEditor = (blockId: string, element: HTMLTextAreaElement | null) => {
    if (element) editors.current.set(blockId, element);
    else editors.current.delete(blockId);
  };

  // A created block is focused only once it has been rendered, which is a tick or a refetch after
  // the op, so the request is held until its textarea is registered.
  useEffect(() => {
    if (!focusRequest) return;
    const element = editors.current.get(focusRequest.blockId);
    if (!element) return;
    element.focus();
    const caret = focusRequest.caret === 'end' ? element.value.length : 0;
    element.setSelectionRange(caret, caret);
    setFocusRequest(null);
  }, [blocks, focusRequest]);

  const addBlock = async (afterBlockId: string | null) => {
    const blockId = await onCreateBlock({ type: 'paragraph', afterBlockId });
    // Null means the write failed and the user has been told; there is no block to focus.
    if (blockId) setFocusRequest({ blockId, caret: 'start' });
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

  return (
    <section className="block-editor" data-testid="block-editor" aria-label="Page body">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        // A block stack only reorders vertically; sideways movement would just look broken.
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={blocks.map((block) => block.id)}
          strategy={verticalListSortingStrategy}
        >
          {blocks.map((block, index) => (
            <BlockRow
              key={block.id}
              block={block}
              listNumber={numberedListNumber(blocks, index)}
              registerEditor={registerEditor}
              onChangeText={(text) => onUpdateBlock(block, { text })}
              onChangeType={(type) => onUpdateBlock(block, { type })}
              onToggleChecked={(checked) => onUpdateBlock(block, { checked })}
              onEnter={() => void addBlock(block.id)}
              onDeleteEmpty={() => deleteEmptyBlock(index)}
              onDelete={() => onDeleteBlock(block)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {blocks.length === 0 ? (
        <button type="button" className="block-editor__empty" onClick={() => void addBlock(null)}>
          <span className="block-editor__empty-lead">This page is empty</span>
          <span className="block-editor__empty-note">
            Click here to start writing, then type &quot;/&quot; for headings, lists, to-dos,
            quotes, code and callouts.
          </span>
        </button>
      ) : (
        // A click below the last block appends one, which is how a page grows without a toolbar.
        <button
          type="button"
          className="block-editor__tail"
          aria-label="Add a block at the end of the page"
          onClick={() => void addBlock(blocks[blocks.length - 1]?.id ?? null)}
        />
      )}
    </section>
  );
}
