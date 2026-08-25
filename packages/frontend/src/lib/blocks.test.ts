import { describe, expect, it } from 'vitest';
import {
  BLOCK_TYPE_OPTIONS,
  MAX_BLOCK_TEXT_LENGTH,
  blockTypeLabel,
  clampBlockText,
  blocksForPage,
  filterBlockTypes,
  isTextualBlock,
  numberedListNumber,
  parseBlockProps,
  sortKeyAfterIndex,
  sortKeyForMove,
  sortKeyForNewBlock,
} from './blocks';
import { makeBlock } from '../test/fixtures';

const pageBlocks = [
  makeBlock({ id: 'b-1', pageId: 'p-1', sortKey: 'a0', text: 'First' }),
  makeBlock({ id: 'b-2', pageId: 'p-1', sortKey: 'a1', text: 'Second' }),
  makeBlock({ id: 'b-3', pageId: 'p-1', sortKey: 'a2', text: 'Third' }),
];

describe('the block type catalogue', () => {
  it('offers the twelve types including toggleList added in Phase 7', () => {
    expect(BLOCK_TYPE_OPTIONS.map((option) => option.type)).toEqual([
      'paragraph',
      'heading1',
      'heading2',
      'heading3',
      'bulletedList',
      'numberedList',
      'todo',
      'quote',
      'divider',
      'code',
      'callout',
      'toggleList',
    ]);
    expect(blockTypeLabel('bulletedList')).toBe('Bulleted list');
    expect(blockTypeLabel('toggleList')).toBe('Toggle list');
  });

  it('toggleList matches all three of its keywords', () => {
    expect(filterBlockTypes('toggle').map((o) => o.type)).toContain('toggleList');
    expect(filterBlockTypes('collapse').map((o) => o.type)).toContain('toggleList');
    expect(filterBlockTypes('expand').map((o) => o.type)).toContain('toggleList');
  });
});

describe('filterBlockTypes', () => {
  it('offers every type for an empty query', () => {
    expect(filterBlockTypes('')).toHaveLength(12);
  });

  it('matches labels, so "head" narrows to the three headings', () => {
    expect(filterBlockTypes('head').map((option) => option.type)).toEqual([
      'heading1',
      'heading2',
      'heading3',
    ]);
  });

  it('matches keywords and shorthands, so "h1" and "check" find their type', () => {
    expect(filterBlockTypes('h1').map((option) => option.type)).toEqual(['heading1']);
    expect(filterBlockTypes('check').map((option) => option.type)).toEqual(['todo']);
    // The hyphen and the spacing must not matter: a user types "todo" for "To-do".
    expect(filterBlockTypes('todo').map((option) => option.type)).toEqual(['todo']);
  });

  it('returns nothing when nothing matches, so the menu can say so', () => {
    expect(filterBlockTypes('zzz')).toEqual([]);
  });
});

describe('blocksForPage', () => {
  it('keeps only this page and orders it by sortKey, not by snapshot order', () => {
    const blocks = [
      makeBlock({ id: 'b-b', pageId: 'p-1', sortKey: 'a2' }),
      makeBlock({ id: 'b-other', pageId: 'p-2', sortKey: 'a0' }),
      makeBlock({ id: 'b-a', pageId: 'p-1', sortKey: 'a1' }),
    ];

    expect(blocksForPage(blocks, 'p-1').map((block) => block.id)).toEqual(['b-a', 'b-b']);
  });

  it('breaks a duplicate sortKey on the id, as the server does, whatever order it arrived in', () => {
    // Two concurrent appends can mint the same key, so this is a real state, not a hypothetical.
    const blocks = [
      makeBlock({ id: 'b-c', pageId: 'p-1', sortKey: 'a1' }),
      makeBlock({ id: 'b-a', pageId: 'p-1', sortKey: 'a1' }),
      makeBlock({ id: 'b-b', pageId: 'p-1', sortKey: 'a1' }),
    ];

    expect(blocksForPage(blocks, 'p-1').map((block) => block.id)).toEqual(['b-a', 'b-b', 'b-c']);
    // And the reverse arrival order produces the same page, rather than the order it arrived in.
    expect(blocksForPage([...blocks].reverse(), 'p-1').map((block) => block.id)).toEqual([
      'b-a',
      'b-b',
      'b-c',
    ]);
  });
});

