import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('BlockRow gutter touch targets (DEF-031)', () => {
  it('drag handle has the accessible label naming the block type', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const codeBlock = makeBlock({ id: 'b-code', pageId: 'p-1', type: 'code' });
    render(<BlockRow {...defaultProps} block={codeBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    expect(handle).toHaveAttribute('aria-label', 'Move the code block');
  });

  it('delete menu item is reachable via the drag handle and has the accessible label naming the block type', async () => {
    // The delete action moved from a standalone button to a DropdownMenu item on the drag handle.
    // Opening the menu first is required because Radix only renders menu content when open.
    const user = userEvent.setup();
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const headingBlock = makeBlock({ id: 'b-h1', pageId: 'p-1', type: 'heading1' });
    render(<BlockRow {...defaultProps} block={headingBlock} />);

    const handle = document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement;
    await user.click(handle);

    const deleteItem = document.querySelector('[data-testid="block-delete"]');
    expect(deleteItem).toHaveAttribute('aria-label', 'Delete the heading 1 block');
  });
});

describe('BlockRow code block overflow (DEF-027)', () => {
  it('code block textarea has the codeTextarea CSS Module class for horizontal scroll', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const codeBlock = makeBlock({ id: 'b-code-scroll', pageId: 'p-1', type: 'code' });
    render(<BlockRow {...defaultProps} block={codeBlock} />);
    const textarea = document.querySelector('textarea');
    // styles.codeTextarea is a hashed module class; its presence means the overflow-x: auto rule
    // applies. The class name contains 'codeTextarea' in the vitest + CSS Modules setup.
    expect(textarea?.className).toMatch(/codeTextarea/);
  });
});
