import { render, screen } from '@testing-library/react';
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
});
