import { useState } from 'react';
import { ChevronDown, Filter, Plus, SortAsc, SortDesc, X } from 'lucide-react';
import { Popover } from '../ui/Popover/Popover';
import { cn } from '../../lib/cn';
import { LEGAL_OPERATORS, OPERATOR_LABELS, TITLE_FILTER_OPERATORS } from '../../lib/viewData';
import type {
  FilterOperator,
  PageRecord,
  PropertyRecord,
  PropertyType,
  ViewFilter,
  ViewKind,
  ViewRecord,
  ViewSort,
} from '../../api/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Whether the operator needs a user-supplied value (isChecked/isNotChecked do not). */
function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== 'isChecked' && op !== 'isNotChecked';
}

/** A synthetic property entry for sorting by title. */
const TITLE_SORT_OPTION = { id: 'title', name: 'Title', type: 'text' as PropertyType };

// ── Filter row ────────────────────────────────────────────────────────────────

interface FilterRowProps {
  filter: ViewFilter;
  properties: PropertyRecord[];
  onChange: (updated: ViewFilter) => void;
  onRemove: () => void;
}

/**
 * One editable filter row: a property picker, an operator picker, and an optional value input.
 * The operator list is constrained to the legal operators for the chosen property type so the
 * server never rejects an operator–type mismatch.
 */
function FilterRow({ filter, properties, onChange, onRemove }: FilterRowProps) {
  // 'title' is a synthetic property id — it is not in the properties array but is a valid filter
  // target with contains/notContains operators (DEF-088).
  const isTitleFilter = filter.propertyId === 'title';
  const property = isTitleFilter
    ? null
    : (properties.find((p) => p.id === filter.propertyId) ?? properties[0]);
  const legalOps = isTitleFilter
    ? TITLE_FILTER_OPERATORS
    : property
      ? LEGAL_OPERATORS[property.type]
      : [];

  // When the user changes the property, reset the operator and value to valid defaults.
  const handlePropertyChange = (propId: string) => {
    if (propId === 'title') {
      // Title uses text-style operators; reset to 'contains' on property change.
      onChange({ ...filter, propertyId: 'title', operator: 'contains', value: null });
      return;
    }
    const nextProp = properties.find((p) => p.id === propId);
    if (!nextProp) return;
    const firstOp = LEGAL_OPERATORS[nextProp.type][0];
    onChange({ ...filter, propertyId: propId, operator: firstOp ?? 'is', value: null });
  };

  const handleOperatorChange = (op: FilterOperator) => {
    onChange({
      ...filter,
      operator: op,
      // Clear the value when switching to an operator that needs no value.
      value: operatorNeedsValue(op) ? filter.value : null,
    });
  };

  return (
    <div className="flex min-h-10 items-center gap-1.5">
      {/* Property picker — Title is included because it is a valid text-style filter target (DEF-088). */}
      <select
        aria-label="Filter property"
        className="min-h-9 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
        value={filter.propertyId}
        onChange={(e) => handlePropertyChange(e.target.value)}
      >
        <option value="title">Title</option>
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Operator picker */}
      <select
        aria-label="Filter operator"
        className="min-h-9 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
        value={filter.operator}
        onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)}
      >
        {legalOps.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op]}
          </option>
        ))}
      </select>

      {/* Value input: only shown for operators that need a value */}
      {operatorNeedsValue(filter.operator) && property?.type === 'select' ? (
        <select
          aria-label="Filter value"
          className="min-h-9 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
          value={filter.value ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value || null })}
        >
          <option value="">— empty —</option>
          {property.options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>
      ) : operatorNeedsValue(filter.operator) && property?.type === 'multiSelect' ? (
        <select
          aria-label="Filter value"
          className="min-h-9 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
          value={filter.value ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value || null })}
        >
          <option value="">— empty —</option>
          {property.options.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.name}
            </option>
          ))}
        </select>
      ) : operatorNeedsValue(filter.operator) ? (
        <input
          type={
            property?.type === 'date' ? 'date' : property?.type === 'number' ? 'number' : 'text'
          }
          aria-label="Filter value"
          className="min-h-9 w-24 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
          value={filter.value ?? ''}
          onChange={(e) => onChange({ ...filter, value: e.target.value || null })}
        />
      ) : null}

      {/* Remove button */}
      <button
        type="button"
        aria-label="Remove filter"
        className="flex size-9 min-h-9 min-w-9 items-center justify-center rounded-sm text-text-muted hover:bg-danger/10 hover:text-danger"
        onClick={onRemove}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface FilterSortControlProps {
  /** The view whose filters and sort this control manages. */
  view: ViewRecord;
  /** All properties of the database, used to populate the property picker. */
  properties: PropertyRecord[];
  /** All rows, used to count active filters label. */
  rows: PageRecord[];
  /** The view kind (board shows the group-by picker too). */
  viewKind: ViewKind;
  /** Persists a view.update op with the new filter/sort/group configuration. */
  onUpdate: (changes: {
    filters?: ViewFilter[];
    sort?: ViewSort | null;
    groupPropertyId?: string | null;
  }) => void;
}

