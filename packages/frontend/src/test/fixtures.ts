import type {
  BlockRecord,
  PageRecord,
  PropertyRecord,
  PropertyValueRecord,
  SelectOption,
} from '../api/types';

// A fixture snapshot shaped like the seeded workspace: two top-level pages, one of them with a
// child and a grandchild, so tests exercise nesting deeper than one level.

/** Builds a page record, with sensible defaults for the fields a test does not care about. */
export function makePage(page: Partial<PageRecord> & Pick<PageRecord, 'id' | 'title'>): PageRecord {
  return {
    parentId: null,
    icon: '\u{1F4C4}',
    sortKey: 'a0',
    kind: 'page',
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...page,
  };
}

/** Builds a property record, with sensible defaults. */
export function makeProperty(
  prop: Partial<PropertyRecord> & Pick<PropertyRecord, 'id' | 'databasePageId' | 'name' | 'type'>,
): PropertyRecord {
  return {
    options: [],
    sortKey: 'a0',
    version: 1,
    updatedAt: 1700000000000,
    ...prop,
  };
}

/** Builds a property value record. */
export function makeValue(
  value: Partial<PropertyValueRecord> & Pick<PropertyValueRecord, 'rowPageId' | 'propertyId'>,
): PropertyValueRecord {
  return {
    value: null,
    version: 1,
    updatedAt: 1700000000000,
    ...value,
  };
}

/** A handful of select options used in tests. */
export const fixtureOptions: SelectOption[] = [
  { id: 'opt-1', name: 'Todo', color: 'gray' },
  { id: 'opt-2', name: 'In progress', color: 'blue' },
  { id: 'opt-3', name: 'Done', color: 'teal' },
];

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

/** A minimal fixture database with two rows and one property, for database-feature tests. */
export const fixtureDatabase = makePage({
  id: 'p-db',
  title: 'Projects',
  kind: 'database',
  icon: '\u{1F4CA}',
});
export const fixtureRows = [
  makePage({ id: 'p-row-1', title: 'Row 1', kind: 'row', parentId: 'p-db', sortKey: 'a0' }),
  makePage({ id: 'p-row-2', title: 'Row 2', kind: 'row', parentId: 'p-db', sortKey: 'a1' }),
];
export const fixtureProperty = makeProperty({
  id: 'prop-1',
  databasePageId: 'p-db',
  name: 'Status',
  type: 'select',
  options: fixtureOptions,
});
export const fixtureValue = makeValue({
  rowPageId: 'p-row-1',
  propertyId: 'prop-1',
  value: JSON.stringify('opt-1'),
});

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
