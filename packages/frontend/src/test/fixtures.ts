import type { BlockRecord, PageRecord } from '../api/types';

// A fixture snapshot shaped like the seeded workspace: two top-level pages, one of them with a
// child and a grandchild, so tests exercise nesting deeper than one level.

/** Builds a page record, with sensible defaults for the fields a test does not care about. */
export function makePage(page: Partial<PageRecord> & Pick<PageRecord, 'id' | 'title'>): PageRecord {
  return {
    parentId: null,
    icon: '\u{1F4C4}',
    sortKey: 'a0',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...page,
  };
}

/** The fixture tree: Journal (with Trips > Lisbon) then Reading list, in sortKey order. */
export const fixturePages: PageRecord[] = [
  makePage({ id: 'p-journal', title: 'Journal', icon: '\u{1F4D3}', sortKey: 'a0' }),
  makePage({ id: 'p-reading', title: 'Reading list', icon: '\u{1F4DA}', sortKey: 'a1' }),
  makePage({
    id: 'p-trips',
    title: 'Trips',
    icon: '✈️',
    parentId: 'p-journal',
    sortKey: 'a0',
  }),
  makePage({
    id: 'p-lisbon',
    title: 'Lisbon',
    icon: '\u{1F1F5}\u{1F1F9}',
    parentId: 'p-trips',
    sortKey: 'a0',
  }),
];

/** Builds a block record, with defaults for the fields a test does not care about. */
export function makeBlock(
  block: Partial<BlockRecord> & Pick<BlockRecord, 'id' | 'pageId'>,
): BlockRecord {
  return {
    type: 'paragraph',
    text: '',
    checked: false,
    props: null,
    sortKey: 'a0',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...block,
  };
}
