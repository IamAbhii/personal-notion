import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import type { BlockTypeOption } from '../lib/blocks';

export interface SlashMenuProps {
  options: BlockTypeOption[];
  /** Index of the highlighted entry. The keyboard owner is the block's textarea, not this list. */
  highlightedIndex: number;
  query: string;
  onPick: (option: BlockTypeOption) => void;
  onHighlight: (index: number) => void;
}

/**
 * The block-type picker opened by typing "/" in an empty block. It is a listbox rather than a set
 * of buttons because focus stays in the textarea — the user keeps typing to filter — so the
 * highlight is communicated with aria-activedescendant instead of by moving focus.
 *
 * Positioning: anchored below the block's text column by default, flipped above when there is no
 * room below the fold.
 */
export function SlashMenu({
  options,
  highlightedIndex,
  query,
  onPick,
  onHighlight,
}: SlashMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [placeAbove, setPlaceAbove] = useState(false);

  // A block near the bottom of the page would open its menu below the fold, and the menu is
  // positioned absolutely so it adds no scrollable height to scroll down to. So it flips above the
  // block instead when there is no room under it, and only scrolls when scrolling can help.
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.height && rect.bottom > window.innerHeight - 8 && rect.top - rect.height > 60) {
      setPlaceAbove(true);
      return;
    }
    element.scrollIntoView({ block: 'end' });
  }, []);

  // Arrowing past the visible entries must bring the highlight into view, not walk out of sight.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  return (
    <div
      className={cn(
        // Anchored left to the start of the text column (46px = the gutter grid column width).
        'absolute top-full left-[46px] z-20 max-h-[316px] w-[296px] overflow-y-auto',
        'rounded-md border border-border bg-surface p-2 shadow-pop',
        // Flipped above the block when there is no room below it; margin-bottom gives a small gap.
        placeAbove && 'top-auto bottom-full mb-1.5',
      )}
      id="slash-menu"
      data-testid="slash-menu"
      ref={rootRef}
    >
      <p className="mx-2 mt-0.5 mb-1.5 text-xs font-bold tracking-[0.1em] text-text-muted uppercase">
        {query ? `Blocks matching "${query}"` : 'Basic blocks'}
      </p>
      {options.length === 0 ? (
        <p className="mx-2 mt-1.5 mb-2 text-sm text-text-muted">No block type matches that.</p>
      ) : (
        <ul className="m-0 list-none p-0" role="listbox" aria-label="Block types">
          {options.map((option, index) => (
            <li key={option.type}>
              {/* A button so a mouse click works and the accessible name is the label; the listbox
                  option role keeps the keyboard story coherent with aria-activedescendant. */}
              <button
                type="button"
                ref={index === highlightedIndex ? activeRef : undefined}
                id={`slash-option-${option.type}`}
                role="option"
                aria-selected={index === highlightedIndex}
                className={cn(
                  'flex w-full cursor-pointer flex-col gap-px rounded-sm border-0 bg-transparent px-2.5 py-1.5 text-left',
                  index === highlightedIndex && 'bg-blue/14 ring-1 ring-blue/35 ring-inset',
                )}
                data-testid="slash-menu-item"
                data-block-type={option.type}
                // The pointer down is what picks: a click after blur would have closed the menu.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                <span className="text-sm font-[650]">{option.label}</span>
                <span className="text-xs text-text-muted">{option.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
