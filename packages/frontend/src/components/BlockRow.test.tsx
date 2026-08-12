import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BlockRow } from './BlockRow';
import { makeBlock } from '../test/fixtures';
import { useSortable } from '@dnd-kit/sortable';

// Mock @dnd-kit/sortable so tests can control isDragging without real DnD infrastructure.
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(),
}));

/** Minimal useSortable return matching the fields BlockRow reads from it. */
function makeSortableReturn(isDragging: boolean): ReturnType<typeof useSortable> {
  return {
    attributes: {
      role: 'button' as const,
      tabIndex: 0,
      'aria-disabled': false,
      'aria-pressed': undefined,
      'aria-roledescription': 'sortable',
      'aria-describedby': '',
    },
    listeners: undefined,
    setNodeRef: vi.fn(),
    setActivatorNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging,
    isSorting: false,
    over: null,
    active: null,
    index: 0,
    overIndex: -1,
    items: [],
    newIndex: 0,
    activeIndex: -1,
    isOver: false,
    rect: { current: null },
    node: { current: null },
    data: { current: undefined },
  } as unknown as ReturnType<typeof useSortable>;
}

const block = makeBlock({ id: 'b-drag-test', pageId: 'p-1', text: 'Drag me', sortKey: 'a0' });

const defaultProps = {
  block,
  listNumber: 1,
  onChangeText: vi.fn(),
  onConvertType: vi.fn(),
  onToggleChecked: vi.fn(),
  onEnter: vi.fn(),
  onDeleteEmpty: vi.fn(),
  onDelete: vi.fn(),
  registerEditor: vi.fn(),
  onNotice: vi.fn(),
};

describe('BlockRow data-dragging attribute', () => {
  it('sets data-dragging="false" when the block is not being dragged', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    render(<BlockRow {...defaultProps} />);
    const row = document.querySelector('[data-block-id="b-drag-test"]');
    expect(row).toHaveAttribute('data-dragging', 'false');
  });

  it('sets data-dragging="true" when the block is actively being dragged', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(true));
    render(<BlockRow {...defaultProps} />);
    const row = document.querySelector('[data-block-id="b-drag-test"]');
    expect(row).toHaveAttribute('data-dragging', 'true');
  });
});
