import { generateKeyBetween } from 'fractional-indexing';
import { bySortKeyThenId } from './ordering';
import type { BlockRecord, BlockType } from '../api/types';

// Pure block helpers over the flat block list the snapshot returns: ordering, fractional keys,
// list numbering, props parsing and the slash-menu catalogue. Kept free of React so they are cheap
// to unit test and reusable by the offline queue later.

/** The server's limits, enforced here too so a rejected op is not how the user finds out. */
export const MAX_BLOCK_TEXT_LENGTH = 10000;
export const MAX_BLOCK_PROPS_LENGTH = 1000;

/** What clamping a block's text to the limit produced, and whether anything was dropped. */
export interface ClampedBlockText {
  text: string;
  /** True when characters were dropped, so the caller can tell the user rather than lose them silently. */
  truncated: boolean;
}

/**
 * Clamps a block's text to the server's limit on a code point boundary. A plain
 * `slice(0, MAX_BLOCK_TEXT_LENGTH)` can cut between the two UTF-16 units of an emoji, which stores a
 * lone surrogate that comes back as replacement characters and is longer than the limit it was cut
 * to. So whole code points are accumulated while their combined UTF-16 length still fits, which
 * satisfies both counts: the server measures UTF-16 units, the user sees characters.
 */
export function clampBlockText(next: string): ClampedBlockText {
  if (next.length <= MAX_BLOCK_TEXT_LENGTH) return { text: next, truncated: false };
  // Iterating the string yields code points, so a surrogate pair is one step and never split.
  const points = Array.from(next);
  let units = 0;
  let count = 0;
  for (const point of points) {
    if (units + point.length > MAX_BLOCK_TEXT_LENGTH) break;
    units += point.length;
    count += 1;
  }
  return { text: points.slice(0, count).join(''), truncated: true };
}

/** The default language a code block starts in, until a later phase lets the user pick one. */
export const DEFAULT_CODE_LANGUAGE = 'plain text';

/** The emoji a callout shows when it carries no `props.emoji`. */
export const DEFAULT_CALLOUT_EMOJI = '\u{1F4A1}';

/** One entry of the slash menu: a type, how it reads, and the words that should find it. */
export interface BlockTypeOption {
  type: BlockType;
  label: string;
  hint: string;
  keywords: string[];
}

/**
 * The twelve types in the order the slash menu offers them: the everyday ones first, the
 * structural ones last. `keywords` exist so "h1", "bullet" and "check" find the right entry.
 */
export const BLOCK_TYPE_OPTIONS: BlockTypeOption[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', keywords: ['paragraph', 'plain'] },
  { type: 'heading1', label: 'Heading 1', hint: 'Large section title', keywords: ['h1', 'title'] },
  { type: 'heading2', label: 'Heading 2', hint: 'Medium section title', keywords: ['h2'] },
  { type: 'heading3', label: 'Heading 3', hint: 'Small section title', keywords: ['h3'] },
  {
    type: 'bulletedList',
    label: 'Bulleted list',
    hint: 'An unordered item',
    keywords: ['bullet', 'ul', 'unordered'],
  },
  {
    type: 'numberedList',
    label: 'Numbered list',
    hint: 'An ordered item',
    keywords: ['number', 'ol', 'ordered'],
  },
  {
    type: 'todo',
    label: 'To-do',
    hint: 'A task with a checkbox',
    keywords: ['todo', 'task', 'check', 'checkbox'],
  },
  { type: 'quote', label: 'Quote', hint: 'A quoted passage', keywords: ['blockquote', 'cite'] },
  {
    type: 'divider',
    label: 'Divider',
    hint: 'A horizontal rule',
    keywords: ['hr', 'line', 'rule'],
  },
  { type: 'code', label: 'Code', hint: 'Monospace code block', keywords: ['snippet', 'mono'] },
  { type: 'callout', label: 'Callout', hint: 'A highlighted note', keywords: ['note', 'info'] },
  {
    type: 'toggleList',
    label: 'Toggle list',
    hint: 'A collapsible section with children',
    keywords: ['toggle', 'collapse', 'expand'],
  },
];

/** How a type is named in labels and aria text, for the one-off lookups the UI needs. */
export function blockTypeLabel(type: BlockType): string {
  return BLOCK_TYPE_OPTIONS.find((option) => option.type === type)?.label ?? type;
}

/**
 * The slash menu's filter. Matches the label, the type literal and the keywords, so both "to-do"
 * and "check" land on the to-do entry. An empty query offers everything.
 * `excludeTypes` removes specific types from results — used to hide `toggleList` inside a toggle
 * child, where nested toggles are not supported.
 */
