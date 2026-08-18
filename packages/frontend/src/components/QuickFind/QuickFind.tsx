import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { searchWorkspace, type SearchResult } from '../../lib/search';
import type { PageRecord } from '../../api/types';

export interface QuickFindProps {
  /** All pages in the workspace. Searched client-side so no network round trip is needed. */
  pages: PageRecord[];
  /** Called when the dialog should close (Escape, backdrop click, or item chosen). */
  onClose: () => void;
  /** Called with the pageId of the chosen result so the shell can navigate to it. */
  onSelect: (pageId: string) => void;
}

/** Human-readable label for each page kind. */
const KIND_LABEL: Record<string, string> = {
  page: 'Page',
  database: 'Database',
  row: 'Row',
};

/**
 * Quick-find dialog. A modal combobox/listbox over the workspace snapshot: the user types a
 * query, results narrow in real time, keyboard navigation selects an item.
 *
 * Accessibility:
 * - The backdrop receives focus-trap clicks but is not in the tab order.
 * - The input has role="combobox" and owns the listbox via aria-controls.
 * - aria-activedescendant on the input announces the highlighted option to screen readers without
 *   moving DOM focus, matching the pattern used by SlashMenu.
 * - Focus is moved to the input on mount; the caller is responsible for restoring focus on close.
 *
 * Future: when the workspace snapshot grows past a few thousand pages, wire this component to a
 * debounced search worker rather than calling searchWorkspace on every keystroke. The component
 * interface stays the same; only the result source changes.
 */
export function QuickFind({ pages, onClose, onSelect }: QuickFindProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Derived during render so it always reflects the latest query without a sync effect.
  const results = searchWorkspace(pages, query);
  // Clamp so arrow-key wrapping never produces an out-of-bounds index.
  const safeIndex = results.length > 0 ? Math.min(activeIndex, results.length - 1) : 0;

  // Focus the input as soon as the dialog mounts; the caller retains focus on close.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the highlighted item scrolled into view as the user navigates with arrow keys.
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter': {
        event.preventDefault();
        const result = results[safeIndex];
        if (result) {
          onSelect(result.pageId);
          onClose();
        }
        break;
      }
    }
  };

  const handleSelectResult = (result: SearchResult) => {
    onSelect(result.pageId);
    onClose();
  };

  // The id referenced by aria-activedescendant must match an option element id.
  const activeDescendant = results.length > 0 ? `quickfind-option-${safeIndex}` : undefined;

  return (
    // Full-screen backdrop: clicking it outside the dialog closes it.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[15vh]"
      // aria-modal is on the dialog element itself, not the backdrop.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Quick find"
        aria-modal="true"
        data-testid="quickfind-dialog"
        className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
      >
        {/* Search input row */}
        <div className="flex min-h-14 items-center gap-3 border-b border-border px-4">
          <Search size={18} aria-hidden className="flex-none text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-controls="quickfind-listbox"
            aria-expanded={results.length > 0}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            aria-label="Search pages, databases and rows"
            placeholder="Search pages, databases and rows..."
            data-testid="quickfind-input"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-text outline-none placeholder:text-text-muted"
            value={query}
            onChange={(e) => {
              // Reset the active index in the same handler so there is no effect-driven cascade.
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          {/* Keyboard hint: shown on wider viewports only to avoid cramping the 320px layout. */}
          <kbd className="hidden flex-none items-center rounded border border-border px-1.5 py-0.5 text-xs text-text-muted sm:flex">
            Esc
          </kbd>
        </div>

        {/* Results list */}
        <ul
          id="quickfind-listbox"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          className="max-h-[min(60dvh,400px)] overflow-y-auto py-1.5"
        >
          {!query.trim() ? (
            <li
              className="px-4 py-3 text-sm text-text-muted"
              // Not an interactive option — no role="option".
            >
              Type to search pages, databases and rows.
            </li>
          ) : results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-text-muted">
              No results for &ldquo;{query}&rdquo;.
            </li>
          ) : (
            results.map((result, index) => {
              const isActive = index === safeIndex;
              return (
                <li key={result.pageId}>
                  <button
                    type="button"
                    id={`quickfind-option-${index}`}
                    role="option"
                    aria-selected={isActive}
                    data-testid="quickfind-result"
                    className={cn(
                      'flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-2 text-left',
                      isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                    )}
                    // mousedown fires before blur so the input does not close before we handle the pick.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectResult(result);
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {result.title}
                      </span>
                      <span className="block text-xs text-text-muted">
                        {KIND_LABEL[result.kind] ?? result.kind}
                        {result.parentTitle ? ` – in ${result.parentTitle}` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
