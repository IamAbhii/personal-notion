import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardCode } from '@dnd-kit/core';
import { BoardView } from './BoardView';
import { boardCollisionDetection, createBoardKeyboardCoordinates } from './boardKeyboard';
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

// ── DEF-077: keyboard coordinate getter ────────────────────────────────────────

/**
 * Builds a minimal SensorContext mock for testing the keyboard coordinate getter.
 * Only `droppableContainers`, `droppableRects`, and `over` are exercised by the getter.
 */
function makeSensorContext(
  droppables: Array<{ id: string; left: number; width?: number }>,
  overColId: string | null,
) {
  const droppableContainers = new Map(droppables.map(({ id }) => [id, { id }]));
  const droppableRects = new Map(
    droppables.map(({ id, left, width = 260 }) => [
      id,
      { left, top: 0, width, height: 400, right: left + width, bottom: 400 },
    ]),
  );
  return {
    activatorEvent: null,
    active: null,
    activeNode: null,
    collisionRect: null,
    collisions: null,
    draggableNodes: new Map(),
    draggingNode: null,
    draggingNodeRect: null,
    droppableRects,
    droppableContainers,
    over: overColId
      ? { id: overColId, rect: { current: null }, disabled: false, data: { current: undefined } }
      : null,
    scrollableAncestors: [],
    scrollAdjustedTranslate: null,
  };
}

/** Two-column fixture: col-a at x=0, col-b at x=280; card-1 lives in col-a. */
const kbdCols: BoardColumn[] = [
  { optionId: 'col-a', label: 'Col A', color: 'gray', rows: [row('card-1', 'Card 1')] },
  { optionId: 'col-b', label: 'Col B', color: 'teal', rows: [] },
];
const kbdDroppables = [
  { id: 'col-a', left: 0 },
  { id: 'col-b', left: 280 },
];

describe('createBoardKeyboardCoordinates (DEF-077)', () => {
  it('when over is null and card is in col-a, ArrowRight navigates to col-b', () => {
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const preventDefault = vi.fn();
    const event = { code: KeyboardCode.Right, preventDefault } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-1',
      currentCoordinates: { x: 130, y: 200 },
      context: makeSensorContext(kbdDroppables, null) as never,
    });

    // col-b centre: left=280 + width/2=130 = 410, top=0 + height/2=200 = 200
    expect(result).toEqual({ x: 410, y: 200 });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('when already over col-a, ArrowRight navigates to col-b', () => {
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const event = { code: KeyboardCode.Right, preventDefault: vi.fn() } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-1',
      currentCoordinates: { x: 130, y: 200 },
      context: makeSensorContext(kbdDroppables, 'col-a') as never,
    });

    expect(result).toEqual({ x: 410, y: 200 });
  });

  it('when already at the last column, ArrowRight returns undefined (no further column)', () => {
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const event = { code: KeyboardCode.Right, preventDefault: vi.fn() } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-1',
      currentCoordinates: { x: 410, y: 200 },
      context: makeSensorContext(kbdDroppables, 'col-b') as never,
    });

    expect(result).toBeUndefined();
  });

  it('ArrowLeft from col-b navigates back to col-a', () => {
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const event = { code: KeyboardCode.Left, preventDefault: vi.fn() } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-1',
      currentCoordinates: { x: 410, y: 200 },
      context: makeSensorContext(kbdDroppables, 'col-b') as never,
    });

    // col-a centre: 0 + 260/2 = 130
    expect(result).toEqual({ x: 130, y: 200 });
  });

  it('falls back to the first column when the dragged card cannot be found in any column', () => {
    // Lines 58-60 in boardKeyboard.ts: the safe fallback when currentIndex is still -1
    // after trying to find the source column. Triggered by an active id that belongs to none
    // of the columns in the getter's closure.
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const event = { code: KeyboardCode.Right, preventDefault: vi.fn() } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-not-in-any-column',
      currentCoordinates: { x: 0, y: 0 },
      context: makeSensorContext(kbdDroppables, null) as never,
    });

    // The fallback returns the first column's centre (col-a: left=0 + 260/2 = 130, top=0 + 400/2 = 200).
    expect(result).toEqual({ x: 130, y: 200 });
  });

  it('non-arrow keys return undefined and do not call preventDefault', () => {
    const getter = createBoardKeyboardCoordinates(kbdCols);
    const preventDefault = vi.fn();
    const event = { code: KeyboardCode.Space, preventDefault } as unknown as KeyboardEvent;

    const result = getter(event, {
      active: 'card-1',
      currentCoordinates: { x: 130, y: 200 },
      context: makeSensorContext(kbdDroppables, null) as never,
    });

    expect(result).toBeUndefined();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

// ── boardCollisionDetection (DEF-077 / DEF-075) ────────────────────────────────

describe('boardCollisionDetection', () => {
  // Minimal args that satisfy both pointerWithin and closestCenter signatures.
  const baseArgs = {
    active: {
      id: 'card-1',
      data: { current: undefined },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect: { left: 280, top: 0, width: 200, height: 60, right: 480, bottom: 60 },
    droppableRects: new Map([
      ['col-a', { left: 0, top: 0, width: 260, height: 400, right: 260, bottom: 400 }],
      ['col-b', { left: 280, top: 0, width: 260, height: 400, right: 540, bottom: 400 }],
    ]),
    droppableContainers: [
      {
        id: 'col-a',
        key: 'col-a',
        disabled: false,
        data: { current: undefined },
        node: { current: null },
        rect: { current: null },
      },
      {
        id: 'col-b',
        key: 'col-b',
        disabled: false,
        data: { current: undefined },
        node: { current: null },
        rect: { current: null },
      },
    ],
  };

  it('uses closestCenter when pointerCoordinates is null (keyboard drag)', () => {
    // The collisionRect is centred in col-b (left=280). closestCenter should return col-b.
    const result = boardCollisionDetection({ ...baseArgs, pointerCoordinates: null });
    expect(result[0]?.id).toBe('col-b');
  });

  it('uses pointerWithin when pointerCoordinates is provided (pointer drag)', () => {
    // Pointer is inside col-a (x=100 is within left=0, right=260).
    const result = boardCollisionDetection({ ...baseArgs, pointerCoordinates: { x: 100, y: 200 } });
    expect(result[0]?.id).toBe('col-a');
  });
});
