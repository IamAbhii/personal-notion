import { useRef } from 'react';
import { Kanban, LayoutList, Table } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ViewKind } from '../../api/types';

/** One tab descriptor. */
interface ViewTab {
  kind: ViewKind;
  label: string;
  icon: React.ReactNode;
}

const TABS: ViewTab[] = [
  { kind: 'table', label: 'Table', icon: <Table size={14} aria-hidden /> },
  { kind: 'board', label: 'Board', icon: <Kanban size={14} aria-hidden /> },
  { kind: 'list', label: 'List', icon: <LayoutList size={14} aria-hidden /> },
];

export interface ViewSwitcherProps {
  /** The currently active view kind. */
  activeKind: ViewKind;
  /** Called when the user picks a different view kind. */
  onSwitch: (kind: ViewKind) => void;
  /** Additional className applied to the wrapper div. */
  className?: string;
}

/**
 * A compact tab row that switches between the three view kinds (table, board, list).
 * Implements the ARIA roving-tabindex tabs pattern: ArrowLeft/Right move between tabs,
 * Home/End jump to the first/last tab, and only the active tab is reachable with Tab so
 * the control behaves as a single stop in the page's tab order (DEF-080).
 */
export function ViewSwitcher({ activeKind, onSwitch, className }: ViewSwitcherProps) {
  // One ref per tab button so we can focus the target after an arrow-key move.
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TABS.findIndex((t) => t.kind === activeKind);
    let nextIndex: number | null = null;

    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = TABS.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const next = TABS[nextIndex];
      if (next) {
        onSwitch(next.kind);
        // Move DOM focus to the newly activated tab.
        tabRefs.current[nextIndex]?.focus();
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label="View type"
      // bg-surface-sunken track: the active tab (bg-surface) lifts visibly above it in both
      // themes — in dark #191820 on #14131a, in light #ffffff on #faf9f7.
      className={cn('flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5', className)}
      onKeyDown={handleKeyDown}
    >
      {TABS.map((tab, index) => {
        const isActive = tab.kind === activeKind;
        return (
          <button
            key={tab.kind}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-label={`${tab.label} view`}
            // Roving tabindex: only the active tab is reachable with Tab so the tablist is a
            // single focus stop. Arrow keys navigate within the list (ARIA tabs pattern, DEF-080).
            tabIndex={isActive ? 0 : -1}
            onClick={() => onSwitch(tab.kind)}
            className={cn(
              'flex min-h-9 min-w-16 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors',
              isActive
                ? 'bg-surface text-text shadow-sm'
                : 'text-text-muted hover:bg-surface/60 hover:text-text',
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
