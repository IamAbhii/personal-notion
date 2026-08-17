// Pure data-manipulation functions for the view system. No React, no side effects — these are
// the logic layer that view components and unit tests call directly.

import type {
  FilterOperator,
  OptionColor,
  PageRecord,
  PropertyRecord,
  PropertyType,
  PropertyValueRecord,
  ViewFilter,
  ViewSort,
} from '../api/types';

// ── Operators per type ────────────────────────────────────────────────────────

/**
 * The legal filter operators for each property type. Offering only legal operators in the UI
 * prevents server rejections without needing a round trip to learn about them.
 */
export const LEGAL_OPERATORS: Record<PropertyType, FilterOperator[]> = {
  text: ['contains', 'notContains'],
  url: ['contains', 'notContains'],
  select: ['is', 'isNot'],
  multiSelect: ['is', 'isNot'],
  checkbox: ['isChecked', 'isNotChecked'],
  date: ['before', 'after'],
  number: ['is', 'isNot'],
};

/** Human-readable labels for each filter operator, used by the filter control UI. */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  is: 'is',
  isNot: 'is not',
  before: 'before',
  after: 'after',
  isChecked: 'is checked',
  isNotChecked: 'is not checked',
};

// ── Value map helpers ─────────────────────────────────────────────────────────

/**
 * Builds a two-level lookup from a flat property-values list so filter and sort can access a
 * row's values in O(1). Callers that already have the map (e.g. the table view) can skip this.
 */
export function buildValuesMap(
  values: PropertyValueRecord[],
): Map<string, Map<string, string | null>> {
  const map = new Map<string, Map<string, string | null>>();
  for (const v of values) {
    if (!map.has(v.rowPageId)) map.set(v.rowPageId, new Map());
    map.get(v.rowPageId)!.set(v.propertyId, v.value);
  }
  return map;
}

// ── Filter ────────────────────────────────────────────────────────────────────

/**
 * Whether one row satisfies a single filter condition. Returns true (pass through) for unknown
 * properties, unsupported operator-type pairings and malformed values rather than hiding the row.
 */
function rowPassesFilter(
  _row: PageRecord,
  rowValues: Map<string, string | null>,
  properties: PropertyRecord[],
  filter: ViewFilter,
): boolean {
  const property = properties.find((p) => p.id === filter.propertyId);
  if (!property) return true;

  const raw = rowValues.get(filter.propertyId) ?? null;
  const op = filter.operator;
  const filterVal = filter.value;

  try {
    switch (property.type) {
      case 'text':
      case 'url': {
        const str = raw !== null ? (JSON.parse(raw) as string) : '';
        const fv = filterVal ?? '';
        if (op === 'contains') return str.toLowerCase().includes(fv.toLowerCase());
        if (op === 'notContains') return !str.toLowerCase().includes(fv.toLowerCase());
        break;
      }
      case 'select': {
        const optId = raw !== null ? (JSON.parse(raw) as string) : null;
        if (op === 'is') return optId === filterVal;
        if (op === 'isNot') return optId !== filterVal;
        break;
      }
      case 'multiSelect': {
        const optIds = raw !== null ? (JSON.parse(raw) as string[]) : [];
        if (op === 'is') return filterVal !== null && optIds.includes(filterVal);
        if (op === 'isNot') return filterVal === null || !optIds.includes(filterVal);
        break;
      }
      case 'checkbox': {
        const checked = raw !== null ? (JSON.parse(raw) as boolean) : false;
        if (op === 'isChecked') return checked;
        if (op === 'isNotChecked') return !checked;
        break;
      }
      case 'date': {
        const dateStr = raw !== null ? (JSON.parse(raw) as string) : null;
        // Rows with no date value fail any date filter — there is nothing to compare.
        if (!dateStr) return false;
        if (op === 'before') return filterVal !== null && dateStr < filterVal;
        if (op === 'after') return filterVal !== null && dateStr > filterVal;
        break;
      }
      case 'number': {
        const num = raw !== null ? (JSON.parse(raw) as number) : null;
        const filterNum = filterVal !== null ? Number(filterVal) : null;
        if (op === 'is') return num === filterNum;
        if (op === 'isNot') return num !== filterNum;
        break;
      }
    }
  } catch {
    // Malformed stored value: pass the row through rather than hiding it unexpectedly.
    return true;
  }

  return true;
}

/**
 * Applies an AND-combined filter set to a list of rows. An empty filter array returns all rows.
 * Callers pass the pre-built values map so the map is built once per render, not once per filter.
 */
export function filterRows(
  rows: PageRecord[],
  valuesMap: Map<string, Map<string, string | null>>,
  properties: PropertyRecord[],
  filters: ViewFilter[],
): PageRecord[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => {
    const rowValues = valuesMap.get(row.id) ?? new Map<string, string | null>();
    return filters.every((f) => rowPassesFilter(row, rowValues, properties, f));
  });
}

// ── Sort ──────────────────────────────────────────────────────────────────────

