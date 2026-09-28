import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SlashMenu } from './SlashMenu';
import type { BlockTypeOption } from '../lib/blocks';

const options: BlockTypeOption[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain text', keywords: ['paragraph'] },
  { type: 'heading1', label: 'Heading 1', hint: 'Big heading', keywords: ['h1'] },
];

const defaultProps = {
  options,
  highlightedIndex: 0,
  query: '',
  onPick: vi.fn(),
  onHighlight: vi.fn(),
};

describe('SlashMenu horizontal collision (DEF-034)', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Simulate a 320px viewport where the menu right edge overflows.
    Object.defineProperty(window, 'innerWidth', { writable: true, value: 320 });
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    Object.defineProperty(window, 'innerWidth', { writable: true, value: originalInnerWidth });
  });

  it('renders with a left style, defaulting to the gutter width', () => {
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 100,
      bottom: 420,
      left: 62,
      right: 358,
      width: 296,
      height: 320,
      x: 62,
      y: 100,
    } as DOMRect);

    const { container } = render(<SlashMenu {...defaultProps} />);
    const menu = container.querySelector('[data-testid="slash-menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    // After the layout effect shifts left, the inline style left should be less than 48 when
    // the right edge overflows (358 > 320-8=312, overflow=46, leftPx=max(0,48-46)=2).
    expect(menu.style.left).toBe('2px');
  });

  it('keeps left at 48px when there is no horizontal overflow', () => {
    // Menu fits within 320px viewport: left=0, right=296 (well within 312).
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      top: 100,
      bottom: 300,
      left: 0,
      right: 296,
      width: 296,
      height: 200,
      x: 0,
      y: 100,
    } as DOMRect);

    const { container } = render(<SlashMenu {...defaultProps} />);
    const menu = container.querySelector('[data-testid="slash-menu"]') as HTMLElement;
    expect(menu.style.left).toBe('48px');
  });
});

describe('SlashMenu empty state', () => {
  it('shows no-match message when options list is empty', () => {
    const { container } = render(<SlashMenu {...defaultProps} options={[]} query="zzz" />);
    expect(container.textContent).toContain('No block type matches that.');
  });
});
