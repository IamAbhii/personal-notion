import { useEffect, useRef, useState } from 'react';
import { Dialog as RadixDialog } from 'radix-ui';
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
 * - Focus is trapped inside the dialog by Radix Dialog, the same mechanism used by ConfirmDialog.
 * - The input has role="combobox" and owns the listbox via aria-controls.
 * - aria-activedescendant on the input announces the highlighted option without moving DOM focus,
 *   matching the combobox ARIA pattern. Result buttons are not tab stops (tabIndex=-1) so focus
 *   never leaves the input via Tab.
 * - A polite live region outside the listbox announces the result count as the user types.
 * - Status messages ("Type to search...", "No results") live outside the listbox so the listbox
 *   only ever contains option elements.
 * - Escape is handled by Radix and also by the input handler (defensive, harmless to call twice).
 *
 * Future: when the workspace snapshot grows past a few thousand pages, wire this component to a
 * debounced search worker rather than calling searchWorkspace on every keystroke. The component
 * interface stays the same; only the result source changes.
 */
export function QuickFind({ pages, onClose, onSelect }: QuickFindProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Derived during render so it always reflects the latest query without a sync effect.
  const results = searchWorkspace(pages, query);
  // Clamp so keyboard navigation never produces an out-of-bounds index.
  const safeIndex = results.length > 0 ? Math.min(activeIndex, results.length - 1) : 0;

  // Keep the highlighted item scrolled into view as the user navigates with arrow keys.
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'Escape':
        // Radix Dialog also handles Escape; calling onClose here is defensive and harmless.
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
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(results.length > 0 ? results.length - 1 : 0);
        break;
      case 'PageDown':
        event.preventDefault();
        setActiveIndex((i) => Math.min(i + 5, results.length - 1));
        break;
      case 'PageUp':
        event.preventDefault();
        setActiveIndex((i) => Math.max(i - 5, 0));
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

  // Result count text for the live region. Only announced when there are actual results.
  const countAnnouncement =
    query.trim() && results.length > 0
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : '';

  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <RadixDialog.Portal>
        {/* Full-screen backdrop: Radix closes the dialog on click and on Escape. */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[15vh]">
          <RadixDialog.Content
            aria-label="Quick find"
            data-testid="quickfind-dialog"
            className="flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
            onOpenAutoFocus={(e) => {
              // Prevent Radix from moving focus to the first focusable element; we focus the
              // input ourselves so the caret lands in the right place.
              e.preventDefault();
              inputRef.current?.focus();
            }}
          >
            {/* Visually hidden title satisfies Radix's requirement and labels the dialog for AT. */}
            <RadixDialog.Title className="sr-only">Quick find</RadixDialog.Title>

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

            {/* Polite live region for result count. Lives outside the listbox so status messages
                do not break the owned-element relationship between listbox and its options. */}
            <div role="status" aria-live="polite" className="sr-only">
              {countAnnouncement}
            </div>

            {/* Status messages: outside the listbox so the listbox contains only option elements. */}
            {!query.trim() ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                Type to search pages, databases and rows.
              </p>
            ) : results.length === 0 ? (
              <p className="px-4 py-3 text-sm text-text-muted">
                No results for &ldquo;{query}&rdquo;.
              </p>
            ) : null}

            {/* Results listbox: only rendered when there are options so it never contains
                non-option children. Direct children are option buttons; no li wrappers that would
                break the owned-element relationship. */}
            {results.length > 0 ? (
              <div
                id="quickfind-listbox"
                ref={listRef}
                role="listbox"
                aria-label="Search results"
                className="max-h-[min(60dvh,400px)] overflow-y-auto py-1.5"
              >
                {results.map((result, index) => {
                  const isActive = index === safeIndex;
                  return (
                    // tabIndex={-1}: options are not tab stops. Focus stays on the input and moves
                    // only via aria-activedescendant, matching the combobox ARIA pattern.
                    <button
                      key={result.pageId}
                      type="button"
                      id={`quickfind-option-${index}`}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      data-testid="quickfind-result"
                      className={cn(
                        'flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-2 text-left',
                        isActive ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                      )}
                      // mousedown fires before blur so the input does not lose focus before we
                      // handle the pick. onClick handles the case where a user finds this element
                      // programmatically.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelectResult(result);
                      }}
                      onClick={() => handleSelectResult(result)}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      {/* Page icon: same emoji the sidebar and breadcrumb show. */}
                      <span
                        className="flex-none font-emoji text-base leading-none"
                        aria-hidden="true"
                      >
                        {result.icon}
                      </span>
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
                  );
                })}
              </div>
            ) : null}
          </RadixDialog.Content>
        </RadixDialog.Overlay>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
