import React, { useLayoutEffect, useRef, useState } from 'react';
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
import { numberedListNumber, parseBlockProps, sortKeyForMove } from '../lib/blocks';
import { buildDragAnnouncements } from '../lib/dragAnnouncements';
import type { BlockRecord, BlockType, BlockUpdatePayload } from '../api/types';

export interface BlockEditorProps {
  /** The blocks of this page, already in sortKey order. */
  blocks: BlockRecord[];
  /**
   * The new block's id, returned synchronously so the caret can move to it in the same event.
   * props carries type-specific extras (e.g. parentToggleId for toggleList children).
   */
  onCreateBlock: (args: {
    type: BlockType;
    afterBlockId: string | null;
    props?: string | null;
  }) => string;
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
  // Toggle open/closed state: a block id in this set means collapsed. Absent = open (default).
  // This is intentionally component-local state — never persisted, resets to open on refresh.
  const [collapsedToggles, setCollapsedToggles] = useState<ReadonlySet<string>>(() => new Set());

  // Shared across all BlockRows so the gutter handle's onOpenChange can swallow the spurious click
  // that the pointer sensor synthesises immediately after drag-end. The flag is set synchronously
  // at the top of handleDragEnd — before any React state update and therefore before the synthetic
  // click fires. A useEffect would be too late: effects run after paint, but the click arrives in
  // the same synchronous tick as the drag-end callback. (DEF-113)
  const dragJustEndedRef = useRef(false);

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

  /**
   * Inserts a new block of the given type after afterBlockId and moves the caret to it.
   * props carries type-specific extras such as parentToggleId for toggle children.
   */
  const addBlock = (
    afterBlockId: string | null,
    type: BlockType = 'paragraph',
    props?: string | null,
  ) => {
    // The id comes back synchronously and the block is already in the snapshot, so this render and
    // the focus below happen before the browser can deliver another keystroke.
    const blockId = onCreateBlock({ type, afterBlockId, props });
    setFocusRequest({ blockId, caret: 'start' });
  };

  /**
   * Removes the `parentToggleId` field from a child block's props, preserving any other props
   * (e.g. language, emoji). Called when a toggle header is deleted or converted away from
   * toggleList so its children become visible top-level paragraphs (DEF-110, DEF-115).
   */
  const clearParentToggleId = (child: BlockRecord) => {
    const childProps = parseBlockProps(child.props);
    const rest = Object.fromEntries(
      Object.entries(childProps).filter(([key]) => key !== 'parentToggleId'),
    );
    const newProps = Object.keys(rest).length > 0 ? JSON.stringify(rest) : null;
    onUpdateBlock(child, { props: newProps });
  };

  const deleteEmptyBlock = (index: number) => {
    const block = blocks[index];
    if (!block) return;
    const previous = blocks[index - 1];
    // Backspace on an empty toggleList header: promote its children before deleting so they
    // do not become invisible orphans (DEF-110).
    if (block.type === 'toggleList') {
      const children = blocks.filter((b) => parseBlockProps(b.props).parentToggleId === block.id);
      for (const child of children) {
        clearParentToggleId(child);
      }
    }
    onDeleteBlock(block);
    // The caret lands at the end of the block above, which is where the user was heading.
    if (previous) setFocusRequest({ blockId: previous.id, caret: 'end' });
  };

