import { describe, expect, it } from 'vitest';
import { buildDragAnnouncements, describeBlockForDrag } from './dragAnnouncements';
import { makeBlock } from '../test/fixtures';

// DEF-019: dnd-kit's default announcements read the raw block UUIDs to a screen reader.

const heading = makeBlock({
  id: 'f2660a3d-12f3-4948-b69c-a7f898d6f5ba',
  pageId: 'p-1',
  type: 'heading2',
  text: 'Packing list',
  sortKey: 'a0',
});
const empty = makeBlock({ id: 'b-2', pageId: 'p-1', type: 'paragraph', text: '', sortKey: 'a1' });
const blocks = [heading, empty];

describe('describeBlockForDrag', () => {
  it('names the block by its type and its own text', () => {
    expect(describeBlockForDrag(blocks, heading.id)).toBe('the heading 2 block "Packing list"');
  });

  it('says an empty block is empty rather than quoting nothing', () => {
    expect(describeBlockForDrag(blocks, empty.id)).toBe('the empty text block');
  });

  it('cuts a long text so the announcement stays listenable', () => {
    const long = makeBlock({ id: 'b-3', pageId: 'p-1', text: 'x'.repeat(80), sortKey: 'a2' });
    expect(describeBlockForDrag([long], 'b-3')).toBe(`the text block "${'x'.repeat(40)}..."`);
  });

  it('falls back to a plain phrase for an id that is no longer on the page', () => {
    expect(describeBlockForDrag(blocks, 'gone')).toBe('the block');
  });
});

describe('buildDragAnnouncements', () => {
  const announcements = buildDragAnnouncements(blocks);
  const active = { id: heading.id };
  const over = { id: empty.id };

  it('announces the pick-up with the block name and its position, never a UUID', () => {
    const said = announcements.onDragStart({ active } as never);
    expect(said).toBe('Picked up the heading 2 block "Packing list". It is at position 1 of 2.');
    expect(said).not.toContain(heading.id);
  });

  it('announces what the block is over, and where it was dropped', () => {
    expect(announcements.onDragOver?.({ active, over } as never)).toBe(
      'the heading 2 block "Packing list" is over position 2 of 2.',
    );
    expect(announcements.onDragEnd?.({ active, over } as never)).toBe(
      'Dropped the heading 2 block "Packing list" at position 2 of 2.',
    );
  });

  it('says the block stayed put when the drag is cancelled or dropped nowhere', () => {
    expect(announcements.onDragCancel?.({ active } as never)).toContain('stayed where it was');
    expect(announcements.onDragEnd?.({ active, over: null } as never)).toContain(
      'stayed where it was',
    );
  });
});
