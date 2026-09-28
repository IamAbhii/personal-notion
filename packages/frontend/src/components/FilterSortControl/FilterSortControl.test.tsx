import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterSortControl } from './FilterSortControl';
import type { PropertyRecord, ViewRecord } from '../../api/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeView(overrides: Partial<ViewRecord> = {}): ViewRecord {
  return {
    id: 'v1',
    databasePageId: 'db-1',
    name: 'Table',
    kind: 'table',
    groupPropertyId: null,
    filters: [],
    sort: null,
    sortKey: 'a',
    version: 1,
    updatedAt: 0,
    ...overrides,
  };
}

const textProp: PropertyRecord = {
  id: 'p-text',
  databasePageId: 'db-1',
  name: 'Notes',
  type: 'text',
  options: [],
  sortKey: 'a',
  version: 1,
  updatedAt: 0,
};

const selectProp: PropertyRecord = {
  id: 'p-select',
  databasePageId: 'db-1',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'opt-todo', name: 'Todo', color: 'gray' },
    { id: 'opt-done', name: 'Done', color: 'teal' },
  ],
  sortKey: 'b',
  version: 1,
  updatedAt: 0,
};

const baseProps = { rows: [], properties: [textProp, selectProp] };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FilterSortControl', () => {
  it('renders the filter/sort trigger button', () => {
    render(
      <FilterSortControl {...baseProps} view={makeView()} viewKind="table" onUpdate={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /filter and sort/i })).toBeInTheDocument();
  });

  it('opens the panel when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(
      <FilterSortControl {...baseProps} view={makeView()} viewKind="table" onUpdate={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    expect(screen.getByTestId('filter-sort-panel')).toBeInTheDocument();
  });

  it('adds a filter defaulting to Title contains (DEF-088)', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <FilterSortControl {...baseProps} view={makeView()} viewKind="table" onUpdate={onUpdate} />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    await user.click(screen.getByRole('button', { name: /add/i }));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.arrayContaining([
          expect.objectContaining({ propertyId: 'title', operator: 'contains' }),
        ]),
      }),
    );
  });

  it('shows Title as first option in the filter property picker (DEF-088)', async () => {
    const user = userEvent.setup();
    render(
      <FilterSortControl
        {...baseProps}
        view={makeView({
          filters: [{ id: 'f1', propertyId: 'p-text', operator: 'contains', value: null }],
        })}
        viewKind="table"
        onUpdate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    const propertyPicker = screen.getByRole('combobox', { name: /filter property/i });
    const options = Array.from(propertyPicker.querySelectorAll('option')).map((o) => o.value);
    expect(options[0]).toBe('title');
  });

  it('removes a filter and calls onUpdate with the remaining filters', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    const view = makeView({
      filters: [{ id: 'f1', propertyId: 'p-text', operator: 'contains', value: 'hello' }],
    });
    render(<FilterSortControl {...baseProps} view={view} viewKind="table" onUpdate={onUpdate} />);
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    await user.click(screen.getByRole('button', { name: /remove filter/i }));
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ filters: [] }));
  });

  it('sets the sort property and calls onUpdate', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <FilterSortControl {...baseProps} view={makeView()} viewKind="table" onUpdate={onUpdate} />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    await user.selectOptions(screen.getByRole('combobox', { name: /sort property/i }), 'title');
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ sort: { propertyId: 'title', direction: 'asc' } }),
    );
  });

  it('shows the group-by picker only for board view', async () => {
    const user = userEvent.setup();
    render(
      <FilterSortControl {...baseProps} view={makeView()} viewKind="table" onUpdate={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    expect(screen.queryByRole('combobox', { name: /group by property/i })).not.toBeInTheDocument();
  });

  it('shows the group-by picker for board view', async () => {
    const user = userEvent.setup();
    render(
      <FilterSortControl
        {...baseProps}
        view={makeView({ kind: 'board' })}
        viewKind="board"
        onUpdate={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    expect(screen.getByRole('combobox', { name: /group by property/i })).toBeInTheDocument();
  });

  it('calls onUpdate with the new groupPropertyId when group-by changes', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <FilterSortControl
        {...baseProps}
        view={makeView({ kind: 'board' })}
        viewKind="board"
        onUpdate={onUpdate}
      />,
    );
    await user.click(screen.getByRole('button', { name: /filter and sort/i }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: /group by property/i }),
      'p-select',
    );
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupPropertyId: 'p-select' }));
  });
});
