import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
 * The block-type picker opened by typing "/" in an empty block. It is a listbox rather than a set of
 * buttons because focus stays in the textarea - the user keeps typing to filter - so the highlight
 * is communicated with aria-activedescendant instead of by moving focus.
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
      className={`slash${placeAbove ? ' slash--above' : ''}`}
      id="slash-menu"
      data-testid="slash-menu"
      ref={rootRef}
    >
      <p className="slash__eyebrow">{query ? `Blocks matching "${query}"` : 'Basic blocks'}</p>
      {options.length === 0 ? (
        <p className="slash__empty">No block type matches that.</p>
      ) : (
        <ul className="slash__list" role="listbox" aria-label="Block types">
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
                className={`slash__item${index === highlightedIndex ? ' slash__item--active' : ''}`}
                data-testid="slash-menu-item"
                data-block-type={option.type}
                // The pointer down is what picks: a click after blur would have closed the menu.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onPick(option);
                }}
                onMouseEnter={() => onHighlight(index)}
              >
                <span className="slash__label">{option.label}</span>
                <span className="slash__hint">{option.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