/**
 * A toolbar button + popover that lets the user add/remove filters, set the sort, and (on the
 * board view) pick the grouping property. Each change writes a `view.update` op immediately so
 * the configuration persists across refreshes (criterion 5).
 */
export function FilterSortControl({
  view,
  properties,
  viewKind,
  onUpdate,
}: FilterSortControlProps) {
  const [open, setOpen] = useState(false);

  // Local working copy — changes only flush to the server via onUpdate (no intermediate state).
  const filters = view.filters;
  const sort = view.sort;
  const groupPropertyId = view.groupPropertyId;

  // Select-type properties for the group-by picker.
  const selectProperties = properties.filter((p) => p.type === 'select');

  // Add a new blank filter defaulting to Title contains, matching what users typically try first.
  const handleAddFilter = () => {
    const newFilter: ViewFilter = {
      id: crypto.randomUUID(),
      propertyId: 'title',
      operator: 'contains',
      value: null,
    };
    onUpdate({ filters: [...filters, newFilter] });
  };

  const handleFilterChange = (index: number, updated: ViewFilter) => {
    const next = filters.map((f, i) => (i === index ? updated : f));
    onUpdate({ filters: next });
  };

  const handleRemoveFilter = (index: number) => {
    onUpdate({ filters: filters.filter((_, i) => i !== index) });
  };

  const handleSortPropertyChange = (propId: string) => {
    if (!propId) {
      onUpdate({ sort: null });
      return;
    }
    onUpdate({ sort: { propertyId: propId, direction: sort?.direction ?? 'asc' } });
  };

  const handleSortDirectionToggle = () => {
    if (!sort) return;
    onUpdate({ sort: { ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' } });
  };

  const handleGroupPropertyChange = (propId: string) => {
    onUpdate({ groupPropertyId: propId || null });
  };

  const activeCount = filters.length + (sort ? 1 : 0);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      contentLabel="Filter and sort"
      trigger={
        <button
          type="button"
          aria-label="Filter and sort"
          className={cn(
            'flex min-h-9 min-w-9 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors',
            activeCount > 0
              ? 'bg-blue/10 text-blue-fg hover:bg-blue/20'
              : 'text-text-muted hover:bg-surface-hover hover:text-text',
          )}
        >
          <Filter size={13} aria-hidden />
          <span className="hidden sm:inline">Filter</span>
          {activeCount > 0 && (
            <span className="flex size-4 items-center justify-center rounded-full bg-blue text-[10px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
      }
    >
      <div
        className="flex w-[min(360px,calc(100vw-2rem))] flex-col gap-3 p-3"
        data-testid="filter-sort-panel"
      >
        {/* Filters section */}
        <section aria-label="Filters">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
              Filters
            </span>
            <button
              type="button"
              className="flex items-center gap-1 rounded-sm px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover hover:text-text"
              onClick={handleAddFilter}
              disabled={properties.length === 0}
            >
              <Plus size={11} aria-hidden />
              Add
            </button>
          </div>

          {filters.length === 0 ? (
            <p className="text-xs text-text-muted">No filters applied.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filters.map((f, i) => (
                <FilterRow
                  key={f.id}
                  filter={f}
                  properties={properties}
                  onChange={(updated) => handleFilterChange(i, updated)}
                  onRemove={() => handleRemoveFilter(i)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Sort section */}
        <section aria-label="Sort" className="border-t border-border pt-3">
          <span className="mb-1.5 block text-xs font-semibold tracking-wide text-text-muted uppercase">
            Sort
          </span>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Sort property"
              className="min-h-9 flex-1 rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
              value={sort?.propertyId ?? ''}
              onChange={(e) => handleSortPropertyChange(e.target.value)}
            >
              <option value="">— none —</option>
              <option value="title">{TITLE_SORT_OPTION.name}</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {sort && (
              <button
                type="button"
                aria-label={`Sort direction: ${sort.direction === 'asc' ? 'ascending' : 'descending'}`}
                className="flex min-h-9 min-w-9 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:bg-surface-hover hover:text-text"
                onClick={handleSortDirectionToggle}
              >
                {sort.direction === 'asc' ? (
                  <SortAsc size={14} aria-hidden />
                ) : (
                  <SortDesc size={14} aria-hidden />
                )}
              </button>
            )}
          </div>
        </section>

        {/* Group-by section: board view only */}
        {viewKind === 'board' && (
          <section aria-label="Group by" className="border-t border-border pt-3">
            <div className="mb-1.5 flex items-center gap-1">
              <span className="text-xs font-semibold tracking-wide text-text-muted uppercase">
                Group by
              </span>
              <ChevronDown size={10} className="text-text-muted" aria-hidden />
            </div>
            {selectProperties.length === 0 ? (
              <p className="text-xs text-text-muted">Add a Select property to enable grouping.</p>
            ) : (
              <select
                aria-label="Group by property"
                className="min-h-9 w-full rounded-sm border border-border bg-surface px-2 py-1 text-xs text-text focus:border-blue focus:outline-none"
                value={groupPropertyId ?? ''}
                onChange={(e) => handleGroupPropertyChange(e.target.value)}
              >
                <option value="">— none —</option>
                {selectProperties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </section>
        )}
      </div>
    </Popover>
  );
}
