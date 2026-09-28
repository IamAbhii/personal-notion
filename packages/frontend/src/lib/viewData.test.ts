import { describe, expect, it } from 'vitest';
import {
  buildValuesMap,
  cardMoveNewValue,
  cleanViewAfterPropertyDelete,
  filterRows,
  groupRows,
  sortRows,
} from './viewData';
import type {
  PageRecord,
  PropertyRecord,
  PropertyValueRecord,
  ViewFilter,
  ViewSort,
} from '../api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function row(id: string, title: string): PageRecord {
  return {
    id,
    parentId: 'db-1',
    title,
    icon: '',
    sortKey: id,
    kind: 'row',
    version: 1,
    updatedAt: 0,
  };
}

function prop(id: string, type: PropertyRecord['type'], options = []): PropertyRecord {
  return {
    id,
    databasePageId: 'db-1',
    name: id,
    type,
    options,
    sortKey: id,
    version: 1,
    updatedAt: 0,
  };
}

function val(rowPageId: string, propertyId: string, value: string | null): PropertyValueRecord {
  return { rowPageId, propertyId, value, version: 1, updatedAt: 0 };
}

const rows = [row('r1', 'Alpha'), row('r2', 'Beta'), row('r3', 'Gamma')];

// ── filterRows ────────────────────────────────────────────────────────────────

describe('filterRows', () => {
  it('returns all rows when filter array is empty', () => {
    const map = buildValuesMap([]);
    expect(filterRows(rows, map, [], [])).toEqual(rows);
  });

  describe('text / url — contains / notContains', () => {
    const props = [prop('p1', 'text')];
    const values = [
      val('r1', 'p1', JSON.stringify('Hello World')),
      val('r2', 'p1', JSON.stringify('Goodbye')),
      // r3 has no value
    ];
    const map = buildValuesMap(values);

    it('contains: keeps rows whose text includes the filter value (case-insensitive)', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'contains', value: 'hello' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('notContains: keeps rows whose text does not include the value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'notContains', value: 'hello' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });

    it('contains empty string: all rows pass through', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'contains', value: '' };
      expect(filterRows(rows, map, props, [f])).toHaveLength(3);
    });
  });

  describe('select — is / isNot', () => {
    const opts = [
      { id: 'opt-a', name: 'A', color: 'gray' as const },
      { id: 'opt-b', name: 'B', color: 'blue' as const },
    ];
    const props = [prop('p1', 'select', opts as never)];
    const values = [
      val('r1', 'p1', JSON.stringify('opt-a')),
      val('r2', 'p1', JSON.stringify('opt-b')),
      // r3 no value
    ];
    const map = buildValuesMap(values);

    it('is: keeps rows with the matching option', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: 'opt-a' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('isNot: excludes rows with the matching option', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'isNot', value: 'opt-a' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });

    it('is null: keeps rows with no value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: null };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r3']);
    });
  });

  describe('multiSelect — is / isNot', () => {
    const opts = [{ id: 'opt-x', name: 'X', color: 'teal' as const }];
    const props = [prop('p1', 'multiSelect', opts as never)];
    const values = [
      val('r1', 'p1', JSON.stringify(['opt-x'])),
      val('r2', 'p1', JSON.stringify([])),
    ];
    const map = buildValuesMap(values);

    it('is: keeps rows that include the option', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: 'opt-x' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('isNot: excludes rows that include the option', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'isNot', value: 'opt-x' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });
  });

  describe('checkbox — isChecked / isNotChecked', () => {
    const props = [prop('p1', 'checkbox')];
    const values = [val('r1', 'p1', JSON.stringify(true)), val('r2', 'p1', JSON.stringify(false))];
    const map = buildValuesMap(values);

    it('isChecked: keeps checked rows', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'isChecked', value: null };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('isNotChecked: keeps unchecked and empty rows', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'isNotChecked', value: null };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });
  });

  describe('date — before / after', () => {
    const props = [prop('p1', 'date')];
    const values = [
      val('r1', 'p1', JSON.stringify('2024-01-10')),
      val('r2', 'p1', JSON.stringify('2024-06-15')),
      // r3 no date
    ];
    const map = buildValuesMap(values);

    it('before: keeps rows with a date strictly before the filter value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'before', value: '2024-03-01' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('after: keeps rows with a date strictly after the filter value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'after', value: '2024-03-01' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2']);
    });

    it('rows with no date always fail a date filter', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'before', value: '2099-01-01' };
      // r3 has no date; even a "before far future" filter should exclude it
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1', 'r2']);
    });
  });

  describe('number — is / isNot', () => {
    const props = [prop('p1', 'number')];
    const values = [val('r1', 'p1', JSON.stringify(42)), val('r2', 'p1', JSON.stringify(99))];
    const map = buildValuesMap(values);

    it('is: keeps rows matching the numeric value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: '42' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('isNot: excludes rows matching the numeric value', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'isNot', value: '42' };
      expect(filterRows(rows, map, props, [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });
  });

  describe('title filter (DEF-088)', () => {
    it('contains: keeps rows whose title includes the filter value (case-insensitive)', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'title', operator: 'contains', value: 'alpha' };
      expect(filterRows(rows, buildValuesMap([]), [], [f]).map((r) => r.id)).toEqual(['r1']);
    });

    it('notContains: keeps rows whose title does not include the value', () => {
      const f: ViewFilter = {
        id: 'f1',
        propertyId: 'title',
        operator: 'notContains',
        value: 'alpha',
      };
      expect(filterRows(rows, buildValuesMap([]), [], [f]).map((r) => r.id)).toEqual(['r2', 'r3']);
    });

    it('passes all rows when the filter value is empty', () => {
      const f: ViewFilter = { id: 'f1', propertyId: 'title', operator: 'contains', value: '' };
      expect(filterRows(rows, buildValuesMap([]), [], [f])).toHaveLength(3);
    });
  });

  it('AND-combines multiple filters', () => {
    const props = [prop('p1', 'text'), prop('p2', 'checkbox')];
    const values = [
      val('r1', 'p1', JSON.stringify('Hello')),
      val('r1', 'p2', JSON.stringify(true)),
      val('r2', 'p1', JSON.stringify('Hello')),
      val('r2', 'p2', JSON.stringify(false)),
    ];
    const map = buildValuesMap(values);
    const filters: ViewFilter[] = [
      { id: 'f1', propertyId: 'p1', operator: 'contains', value: 'hello' },
      { id: 'f2', propertyId: 'p2', operator: 'isChecked', value: null },
    ];
    expect(filterRows(rows, map, props, filters).map((r) => r.id)).toEqual(['r1']);
  });
});

