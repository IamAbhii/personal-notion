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
 * Each tab is at least 44px tall so it meets the touch-target requirement on narrow screens.
 */
export function ViewSwitcher({ activeKind, onSwitch, className }: ViewSwitcherProps) {
  return (
    <div
      role="tablist"
      aria-label="View type"
      className={cn('flex items-center gap-0.5', className)}
    >
      {TABS.map((tab) => {
        const isActive = tab.kind === activeKind;
        return (
          <button
            key={tab.kind}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-label={`${tab.label} view`}
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
