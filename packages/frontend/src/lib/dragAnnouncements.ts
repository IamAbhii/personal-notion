import { blockTypeLabel } from './blocks';
import type { Announcements } from '@dnd-kit/core';
import type { BlockRecord } from '../api/types';

// What a screen reader hears while a block is being dragged. dnd-kit's default announcements read
// the raw ids of the dragged item and the drop target, and every id in this app is a UUID, so the
// live region said "Draggable item f2660a3d-... was moved over droppable area f2660a3d-...". These
// say the same things in the words the drag handle's own accessible name already uses.

/** How long a quoted block text may get before it is cut, so an announcement stays listenable. */
const MAX_QUOTED_TEXT = 40;

/** How a block is named out loud: its type and a short quote of its own text. */
export function describeBlockForDrag(
  blocks: BlockRecord[],
  id: string | number | undefined,
): string {
  const block = blocks.find((candidate) => candidate.id === id);
  if (!block) return 'the block';
  const type = blockTypeLabel(block.type).toLowerCase();
  if (!block.text) return `the empty ${type} block`;
  const text =
    block.text.length > MAX_QUOTED_TEXT ? `${block.text.slice(0, MAX_QUOTED_TEXT)}...` : block.text;
  return `the ${type} block "${text}"`;
}

/**
 * The four drag announcements for a page's blocks, naming the block and its one-based position.
 * Built from the current block list on every render, so the text always matches what is on screen.
 */
export function buildDragAnnouncements(blocks: BlockRecord[]): Announcements {
  const describe = (id: string | number | undefined) => describeBlockForDrag(blocks, id);
  const position = (id: string | number | undefined) =>
    blocks.findIndex((candidate) => candidate.id === id) + 1;
  const total = blocks.length;

  return {
    onDragStart: ({ active }) =>
      `Picked up ${describe(active.id)}. It is at position ${position(active.id)} of ${total}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${describe(active.id)} is over position ${position(over.id)} of ${total}.`
        : `${describe(active.id)} is no longer over a drop position.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${describe(active.id)} at position ${position(over.id)} of ${total}.`
        : `${describe(active.id)} was dropped outside the page and stayed where it was.`,
    onDragCancel: ({ active }) =>
      `Moving ${describe(active.id)} was cancelled; it stayed where it was.`,
  };
}