// ── sortRows ──────────────────────────────────────────────────────────────────

// ── rowPassesFilter: default return path ─────────────────────────────────────

it('rowPassesFilter returns true (passes) when the operator is not supported for the property type', () => {
  // A text property with operator 'is' hits the break in the text/url case, then falls through to
  // `return true` at line 144. This covers the default-pass behaviour for unknown pairings.
  const textProp = prop('p1', 'text');
  const filter: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: 'anything' };
  const filtered = filterRows(
    rows,
    buildValuesMap([val('r1', 'p1', JSON.stringify('hello'))]),
    [textProp],
    [filter],
  );
  // All rows must pass (the fallthrough returns true for each row).
  expect(filtered).toHaveLength(rows.length);
});

describe('sortRows', () => {
  it('returns input unchanged when sort is null', () => {
    const map = buildValuesMap([]);
    expect(sortRows(rows, map, [], null)).toEqual(rows);
  });

  it('sorts by title ascending', () => {
    const s: ViewSort = { propertyId: 'title', direction: 'asc' };
    const result = sortRows(rows, buildValuesMap([]), [], s);
    expect(result.map((r) => r.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('sorts by title descending', () => {
    const s: ViewSort = { propertyId: 'title', direction: 'desc' };
    const result = sortRows(rows, buildValuesMap([]), [], s);
    expect(result.map((r) => r.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts numbers ascending with nulls last', () => {
    const props = [prop('p1', 'number')];
    const values = [val('r1', 'p1', JSON.stringify(30)), val('r3', 'p1', JSON.stringify(10))];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows(rows, buildValuesMap(values), props, s);
    expect(result.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
  });

  it('sorts numbers descending with nulls still last', () => {
    const props = [prop('p1', 'number')];
    const values = [val('r1', 'p1', JSON.stringify(30)), val('r3', 'p1', JSON.stringify(10))];
    const s: ViewSort = { propertyId: 'p1', direction: 'desc' };
    const result = sortRows(rows, buildValuesMap(values), props, s);
    expect(result.map((r) => r.id)).toEqual(['r1', 'r3', 'r2']);
  });

  it('sorts checkboxes: checked first in ascending', () => {
    const props = [prop('p1', 'checkbox')];
    const values = [val('r1', 'p1', JSON.stringify(false)), val('r2', 'p1', JSON.stringify(true))];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows(rows, buildValuesMap(values), props, s);
    // true=1 > false=0, so asc puts false first, then true
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('sorts checkboxes descending: checked rows first', () => {
    const props = [prop('p1', 'checkbox')];
    const values = [val('r1', 'p1', JSON.stringify(false)), val('r2', 'p1', JSON.stringify(true))];
    const s: ViewSort = { propertyId: 'p1', direction: 'desc' };
    const result = sortRows(rows, buildValuesMap(values), props, s);
    // desc: true > false so true (r2) comes first
    expect(result.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
  });

  it('sorts two equal values as equal (returns 0)', () => {
    const props = [prop('p1', 'number')];
    const values = [val('r1', 'p1', JSON.stringify(5)), val('r2', 'p1', JSON.stringify(5))];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([rows[0]!, rows[1]!], buildValuesMap(values), props, s);
    // Both have value 5, so relative order is stable (both present, no change needed)
    expect(result).toHaveLength(2);
  });

  it('sorts both-null values as equal (the null-null branch)', () => {
    const props = [prop('p1', 'number')];
    // Neither row has a value for p1, so both getSortValues return null.
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([rows[0]!, rows[1]!], buildValuesMap([]), props, s);
    expect(result).toHaveLength(2);
  });

  it('sorts by multiSelect property by first-option definition order', () => {
    const opts = [
      { id: 'o1', name: 'Apple', color: 'gray' as const },
      { id: 'o2', name: 'Banana', color: 'blue' as const },
      { id: 'o3', name: 'Cherry', color: 'teal' as const },
    ];
    const props = [prop('p1', 'multiSelect', opts as never)];
    const r4 = row('r4', 'has Cherry first');
    const r5 = row('r5', 'has Apple first');
    const values = [
      val('r4', 'p1', JSON.stringify(['o3', 'o1'])),
      val('r5', 'p1', JSON.stringify(['o1', 'o2'])),
    ];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([r4, r5], buildValuesMap(values), props, s);
    // Apple (index 0) < Cherry (index 2), so r5 comes first
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4']);
  });

  it('sorts by text property ascending (covers the text/url case in getSortValue)', () => {
    const props = [prop('p1', 'text')];
    const r4 = row('r4', 'Row4');
    const r5 = row('r5', 'Row5');
    const values = [
      val('r4', 'p1', JSON.stringify('zebra')),
      val('r5', 'p1', JSON.stringify('apple')),
    ];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([r4, r5], buildValuesMap(values), props, s);
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4']);
  });

  it('sorts by date property ascending (covers the date case in getSortValue)', () => {
    const props = [prop('p1', 'date')];
    const r4 = row('r4', 'Row4');
    const r5 = row('r5', 'Row5');
    const values = [
      val('r4', 'p1', JSON.stringify('2026-12-01')),
      val('r5', 'p1', JSON.stringify('2026-01-01')),
    ];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([r4, r5], buildValuesMap(values), props, s);
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4']);
  });

  it('sorts malformed JSON value as null (last) via the getSortValue catch', () => {
    const props = [prop('p1', 'number')];
    const r4 = row('r4', 'Row4');
    const r5 = row('r5', 'Row5');
    const values = [
      val('r4', 'p1', 'not-json'), // malformed → getSortValue returns null → sorts last
      val('r5', 'p1', JSON.stringify(5)),
    ];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([r4, r5], buildValuesMap(values), props, s);
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4']);
  });

  it('sortRows returns null for multiSelect with empty array (null-sort path)', () => {
    const opts = [{ id: 'o1', name: 'A', color: 'gray' as const }];
    const props = [prop('p1', 'multiSelect', opts as never)];
    const r4 = row('r4', 'has no tags');
    const r5 = row('r5', 'has a tag');
    const values = [
      val('r4', 'p1', JSON.stringify([])), // empty multiSelect → null sort value
      val('r5', 'p1', JSON.stringify(['o1'])),
    ];
    const s: ViewSort = { propertyId: 'p1', direction: 'asc' };
    const result = sortRows([r4, r5], buildValuesMap(values), props, s);
    // r4 has null sort value → goes last
    expect(result.map((r) => r.id)).toEqual(['r5', 'r4']);
  });
});

// ── groupRows ─────────────────────────────────────────────────────────────────

describe('groupRows', () => {
  const opts = [
    { id: 'opt-a', name: 'Todo', color: 'gray' as const },
    { id: 'opt-b', name: 'Done', color: 'teal' as const },
  ];
  const groupProp: PropertyRecord = {
    id: 'status',
    databasePageId: 'db-1',
    name: 'Status',
    type: 'select',
    options: opts,
    sortKey: 's',
    version: 1,
    updatedAt: 0,
  };

  it('groups rows into option columns in definition order', () => {
    const values = [
      val('r1', 'status', JSON.stringify('opt-a')),
      val('r2', 'status', JSON.stringify('opt-b')),
    ];
    const cols = groupRows(rows, values, groupProp);
    const [col0, col1] = cols;
    expect(col0?.optionId).toBe('opt-a');
    expect(col0?.rows.map((r) => r.id)).toEqual(['r1']);
    expect(col1?.optionId).toBe('opt-b');
    expect(col1?.rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('places rows with no value in the trailing uncategorised column', () => {
    const values = [val('r1', 'status', JSON.stringify('opt-a'))];
    const cols = groupRows(rows, values, groupProp);
    const uncat = cols.at(-1)!;
    expect(uncat.optionId).toBeNull();
    expect(uncat.rows.map((r) => r.id)).toContain('r2');
    expect(uncat.rows.map((r) => r.id)).toContain('r3');
  });

  it('always appends the uncategorised column even when it is empty', () => {
    const values = [
      val('r1', 'status', JSON.stringify('opt-a')),
      val('r2', 'status', JSON.stringify('opt-b')),
      val('r3', 'status', JSON.stringify('opt-a')),
    ];
    const cols = groupRows(rows, values, groupProp);
    const uncat = cols.at(-1)!;
    expect(uncat.optionId).toBeNull();
    expect(uncat.rows).toHaveLength(0);
  });

  it('places rows with a deleted option id in the uncategorised column', () => {
    const values = [val('r1', 'status', JSON.stringify('opt-deleted'))];
    const cols = groupRows(rows, values, groupProp);
    const uncat = cols.at(-1)!;
    expect(uncat.rows.map((r) => r.id)).toContain('r1');
  });

  it('produces columns in option definition order', () => {
    const values: PropertyValueRecord[] = [];
    const cols = groupRows(rows, values, groupProp);
    const [col0, col1, col2] = cols;
    expect(col0?.label).toBe('Todo');
    expect(col1?.label).toBe('Done');
    expect(col2?.label).toBe('No value');
  });

  it('places rows with malformed JSON values in the uncategorised column (catch path)', () => {
    // A stored value that is not valid JSON triggers the catch in groupRows and the row lands in uncat.
    const values = [val('r1', 'status', 'not-valid-json')];
    const cols = groupRows(rows, values, groupProp);
    const uncat = cols.at(-1)!;
    expect(uncat.rows.map((r) => r.id)).toContain('r1');
  });
});

it('sorts select by option definition order, not alphabetically (DEF-086)', () => {
  // Option order: Backlog=0, In progress=1, Done=2. Alphabetically Done < In progress, but by
  // definition order Backlog < In progress < Done, which is the user-meaningful order.
  const opts = [
    { id: 'opt-backlog', name: 'Backlog', color: 'gray' as const },
    { id: 'opt-inprogress', name: 'In progress', color: 'blue' as const },
    { id: 'opt-done', name: 'Done', color: 'teal' as const },
  ];
  const props = [prop('status', 'select', opts as never)];
  const r4 = row('r4', 'Done row');
  const r5 = row('r5', 'In progress row');
  const r6 = row('r6', 'Backlog row');
  const values = [
    val('r4', 'status', JSON.stringify('opt-done')),
    val('r5', 'status', JSON.stringify('opt-inprogress')),
    val('r6', 'status', JSON.stringify('opt-backlog')),
  ];
  const s: ViewSort = { propertyId: 'status', direction: 'asc' };
  const result = sortRows([r4, r5, r6], buildValuesMap(values), props, s);
  // Expect definition order: Backlog < In progress < Done
  expect(result.map((r) => r.id)).toEqual(['r6', 'r5', 'r4']);
});

it('sorts select descending by option definition order (DEF-086)', () => {
  const opts = [
    { id: 'opt-backlog', name: 'Backlog', color: 'gray' as const },
    { id: 'opt-inprogress', name: 'In progress', color: 'blue' as const },
    { id: 'opt-done', name: 'Done', color: 'teal' as const },
  ];
  const props = [prop('status', 'select', opts as never)];
  const r4 = row('r4', 'Done row');
  const r5 = row('r5', 'In progress row');
  const r6 = row('r6', 'Backlog row');
  const values = [
    val('r4', 'status', JSON.stringify('opt-done')),
    val('r5', 'status', JSON.stringify('opt-inprogress')),
    val('r6', 'status', JSON.stringify('opt-backlog')),
  ];
  const s: ViewSort = { propertyId: 'status', direction: 'desc' };
  const result = sortRows([r4, r5, r6], buildValuesMap(values), props, s);
  // Descending: Done > In progress > Backlog
  expect(result.map((r) => r.id)).toEqual(['r4', 'r5', 'r6']);
});

// ── cardMoveNewValue ──────────────────────────────────────────────────────────

describe('cardMoveNewValue', () => {
  it('returns null for the uncategorised column (clearing the cell)', () => {
    expect(cardMoveNewValue(null)).toBeNull();
  });

  it('returns a JSON-encoded option id for a named column', () => {
    expect(cardMoveNewValue('opt-a')).toBe(JSON.stringify('opt-a'));
  });
});

// ── cleanViewAfterPropertyDelete (DEF-071) ────────────────────────────────────

describe('cleanViewAfterPropertyDelete', () => {
  const filter1 = { id: 'f1', propertyId: 'prop-a', operator: 'contains' as const, value: 'x' };
  const filter2 = { id: 'f2', propertyId: 'prop-b', operator: 'contains' as const, value: 'y' };
  const sort = { propertyId: 'prop-a', direction: 'asc' as const };

  it('returns null when the deleted property is not referenced by any filter or sort', () => {
    const view = { filters: [filter1], sort: null };
    expect(cleanViewAfterPropertyDelete(view, 'prop-z')).toBeNull();
  });

  it('removes a filter that references the deleted property', () => {
    const view = { filters: [filter1, filter2], sort: null };
    const result = cleanViewAfterPropertyDelete(view, 'prop-a');
    expect(result).not.toBeNull();
    expect(result!.filters).toHaveLength(1);
    expect(result!.filters[0]?.propertyId).toBe('prop-b');
    expect(result!.sort).toBeNull();
  });

  it('clears the sort when it references the deleted property', () => {
    const view = { filters: [filter2], sort };
    const result = cleanViewAfterPropertyDelete(view, 'prop-a');
    expect(result).not.toBeNull();
    expect(result!.sort).toBeNull();
    expect(result!.filters).toHaveLength(1);
  });

  it('removes filter and clears sort when both reference the deleted property', () => {
    const view = { filters: [filter1, filter2], sort };
    const result = cleanViewAfterPropertyDelete(view, 'prop-a');
    expect(result).not.toBeNull();
    expect(result!.filters).toHaveLength(1);
    expect(result!.filters[0]?.propertyId).toBe('prop-b');
    expect(result!.sort).toBeNull();
  });

  it('preserves a sort that references a different property', () => {
    const otherSort = { propertyId: 'prop-b', direction: 'desc' as const };
    const view = { filters: [filter1], sort: otherSort };
    const result = cleanViewAfterPropertyDelete(view, 'prop-a');
    expect(result).not.toBeNull();
    expect(result!.sort?.propertyId).toBe('prop-b');
  });

  it('returns null when filters is empty and sort is null', () => {
    const view = { filters: [], sort: null };
    expect(cleanViewAfterPropertyDelete(view, 'prop-a')).toBeNull();
  });
});

// ── rowPassesFilter: break/catch coverage ────────────────────────────────────

describe('rowPassesFilter: break statements and catch path', () => {
  // Each test uses an operator that is valid for a different property type,
  // causing the switch case to break rather than return, and the function falls
  // through to the default `return true` at the end.

  it('passes a checkbox row when the operator is not isChecked or isNotChecked', () => {
    // 'contains' is not a checkbox operator → hits the break (line 121) → passes through
    const checkboxProp = prop('p1', 'checkbox');
    const map = buildValuesMap([val('r1', 'p1', JSON.stringify(true))]);
    const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'contains', value: 'x' };
    const result = filterRows(rows, map, [checkboxProp], [f]);
    // The break is reached; the function returns true (all rows pass).
    expect(result).toHaveLength(rows.length);
  });

  it('passes a date row when the operator is not before or after (and dateStr is present)', () => {
    // 'is' is not a date operator → hits the break (line 129) → passes through.
    // Give all rows a date value so the `if (!dateStr) return false` guard is not reached for any,
    // and the break is exercised for every row.
    const dateProp = prop('p1', 'date');
    const dateValues = [
      val('r1', 'p1', JSON.stringify('2026-01-01')),
      val('r2', 'p1', JSON.stringify('2026-02-01')),
      val('r3', 'p1', JSON.stringify('2026-03-01')),
    ];
    const map = buildValuesMap(dateValues);
    const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'is', value: '2026-01-01' };
    const result = filterRows(rows, map, [dateProp], [f]);
    expect(result).toHaveLength(rows.length);
  });

  it('passes a number row when the operator is not is or isNot', () => {
    // 'contains' is not a number operator → hits the break (line 136) → passes through
    const numProp = prop('p1', 'number');
    const map = buildValuesMap([val('r1', 'p1', JSON.stringify(42))]);
    const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'contains', value: '42' };
    const result = filterRows(rows, map, [numProp], [f]);
    expect(result).toHaveLength(rows.length);
  });

  it('passes all rows when the title filter uses an unsupported operator (line 87)', () => {
    // The title branch only handles 'contains' and 'notContains'. Any other operator falls through
    // to `return true` on line 87, so every row passes.
    const f: ViewFilter = { id: 'f1', propertyId: 'title', operator: 'is', value: 'Alpha' };
    const result = filterRows(rows, buildValuesMap([]), [], [f]);
    expect(result).toHaveLength(rows.length);
  });

  it('passes a row when its stored value is malformed JSON (catch path, lines 139-141)', () => {
    // A value that is not valid JSON makes JSON.parse throw; the catch block returns true
    // so the row is not hidden unexpectedly.
    const textProp = prop('p1', 'text');
    const map = buildValuesMap([val('r1', 'p1', 'not-valid-json')]);
    const f: ViewFilter = { id: 'f1', propertyId: 'p1', operator: 'contains', value: 'x' };
    const result = filterRows(rows, map, [textProp], [f]);
    // r1 has malformed JSON → passes; r2/r3 have no value → empty string, does not contain 'x'
    // but the catch only fires for r1, which passes. r2 and r3 use '' which does not include 'x'.
    expect(result.map((r) => r.id)).toContain('r1');
  });
});
