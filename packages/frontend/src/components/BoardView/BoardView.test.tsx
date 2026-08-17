import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BoardView } from './BoardView';
import type { BoardColumn } from '../../lib/viewData';
import type { PageRecord, PropertyRecord } from '../../api/types';

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

const groupProp: PropertyRecord = {
  id: 'status',
  databasePageId: 'db-1',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'opt-todo', name: 'Todo', color: 'gray' },
    { id: 'opt-done', name: 'Done', color: 'teal' },
  ],
  sortKey: 'a',
  version: 1,
  updatedAt: 0,
};

const columns: BoardColumn[] = [
  { optionId: 'opt-todo', label: 'Todo', color: 'gray', rows: [row('r1', 'Task 1')] },
  { optionId: 'opt-done', label: 'Done', color: 'teal', rows: [row('r2', 'Task 2')] },
  { optionId: null, label: 'No value', color: undefined, rows: [row('r3', 'Task 3')] },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BoardView', () => {
  it('renders all columns', () => {
    render(
      <BoardView
        columns={columns}
        allRows={[row('r1', 'Task 1'), row('r2', 'Task 2'), row('r3', 'Task 3')]}
        groupProperty={groupProp}
        onSelectRow={vi.fn()}
        onCreateRow={vi.fn().mockResolvedValue(null)}
        onSetValue={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('board-column')).toHaveLength(3);
  });

  it('renders each card in its column', () => {
    render(
      <BoardView
        columns={columns}
        allRows={[row('r1', 'Task 1'), row('r2', 'Task 2'), row('r3', 'Task 3')]}
        groupProperty={groupProp}
        onSelectRow={vi.fn()}
        onCreateRow={vi.fn().mockResolvedValue(null)}
        onSetValue={vi.fn()}
      />,
    );
    expect(screen.getByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('Task 2')).toBeInTheDocument();
    expect(screen.getByText('Task 3')).toBeInTheDocument();
  });

  it('shows the empty-state prompt when groupProperty is null', () => {
    render(
      <BoardView
        columns={[]}
        allRows={[]}
        groupProperty={null}
        onSelectRow={vi.fn()}
        onCreateRow={vi.fn().mockResolvedValue(null)}
        onSetValue={vi.fn()}
      />,
    );
    expect(screen.getByText(/pick a select property/i)).toBeInTheDocument();
  });

  it('calls onSelectRow when a card title is clicked', async () => {
    const onSelectRow = vi.fn();
    render(
      <BoardView
        columns={columns}
        allRows={[row('r1', 'Task 1'), row('r2', 'Task 2'), row('r3', 'Task 3')]}
        groupProperty={groupProp}
        onSelectRow={onSelectRow}
        onCreateRow={vi.fn().mockResolvedValue(null)}
        onSetValue={vi.fn()}
      />,
    );
    // Clicking the title button opens the row page.
    screen.getByText('Task 1').click();
    expect(onSelectRow).toHaveBeenCalledWith('r1');
  });

  // DEF-076: "Add card to Done" sets the group property value so the card lands in Done, not "No value".
  it('sets the group property value when adding a card from a column (DEF-076)', async () => {
    const user = userEvent.setup();
    const onCreateRow = vi.fn().mockResolvedValue('new-row-id');
    const onSetValue = vi.fn();

    render(
      <BoardView
        columns={columns}
        allRows={[row('r1', 'Task 1'), row('r2', 'Task 2'), row('r3', 'Task 3')]}
        groupProperty={groupProp}
        onSelectRow={vi.fn()}
        onCreateRow={onCreateRow}
        onSetValue={onSetValue}
      />,
    );

    // Click the "Add card to Todo" button in the first column.
    await user.click(screen.getByLabelText('Add card to Todo'));

    // The row was created.
    expect(onCreateRow).toHaveBeenCalledOnce();

    // onSetValue should be called with the Todo option id so the card lands in the Todo column.
    await vi.waitFor(() => {
      expect(onSetValue).toHaveBeenCalledWith({
        rowPageId: 'new-row-id',
        propertyId: 'status',
        value: JSON.stringify('opt-todo'),
      });
    });
  });

  // DEF-072: when all rows are filtered out, the board shows a "no rows" message.
  it('shows empty state when all rows are filtered out (DEF-072)', () => {
    const emptyColumns: BoardColumn[] = [
      { optionId: 'opt-todo', label: 'Todo', color: 'gray', rows: [] },
      { optionId: 'opt-done', label: 'Done', color: 'teal', rows: [] },
    ];
    render(
      <BoardView
        columns={emptyColumns}
        allRows={[row('r1', 'Task 1')]}
        groupProperty={groupProp}
        onSelectRow={vi.fn()}
        onCreateRow={vi.fn().mockResolvedValue(null)}
        onSetValue={vi.fn()}
      />,
    );
    expect(screen.getByText(/no rows match the current filters/i)).toBeInTheDocument();
  });
});
