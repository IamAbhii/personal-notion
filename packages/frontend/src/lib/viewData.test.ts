import { describe, expect, it } from 'vitest';
import { buildValuesMap, cardMoveNewValue, filterRows, groupRows, sortRows } from './viewData';
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
