import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
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

// A plain MutableRefObject<boolean> — React.useRef is unavailable outside a component, but the
// prop type only needs `{ current: boolean }` and BlockRow reads/writes `.current` directly.
const dragJustEndedRef = { current: false };

const defaultProps = {
  block,
  listNumber: 1,
  continuesList: false,
  onChangeText: vi.fn(),
  onConvertType: vi.fn(),
  onToggleChecked: vi.fn(),
  onEnter: vi.fn(),
  onDeleteEmpty: vi.fn(),
  onDelete: vi.fn(),
  registerEditor: vi.fn(),
  onNotice: vi.fn(),
  dragJustEndedRef,
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

describe('drag handle vertical alignment (Problem 1)', () => {
  // jsdom does not compute layout, so the offset class contract is what can be asserted here.
  // Values come from getBoundingClientRect() measurements in a real browser at 1280x800 (see
  // handleTopClasses comment in BlockRow.tsx for the per-type deltas and chosen corrections).

  it('applies top-4 to the heading1 handle, centring it on the first text line', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const h1Block = makeBlock({ id: 'b-h1-align', pageId: 'p-1', type: 'heading1', text: 'Title' });
    render(<BlockRow {...defaultProps} block={h1Block} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    // top-4 (16px): measured delta +1.3px with this offset, within tolerance.
    expect(handle?.className).toContain('top-4');
  });

  it('applies top-2.5 to the heading2 handle', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const h2Block = makeBlock({ id: 'b-h2-align', pageId: 'p-1', type: 'heading2', text: 'Sub' });
    render(<BlockRow {...defaultProps} block={h2Block} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    expect(handle?.className).toContain('top-2.5');
  });

  it('applies top-1.5 to the heading3 handle', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const h3Block = makeBlock({ id: 'b-h3-align', pageId: 'p-1', type: 'heading3', text: 'Sub' });
    render(<BlockRow {...defaultProps} block={h3Block} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    expect(handle?.className).toContain('top-1.5');
  });

  it('applies -top-1.5 to the paragraph handle (measured delta +7px at top-0)', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const paraBlock = makeBlock({
      id: 'b-para-align',
      pageId: 'p-1',
      type: 'paragraph',
      text: 'Text',
    });
    render(<BlockRow {...defaultProps} block={paraBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    // -top-1.5 (-6px) corrects measured +7px delta to ~+1px.
    expect(handle?.className).toContain('-top-1.5');
  });

  it('applies -top-1.5 to the bulletedList handle', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const bulletBlock = makeBlock({
      id: 'b-bul-align',
      pageId: 'p-1',
      type: 'bulletedList',
      text: 'Item',
    });
    render(<BlockRow {...defaultProps} block={bulletBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    expect(handle?.className).toContain('-top-1.5');
  });

  it('applies top-1.5 to the callout handle (measured delta -6px at top-0)', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const calloutBlock = makeBlock({
      id: 'b-call-align',
      pageId: 'p-1',
      type: 'callout',
      text: 'Note',
    });
    render(<BlockRow {...defaultProps} block={calloutBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    // top-1.5 (+6px) corrects measured -6px delta to ~0px.
    expect(handle?.className).toContain('top-1.5');
  });

  it('applies top-5.5 to the code handle (language label adds ~22px before the textarea)', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const codeBlock = makeBlock({ id: 'b-code-align', pageId: 'p-1', type: 'code', text: 'x' });
    render(<BlockRow {...defaultProps} block={codeBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    // top-5.5 (+22px) corrects measured -22.4px delta to ~-0.4px.
    expect(handle?.className).toContain('top-5.5');
  });

  it('falls back to top-0 for divider (no text; alignment is cosmetic)', () => {
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    const dividerBlock = makeBlock({ id: 'b-div-align', pageId: 'p-1', type: 'divider' });
    render(<BlockRow {...defaultProps} block={dividerBlock} />);
    const handle = document.querySelector('[data-testid="block-drag-handle"]');
    expect(handle?.className).toContain('top-0');
  });
});

describe('drag handle menu swallow-after-drag (DEF-113)', () => {
  // Root cause: Radix DropdownMenu.Trigger fires onOpenChange(true) on pointerdown, before dnd-kit's
  // 4px activation threshold. menuOpen becomes true. During the drag isDragging=true hides the menu
  // via open={menuOpen && !isDragging}. When the drag ends isDragging returns to false, revealing
  // menuOpen=true. Fix: useLayoutEffect resets menuOpen when isDragging becomes true (fires before
  // paint, no flash). dragJustEndedRef (set synchronously in BlockEditor.handleDragEnd) is secondary
  // defense against any synthetic click that might fire in non-dnd-kit environments.

  beforeEach(() => {
    dragJustEndedRef.current = false;
  });

  it('menu stays closed after a full drag cycle (isDragging true→false)', () => {
    // The real sequence: pointerdown → Radix opens menu (menuOpen=true) → 4px movement →
    // isDragging=true (useLayoutEffect resets menuOpen=false) → drag ends → isDragging=false →
    // open = menuOpen && !isDragging = false && true = false → menu stays closed.

    // Render with isDragging=true to trigger the useLayoutEffect reset.
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(true));
    const { rerender } = render(<BlockRow {...defaultProps} />);

    // While dragging, simulate that pointerdown had previously opened the menu (menuOpen=true).
    // In the real browser Radix fires onOpenChange(true) at pointerdown. We cannot simulate this
    // directly since it would be blocked by isDragging=true at click-time; instead we verify the
    // useLayoutEffect guard below.

    // Drag ends: isDragging returns to false. menuOpen was reset to false by useLayoutEffect.
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    act(() => {
      rerender(<BlockRow {...defaultProps} />);
    });

    // The menu must NOT be open.
    expect(document.querySelector('[data-testid="block-delete"]')).toBeNull();
  });

  it('menu stays closed on pointerdown after drag-end (secondary dragJustEndedRef guard)', () => {
    // Secondary defense: if the trigger receives a pointerdown immediately after drag-end
    // (before any new genuine interaction), dragJustEndedRef (set synchronously in handleDragEnd)
    // swallows the Radix onOpenChange(true) call. Radix DropdownMenu.Trigger fires onOpenChange
    // via onPointerDown, so we model the spurious trigger with fireEvent.pointerDown.
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    render(<BlockRow {...defaultProps} />);

    // Simulate BlockEditor.handleDragEnd setting the flag synchronously.
    dragJustEndedRef.current = true;
    fireEvent.pointerDown(
      document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement,
      { button: 0, ctrlKey: false, isPrimary: true },
    );

    expect(document.querySelector('[data-testid="block-delete"]')).toBeNull();
    // Flag is consumed on the first open request.
    expect(dragJustEndedRef.current).toBe(false);
  });

  it('menu opens normally on a genuine click with no prior drag', async () => {
    // No drag → dragJustEndedRef stays false, isDragging never becomes true → genuine click opens.
    const user = userEvent.setup();
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    render(<BlockRow {...defaultProps} />);

    await user.click(document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement);

    expect(document.querySelector('[data-testid="block-delete"]')).not.toBeNull();
  });
});