describe('the fractional key helpers', () => {
  it('appends a new block after the last one', () => {
    expect(sortKeyForNewBlock(pageBlocks) > 'a2').toBe(true);
  });

  it('gives two appends that race the same stale list two distinct keys', () => {
    const first = sortKeyForNewBlock(pageBlocks);
    const second = sortKeyForNewBlock(pageBlocks, [first]);

    expect(second).not.toBe(first);
    expect(second > first).toBe(true);
  });

  it('places an Enter insert strictly between the block and its next sibling', () => {
    const key = sortKeyAfterIndex(pageBlocks, 0);

    expect(key > 'a0').toBe(true);
    expect(key < 'a1').toBe(true);
  });

  it('appends when Enter is pressed on the last block', () => {
    expect(sortKeyAfterIndex(pageBlocks, 2) > 'a2').toBe(true);
  });

  it('keeps two Enters at the same position apart', () => {
    const first = sortKeyAfterIndex(pageBlocks, 0);
    const second = sortKeyAfterIndex(pageBlocks, 0, [first]);

    expect(second).not.toBe(first);
    expect(second > 'a0' && second < first).toBe(true);
  });

  it('drops the first block at the end with one key after the last', () => {
    const key = sortKeyForMove(pageBlocks, 0, 2);

    expect(key > 'a2').toBe(true);
  });

  it('drops the last block at the top with one key before the first', () => {
    const key = sortKeyForMove(pageBlocks, 2, 0);

    expect(key < 'a0').toBe(true);
  });

  it('drops a block between its new neighbours', () => {
    // Dragging the first block down one lands it between the old second and third.
    const key = sortKeyForMove(pageBlocks, 0, 1);

    expect(key > 'a1').toBe(true);
    expect(key < 'a2').toBe(true);
  });
});

describe('numberedListNumber', () => {
  it('numbers a run 1, 2, 3 and restarts after the run is broken', () => {
    const blocks = [
      makeBlock({ id: 'n-1', pageId: 'p-1', type: 'numberedList', sortKey: 'a0' }),
      makeBlock({ id: 'n-2', pageId: 'p-1', type: 'numberedList', sortKey: 'a1' }),
      makeBlock({ id: 'n-3', pageId: 'p-1', type: 'numberedList', sortKey: 'a2' }),
      makeBlock({ id: 'p', pageId: 'p-1', type: 'paragraph', sortKey: 'a3' }),
      makeBlock({ id: 'n-4', pageId: 'p-1', type: 'numberedList', sortKey: 'a4' }),
    ];

    expect(blocks.map((_block, index) => numberedListNumber(blocks, index))).toEqual([
      1, 2, 3, 1, 1,
    ]);
  });
});

describe('isTextualBlock', () => {
  it('returns false for divider (the only non-textual block)', () => {
    expect(isTextualBlock('divider')).toBe(false);
  });

  it('returns true for every other block type', () => {
    expect(isTextualBlock('paragraph')).toBe(true);
    expect(isTextualBlock('heading1')).toBe(true);
    expect(isTextualBlock('code')).toBe(true);
  });
});

describe('parseBlockProps', () => {
  it('reads the type-specific extras', () => {
    expect(parseBlockProps('{"language":"typescript"}')).toEqual({ language: 'typescript' });
    expect(parseBlockProps('{"emoji":"\u{1F4A1}"}')).toEqual({ emoji: '\u{1F4A1}' });
  });

  it('reads null and malformed props as empty rather than breaking the page', () => {
    expect(parseBlockProps(null)).toEqual({});
    expect(parseBlockProps('not json')).toEqual({});
    expect(parseBlockProps('"a string"')).toEqual({});
  });
});

describe('clampBlockText', () => {
  it('leaves text within the limit exactly as it is', () => {
    expect(clampBlockText('short')).toEqual({ text: 'short', truncated: false });
    // Exactly at the limit is not truncation: nothing was dropped, so nothing is said.
    const exact = 'a'.repeat(MAX_BLOCK_TEXT_LENGTH);
    expect(clampBlockText(exact)).toEqual({ text: exact, truncated: false });
  });

  it('reports that it dropped the end, so the user can be told', () => {
    const result = clampBlockText('a'.repeat(MAX_BLOCK_TEXT_LENGTH + 1));
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MAX_BLOCK_TEXT_LENGTH);
  });

  it('never cuts an emoji in half, and stays inside the limit the server counts', () => {
    // The 10000th UTF-16 unit falls between the emoji's two surrogates. A plain slice stored a lone
    // high surrogate, which came back as replacement characters and was longer than the limit.
    const pasted = `${'a'.repeat(MAX_BLOCK_TEXT_LENGTH - 1)}\u{1F600} trailing text`;
    const result = clampBlockText(pasted);

    expect(result.truncated).toBe(true);
    // The server counts UTF-16 units; the cut satisfies that count.
    expect(result.text.length).toBeLessThanOrEqual(MAX_BLOCK_TEXT_LENGTH);
    expect(result.text).toBe('a'.repeat(MAX_BLOCK_TEXT_LENGTH - 1));
    // No half of a surrogate pair survives anywhere in the result.
    expect([...result.text].every((point) => point.codePointAt(0)! < 0xd800)).toBe(true);
  });

  it('keeps an emoji whole when the whole pair fits', () => {
    const pasted = `${'a'.repeat(MAX_BLOCK_TEXT_LENGTH - 2)}\u{1F600}\u{1F600}`;
    const result = clampBlockText(pasted);

    expect(result.text).toBe(`${'a'.repeat(MAX_BLOCK_TEXT_LENGTH - 2)}\u{1F600}`);
    expect(result.text.length).toBe(MAX_BLOCK_TEXT_LENGTH);
    expect(result.truncated).toBe(true);
  });
});