export function filterBlockTypes(
  query: string,
  excludeTypes: ReadonlySet<BlockType> = new Set(),
): BlockTypeOption[] {
  const needle = query.trim().toLowerCase().replace(/[\s-]/g, '');
  const base =
    excludeTypes.size > 0
      ? BLOCK_TYPE_OPTIONS.filter((option) => !excludeTypes.has(option.type))
      : BLOCK_TYPE_OPTIONS;
  if (!needle) return base;
  return base.filter((option) =>
    [option.label, option.type, ...option.keywords].some((candidate) =>
      candidate.toLowerCase().replace(/[\s-]/g, '').includes(needle),
    ),
  );
}

/**
 * The blocks of one page, in `(sortKey, id)` order - the same order the server returns them in, so
 * two blocks that share a key never swap places between a local write and the next snapshot. The
 * snapshot carries the whole workspace flat.
 */
export function blocksForPage(blocks: BlockRecord[], pageId: string): BlockRecord[] {
  return blocks.filter((block) => block.pageId === pageId).sort(bySortKeyThenId);
}

/**
 * A fractional key that appends after the last block of a page. `reservedKeys` are keys already
 * minted for creates that have not landed in the snapshot yet, so two fast Enters do not collide.
 */
export function sortKeyForNewBlock(
  pageBlocks: BlockRecord[],
  reservedKeys: readonly string[] = [],
): string {
  const keys = [...pageBlocks.map((block) => block.sortKey), ...reservedKeys].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return generateKeyBetween(keys[keys.length - 1] ?? null, null);
}

/**
 * A fractional key that places a block immediately after `pageBlocks[index]` - what Enter needs, so
 * the new paragraph lands between the current block and its next sibling with no other row touched.
 */
export function sortKeyAfterIndex(
  pageBlocks: BlockRecord[],
  index: number,
  reservedKeys: readonly string[] = [],
): string {
  const before = pageBlocks[index]?.sortKey ?? null;
  const following = pageBlocks
    .slice(index + 1)
    .map((block) => block.sortKey)
    .concat(reservedKeys.filter((key) => before === null || key > before))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return generateKeyBetween(before, following[0] ?? null);
}

/**
 * The key a dragged block takes when it is dropped at `toIndex`. The dragged block is removed
 * first, exactly as dnd-kit's arrayMove reports the destination, so the key lands between the two
 * blocks that will actually surround it - one op, one row.
 */
export function sortKeyForMove(
  pageBlocks: BlockRecord[],
  fromIndex: number,
  toIndex: number,
): string {
  const remaining = pageBlocks.filter((_block, index) => index !== fromIndex);
  const before = remaining[toIndex - 1]?.sortKey ?? null;
  const after = remaining[toIndex]?.sortKey ?? null;
  return generateKeyBetween(before, after);
}

/**
 * The number a numbered-list block shows: its position within the unbroken run of numbered items
 * it belongs to, so a list interrupted by a paragraph restarts at 1 rather than counting on.
 */
export function numberedListNumber(pageBlocks: BlockRecord[], index: number): number {
  // Any other type has no number, and 1 keeps the value meaningless rather than misleading.
  if (pageBlocks[index]?.type !== 'numberedList') return 1;
  let number = 1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (pageBlocks[cursor]?.type !== 'numberedList') break;
    number += 1;
  }
  return number;
}

/** The type-specific extras a block carries. All fields are optional by type. */
export interface BlockProps {
  language?: string;
  emoji?: string;
  /**
   * Set on paragraph children of a toggleList block. Points to the toggle header's block id.
   * The toggle header renders open/closed; children with this prop render indented beneath it.
   * Future: to support nested toggles (toggleList children of another toggleList), this field
   * would need to be checked on toggleList blocks too, and BlockEditor's grouping logic would
   * recurse rather than treating only paragraphs as children.
   */
  parentToggleId?: string;
}

/** Parses the `props` JSON string. Malformed props read as empty rather than breaking the page. */
export function parseBlockProps(props: string | null): BlockProps {
  if (!props) return {};
  try {
    const parsed: unknown = JSON.parse(props);
    return typeof parsed === 'object' && parsed !== null ? (parsed as BlockProps) : {};
  } catch {
    return {};
  }
}

/** Whether a type has editable text at all - only the divider does not. */
export function isTextualBlock(type: BlockType): boolean {
  return type !== 'divider';
}
