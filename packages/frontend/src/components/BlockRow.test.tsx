import { describe, expect, it, vi } from 'vitest';
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
  // In the real browser a pointer drag ends with a synthetic click that has NO preceding
  // pointerdown (the pointerdown fired at drag start, before any movement). This is exactly what
  // the browser sends: pointerdown → [4px movement] → pointerup → synthesised click.
  // userEvent.click() sends a full pointerdown+click sequence, which would reset the guard ref
  // before the click. So these tests use fireEvent.click() for the post-drag synthetic click
  // (matching the browser's bare click) and userEvent.click() for the genuine-click cases (where
  // a real pointerdown correctly precedes the click and resets the guard).

  it('menu stays closed when a bare click fires immediately after a pointer drag ends', async () => {
    // The useEffect records a drag in dragJustEndedRef; onOpenChange swallows the first open
    // request that follows, which is the spurious post-drag synthesised click. (DEF-113)

    // Phase 1: render with drag active so the useEffect fires and sets dragJustEndedRef.
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(true));
    const { rerender } = render(<BlockRow {...defaultProps} />);

    // Phase 2: drag ends — isDragging becomes false, as dnd-kit sets it on pointer-up.
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    act(() => {
      rerender(<BlockRow {...defaultProps} />);
    });

    // Phase 3: browser fires the synthesised bare click (no preceding pointerdown).
    const handle = document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement;
    fireEvent.click(handle);

    // Radix only renders menu content when open; closed menu means no delete item in the DOM.
    const deleteItem = document.querySelector('[data-testid="block-delete"]');
    expect(deleteItem).toBeNull();
  });

  it('menu opens normally on a genuine click with no prior drag', async () => {
    // No drag → dragJustEndedRef is never set → a genuine click opens the menu.
    const user = userEvent.setup();
    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    render(<BlockRow {...defaultProps} />);

    const handle = document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement;
    await user.click(handle);

    const deleteItem = document.querySelector('[data-testid="block-delete"]');
    expect(deleteItem).not.toBeNull();
  });

  it('menu opens on the next genuine click after a drag-then-genuine-click sequence', async () => {
    // After the drag's spurious click is swallowed, a new pointer interaction begins with
    // onPointerDown, which resets dragJustEndedRef so the next genuine click opens the menu.
    // userEvent.click() triggers pointerdown → click, matching a genuine user click.
    const user = userEvent.setup();

    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(true));
    const { rerender } = render(<BlockRow {...defaultProps} />);

    vi.mocked(useSortable).mockReturnValue(makeSortableReturn(false));
    act(() => {
      rerender(<BlockRow {...defaultProps} />);
    });

    const handle = document.querySelector('[data-testid="block-drag-handle"]') as HTMLElement;

    // Spurious post-drag bare click — swallowed.
    fireEvent.click(handle);
    expect(document.querySelector('[data-testid="block-delete"]')).toBeNull();

    // Genuine subsequent click (pointerdown resets the ref → click is not swallowed).
    await user.click(handle);
    expect(document.querySelector('[data-testid="block-delete"]')).not.toBeNull();
  });
});