/**
 * Extracts a comparable primitive for sorting. Returns null for empty cells, which sort to the
 * end regardless of direction (they have no meaningful position in a partial order).
 */
function getSortValue(
  row: PageRecord,
  rowValues: Map<string, string | null>,
  properties: PropertyRecord[],
  propertyId: string,
): string | number | boolean | null {
  // 'title' is a special value meaning the row's own page title.
  if (propertyId === 'title') return row.title;

  const property = properties.find((p) => p.id === propertyId);
  if (!property) return null;

  const raw = rowValues.get(propertyId) ?? null;
  if (raw === null) return null;

  try {
    switch (property.type) {
      case 'text':
      case 'url':
        return JSON.parse(raw) as string;
      case 'number':
        return JSON.parse(raw) as number;
      case 'checkbox':
        return JSON.parse(raw) as boolean;
      case 'date':
        // YYYY-MM-DD strings sort lexicographically, which is correct.
        return JSON.parse(raw) as string;
      case 'select': {
        // Sort by the option name, not its id, so the order is human-readable.
        const optId = JSON.parse(raw) as string;
        return property.options.find((o) => o.id === optId)?.name ?? null;
      }
      case 'multiSelect': {
        // Multi-select sort by the first option's name in selection order.
        const optIds = JSON.parse(raw) as string[];
        if (optIds.length === 0) return null;
        return property.options.find((o) => o.id === optIds[0])?.name ?? null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Sorts a row list by a single ViewSort descriptor. Null sort returns the input unchanged.
 * Null cell values always sort to the end, independent of direction.
 */
export function sortRows(
  rows: PageRecord[],
  valuesMap: Map<string, Map<string, string | null>>,
  properties: PropertyRecord[],
  sort: ViewSort | null,
): PageRecord[] {
  if (!sort) return rows;
  const { propertyId, direction } = sort;
  const multiplier = direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = getSortValue(a, valuesMap.get(a.id) ?? new Map(), properties, propertyId);
    const vb = getSortValue(b, valuesMap.get(b.id) ?? new Map(), properties, propertyId);

    // Null values always go last.
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;

    // Booleans: true > false (checked rows at the top in ascending order).
    if (typeof va === 'boolean' && typeof vb === 'boolean') {
      return multiplier * (Number(va) - Number(vb));
    }
    // Numbers and date strings and text strings all compare the same way.
    if (va < vb) return -1 * multiplier;
    if (va > vb) return 1 * multiplier;
    return 0;
  });
}

// ── Group (board) ─────────────────────────────────────────────────────────────

/** One column in the board view, corresponding to one select option or the uncategorised bucket. */
export interface BoardColumn {
  /** The option id, or null for the trailing uncategorised column. */
  optionId: string | null;
  /** Human-readable column header. */
  label: string;
  /** Option color, undefined for the uncategorised column. */
  color: OptionColor | undefined;
  /** The rows that belong in this column, in sort-key order from the caller. */
  rows: PageRecord[];
}

/**
 * Groups rows into board columns by a select property. Columns appear in option definition order
 * so the board reflects the property's option order, which the user controls. A trailing
 * uncategorised column collects rows whose select cell is empty or whose option no longer exists.
 *
 * The uncategorised column is always appended so it is always a valid drop target, even when empty.
 */
export function groupRows(
  rows: PageRecord[],
  values: PropertyValueRecord[],
  groupProperty: PropertyRecord,
): BoardColumn[] {
  // Fast lookup: rowId → raw JSON value for this property only.
  const rowToRaw = new Map<string, string | null>();
  for (const v of values) {
    if (v.propertyId === groupProperty.id) rowToRaw.set(v.rowPageId, v.value);
  }

  // One column per option in definition order.
  const columns: BoardColumn[] = groupProperty.options.map((opt) => ({
    optionId: opt.id,
    label: opt.name,
    color: opt.color,
    rows: [],
  }));

  // Always include a trailing uncategorised column as a drop target.
  const uncategorised: BoardColumn = {
    optionId: null,
    label: 'No value',
    color: undefined,
    rows: [],
  };

  for (const row of rows) {
    const raw = rowToRaw.get(row.id) ?? null;
    if (raw === null) {
      uncategorised.rows.push(row);
      continue;
    }
    try {
      const optId = JSON.parse(raw) as string;
      const col = columns.find((c) => c.optionId === optId);
      if (col) {
        col.rows.push(row);
      } else {
        // Option id stored but no matching option (deleted option): treat as uncategorised.
        uncategorised.rows.push(row);
      }
    } catch {
      // Malformed value: treat as uncategorised.
      uncategorised.rows.push(row);
    }
  }

  columns.push(uncategorised);
  return columns;
}

// ── Card move ─────────────────────────────────────────────────────────────────

/**
 * Returns the raw JSON value to write via `value.set` when a card is dropped on a board column.
 * Dropping on the uncategorised column (optionId null) clears the cell.
 */
export function cardMoveNewValue(targetColumnOptionId: string | null): string | null {
  return targetColumnOptionId === null ? null : JSON.stringify(targetColumnOptionId);
}