  /**
   * Returns the toggle group id that `b` belongs to: the block's own id if it is a toggle header,
   * its `parentToggleId` if it is a child, or undefined otherwise.
   */
  const getToggleGroupId = (b: BlockRecord | null): string | undefined => {
    if (!b) return undefined;
    if (b.type === 'toggleList') return b.id;
    return parseBlockProps(b.props).parentToggleId;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    // Set synchronously here — before any React state update and before the synthetic click the
    // pointer sensor fires on pointer-up. BlockRow's onOpenChange reads this flag to swallow that
    // spurious open request. Setting it unconditionally covers both the no-op (same-position) drag
    // and the out-of-bounds release cases (DEF-113).
    dragJustEndedRef.current = true;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = blocks.findIndex((block) => block.id === active.id);
    const toIndex = blocks.findIndex((block) => block.id === over.id);
    const moved = blocks[fromIndex];
    if (!moved || fromIndex < 0 || toIndex < 0) return;

    const newSortKey = sortKeyForMove(blocks, fromIndex, toIndex);

    // Determine the new flat-order neighbors of `moved` after the reorder.
    // `remaining` mirrors what `sortKeyForMove` uses, so these are the same neighbors the
    // new sort key lands between.
    const remaining = blocks.filter((_, i) => i !== fromIndex);
    const beforeBlock: BlockRecord | null = remaining[toIndex - 1] ?? null;
    const afterBlock: BlockRecord | null = remaining[toIndex] ?? null;

    const movedProps = parseBlockProps(moved.props);
    const movedGroupId = movedProps.parentToggleId;

    if (movedGroupId) {
      // `moved` is a toggle child. If neither new neighbor belongs to the same toggle group,
      // the child was dragged outside — promote it to a plain top-level block (DEF-112).
      if (
        getToggleGroupId(beforeBlock) !== movedGroupId &&
        getToggleGroupId(afterBlock) !== movedGroupId
      ) {
        const restProps = Object.fromEntries(
          Object.entries(movedProps).filter(([key]) => key !== 'parentToggleId'),
        );
        const newProps = Object.keys(restProps).length > 0 ? JSON.stringify(restProps) : null;
        onUpdateBlock(moved, { sortKey: newSortKey, props: newProps });
        return;
      }
    } else if (moved.type !== 'toggleList') {
      // `moved` is a plain block (not a toggle header). If both new neighbors belong to the
      // same toggle group, adopt `moved` into that group so it renders at the indicated position
      // rather than below the whole group (DEF-114). Toggle headers are excluded because
      // adopting one would create an unsupported nested toggle.
      const beforeGroupId = getToggleGroupId(beforeBlock);
      const afterGroupId = getToggleGroupId(afterBlock);
      if (beforeGroupId && beforeGroupId === afterGroupId) {
        onUpdateBlock(moved, {
          sortKey: newSortKey,
          props: JSON.stringify({ ...movedProps, parentToggleId: beforeGroupId }),
        });
        return;
      }
    }

    // Standard reorder: update the sort key only.
    onUpdateBlock(moved, { sortKey: newSortKey });
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
          {(() => {
            // Only blocks whose parentToggleId points at an existing toggleList block are
            // treated as toggle children. Orphans (missing parent or non-toggle parent) fall
            // through to the flat list so they remain visible and editable (DEF-110, DEF-111,
            // DEF-115). Computed inline so it is always in sync with the current blocks prop.
            const toggleHeaderIds = new Set(
              blocks.filter((b) => b.type === 'toggleList').map((b) => b.id),
            );
            const toggleChildIds = new Set(
              blocks
                .filter((b) => {
                  const { parentToggleId } = parseBlockProps(b.props);
                  return parentToggleId != null && toggleHeaderIds.has(parentToggleId);
                })
                .map((b) => b.id),
            );

            return blocks.map((block, index) => {
              // Toggle children are rendered inside their parent's group below; skip here.
              if (toggleChildIds.has(block.id)) return null;

              const prev = blocks[index - 1];
              // A list run is consecutive blocks of the same list type; tighter spacing reads as one
              // group. Future: if more block types need run-based spacing, extract to a shared helper.
              const continuesList =
                (block.type === 'bulletedList' ||
                  block.type === 'numberedList' ||
                  block.type === 'todo') &&
                prev?.type === block.type;

              // Toggle-specific state — computed for every block so the single return below can
              // use it without a conditional branch that would change the JSX element type.
              const isToggle = block.type === 'toggleList';
              const isOpen = isToggle ? !collapsedToggles.has(block.id) : false;
              // Children are blocks in toggleChildIds whose parentToggleId points at this block.
              // Using toggleChildIds (rather than a raw parentToggleId check) ensures only valid
              // children are included — orphans of this block are already excluded from the set.
              const toggleChildren = isToggle
                ? blocks.filter(
                    (b) =>
                      toggleChildIds.has(b.id) &&
                      parseBlockProps(b.props).parentToggleId === block.id,
                  )
                : [];
              const lastChild = toggleChildren[toggleChildren.length - 1] ?? null;

              const setOpen = (open: boolean) => {
                setCollapsedToggles((prev) => {
                  const next = new Set(prev);
                  if (open) next.delete(block.id);
                  else next.add(block.id);
                  return next;
                });
              };

              /*
               * All blocks share one React.Fragment wrapper keyed by block.id. This keeps the
               * inner BlockRow at element-position 0 within the Fragment so React reuses the same
               * component instance when the block type changes (e.g. a paragraph converted to
               * toggleList). Without this, a type change would shift the key from BlockRow to
               * Fragment, React would unmount and remount BlockRow, and the refocusAfterConvert
               * ref would be lost — leaving focus on <body> after a slash-menu conversion.
               * Future: if more block types need a sibling container (like toggleList's children
               * region), add it as a second child of the Fragment here.
               */
              return (
                <React.Fragment key={block.id}>
                  <BlockRow
                    block={block}
                    continuesList={continuesList}
                    listNumber={isToggle ? 1 : numberedListNumber(blocks, index)}
                    registerEditor={registerEditor}
                    dragJustEndedRef={dragJustEndedRef}
                    onChangeText={(text) => onUpdateBlock(block, { text })}
                    // One op carries both: the slash query the user typed was a command, never
                    // content, so the conversion clears the text the same write that changes the type.
                    // For toggleList: promote children to top-level before changing the type so
                    // they do not become invisible orphans (DEF-115).
                    onConvertType={(type) => {
                      if (isToggle) {
                        for (const child of toggleChildren) {
                          clearParentToggleId(child);
                        }
                      }
                      onUpdateBlock(block, { type, text: '' });
                    }}
                    onToggleChecked={(checked) => onUpdateBlock(block, { checked })}
                    // onEnter is the fallback for toggleList (onEnterToggleHeader takes over);
                    // for every other type it creates a paragraph below the block.
                    onEnter={(type) => addBlock(block.id, type)}
                    onDeleteEmpty={() => deleteEmptyBlock(index)}
                    // For toggleList: promote children before deleting the header so they do not
                    // become invisible orphans (DEF-110).
                    onDelete={() => {
                      if (isToggle) {
                        for (const child of toggleChildren) {
                          clearParentToggleId(child);
                        }
                      }
                      onDeleteBlock(block);
                    }}
                    onNotice={onNotice}
                    isToggleOpen={isToggle ? isOpen : undefined}
                    onToggleOpenChange={isToggle ? setOpen : undefined}
                    onEnterToggleHeader={
                      isToggle
                        ? () => {
                            // Open the toggle before creating the child so the child is visible.
                            if (!isOpen) setOpen(true);
                            // Insert the new child right after the toggle header.
                            addBlock(
                              block.id,
                              'paragraph',
                              JSON.stringify({ parentToggleId: block.id }),
                            );
                          }
                        : undefined
                    }
                  />
                  {/*
                    Children region: always rendered for toggleList (even when empty) so
                    aria-controls on the arrow button points at an existing element. The hidden
                    attribute collapses it visually without removing it from the DOM, keeping the
                    ARIA association intact and preventing DnD from computing stale positions for
                    invisible items.
                    Future: remove `hidden` check and recurse when toggleList children of another
                    toggleList must render here — nested toggles are out of scope for Phase 7.
                  */}
                  {isToggle ? (
                    <div
                      id={`toggle-children-${block.id}`}
                      data-testid="block-toggle-children"
                      className="pl-6"
                      role="region"
                      aria-label="Toggle contents"
                      hidden={!isOpen || toggleChildren.length === 0}
                    >
                      {toggleChildren.map((child) => {
                        const childIndex = blocks.indexOf(child);
                        return (
                          <BlockRow
                            key={child.id}
                            block={child}
                            continuesList={false}
                            listNumber={1}
                            registerEditor={registerEditor}
                            dragJustEndedRef={dragJustEndedRef}
                            onChangeText={(text) => onUpdateBlock(child, { text })}
                            onConvertType={(type) => onUpdateBlock(child, { type, text: '' })}
                            onToggleChecked={(checked) => onUpdateBlock(child, { checked })}
                            onEnter={(type) => addBlock(child.id, type)}
                            onDeleteEmpty={() => deleteEmptyBlock(childIndex)}
                            onDelete={() => onDeleteBlock(child)}
                            onNotice={onNotice}
                            onEnterToggleChild={(isEmpty) => {
                              if (isEmpty && child.id === lastChild?.id) {
                                // Exit the toggle: delete the empty last child and create a plain
                                // paragraph after the entire toggle group. The afterBlockId must
                                // be the group block with the highest sortKey EXCLUDING the child
                                // being deleted — otherwise, if the header was dragged to a higher
                                // sortKey than the children, the new paragraph would land at the
                                // wrong position in the flat order (DEF-119).
                                const groupBlocks = [block, ...toggleChildren];
                                const remaining = groupBlocks.filter((b) => b.id !== child.id);
                                const afterGroup =
                                  remaining.length > 0
                                    ? remaining.reduce((max, b) =>
                                        b.sortKey > max.sortKey ? b : max,
                                      )
                                    : null;
                                onDeleteBlock(child);
                                addBlock(afterGroup?.id ?? null, 'paragraph');
                              } else {
                                // Create another child with the same parentToggleId.
                                addBlock(
                                  child.id,
                                  'paragraph',
                                  JSON.stringify({ parentToggleId: block.id }),
                                );
                              }
                            }}
                          />
                        );
                      })}
                    </div>
                  ) : null}
                </React.Fragment>
              );
            });
          })()}
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
