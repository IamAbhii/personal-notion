import { useState, type ReactNode } from 'react';
import { buildPageTree, descendantIds, type PageNode } from '../../lib/pageTree';
import { rowIndent } from '../../lib/treeLayout';
import { ConfirmDialog } from '../ConfirmDialog';
import { InlineTitleInput } from '../InlineTitleInput/InlineTitleInput';
import { Button } from '../ui/Button/Button';
import { IconButton } from '../ui/IconButton/IconButton';
import { DropdownMenu, DropdownMenuItem } from '../ui/DropdownMenu/DropdownMenu';
import { ChevronRight, Ellipsis, Pencil, Plus, Table2, Trash2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useUiStoreShallow } from '../../stores/uiStore';
import type { PageRecord } from '../../api/types';

export interface SidebarProps {
  workspaceName: string;
  role: string;
  userName: string;
  userEmail: string;
  pages: PageRecord[];
  currentPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (parentId: string | null) => void;
  /** Creates a database page at the given parent (null for top level) and opens it. */
  onCreateDatabase: (parentId: string | null) => void;
  onRenamePage: (page: PageRecord, title: string) => void;
  onDeletePage: (page: PageRecord) => void;
  /**
   * Optional ref forwarded from the shell so the drawer can receive programmatic focus when it
   * opens on mobile. Not used in tests; safe to omit.
   */
  sidebarRef?: React.Ref<HTMLElement>;
  /**
   * Called when a page is selected. The shell passes a wrapper that also closes the mobile drawer;
   * at desktop no-op because the drawer is never open.
   */
  onClose?: () => void;
}

/**
 * The navigation panel: the whole page tree to any depth, with create, rename and delete per row.
 * Presentational on purpose - the route wires it to the router and the op-based mutations - so the
 * tree behaviour can be unit tested without a router or a server.
 *
 * Collapsed/expanded state lives in the UI store so it survives navigation between pages without
 * a prop drill or a server round trip.
 */
export function Sidebar({
  workspaceName,
  role,
  userName,
  userEmail,
  pages,
  currentPageId,
  onSelectPage,
  onCreatePage,
  onCreateDatabase,
  onRenamePage,
  onDeletePage,
  sidebarRef,
  onClose,
}: SidebarProps) {
  // collapsedPageIds lives in the global UI store; renamingId and pendingDelete are local because
  // only this component owns the edit-in-progress and the pending confirmation states.
  const { collapsedPageIds, togglePageCollapsed } = useUiStoreShallow((s) => ({
    collapsedPageIds: s.collapsedPageIds,
    togglePageCollapsed: s.togglePageCollapsed,
  }));

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PageRecord | null>(null);

  // Row pages are reached from the table, not the sidebar tree.
  const nonRowPages = pages.filter((p) => p.kind !== 'row');
  const tree = buildPageTree(nonRowPages);

  const handleSelectPage = (pageId: string) => {
    onSelectPage(pageId);
    // Choosing a page closes the mobile drawer; no-op on desktop where onClose is not passed.
    onClose?.();
  };

  const renderRows = (nodes: PageNode[]): ReactNode =>
    // Future: drag-reorder of the page tree goes here - pages already carry a fractional sortKey,
    // so a drop emits one page.update op with a key computed between the two neighbours.
    nodes.map((node) => {
      const { page, depth, children } = node;
      const isCollapsed = collapsedPageIds.has(page.id);
      const isCurrent = page.id === currentPageId;

      return (
        <li
          key={page.id}
          role="treeitem"
          aria-expanded={children.length ? !isCollapsed : undefined}
        >
          {/* data-page-id is the end-to-end selector: names one entity unambiguously where
              visible text can repeat across rows. data-current drives CSS variants so tests do not
              depend on module-hashed class names.
              Future: blocks and database rows carry the same shape - data-block-id, data-row-id. */}
          <div
            className={cn(
              // group enables group-hover: on children (actions overlay at md+).
              'group relative flex min-h-12 items-center gap-1 rounded-sm pr-1.5 text-panel-text hover:bg-panel-hover',
              // Current page: amber tint + inset ring via data attribute so tests can read it.
              'data-[current=true]:bg-amber/15 data-[current=true]:text-amber-soft data-[current=true]:ring-1 data-[current=true]:ring-amber/30 data-[current=true]:ring-inset',
            )}
            data-testid="page-row"
            data-current={isCurrent ? 'true' : 'false'}
            data-page-id={page.id}
            // Indentation is capped past a few levels so a row nested 20 deep still shows its
            // icon and title rather than being indented out of the panel.
            style={{ paddingLeft: `${rowIndent(depth)}px` }}
          >
            {children.length > 0 ? (
              <button
                type="button"
                className="grid min-h-12 min-w-12 flex-none cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-panel-text-muted hover:bg-white/10 hover:text-panel-text"
                data-testid="page-expand"
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${page.title}`}
                onClick={() => togglePageCollapsed(page.id)}
              >
                <ChevronRight
                  size={12}
                  aria-hidden
                  className={cn(
                    // Smooth rotation for collapse/expand; motion-reduce skips it for vestibular safety.
                    'transition-transform duration-[120ms] ease-in-out motion-reduce:transition-none',
                    !isCollapsed && 'rotate-90',
                  )}
                />
              </button>
            ) : (
              // Non-interactive spacer: same layout slot, accessible name omitted.
              <span
                className="inline-block min-h-12 min-w-12 flex-none"
                data-testid="page-expand"
                aria-hidden="true"
              />
            )}

            {/* Database pages show a table-grid icon overlay on the emoji to signal type. */}
            <span
              className="relative w-5 flex-none text-center"
              aria-hidden="true"
              data-testid="page-icon"
            >
              <span className="font-emoji text-sm leading-none">{page.icon}</span>
              {page.kind === 'database' ? (
                <span
                  className="absolute -right-1.5 -bottom-1 inline-flex items-center justify-center rounded-full bg-panel p-px"
                  data-testid="database-marker"
                >
                  <Table2 size={8} className="text-blue-soft" aria-hidden />
                </span>
              ) : null}
            </span>

            {renamingId === page.id ? (
              <InlineTitleInput
                value={page.title}
                ariaLabel={`New name for ${page.title}`}
                className="min-w-0 flex-1 rounded-sm border border-blue/60 bg-white/6 px-1.5 py-0.5 text-sm text-panel-text"
                onCommit={(title) => {
                  setRenamingId(null);
                  onRenamePage(page, title);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <button
                type="button"
                className={cn(
                  // min-w-0 keeps this flex item from overflowing; the title span holds the
                  // truncation so text-overflow works on a block box, not a flex container.
                  'flex min-h-12 min-w-0 flex-1 cursor-pointer items-center border-0 bg-transparent p-0 text-left text-sm font-medium',
                  isCurrent && 'font-[650]',
                )}
                // Database pages carry an aria-label that announces their kind because the visual
                // database-marker badge is inside an aria-hidden container (ADV-050).
                aria-label={page.kind === 'database' ? `Database: ${page.title}` : page.title}
                data-testid="page-row-title"
                onClick={() => handleSelectPage(page.id)}
              >
                <span className="min-w-0 truncate">{page.title}</span>
              </button>
            )}

            {/* Row actions — two layouts, one per breakpoint.
                Below md: a single overflow trigger collapses all three actions into a dropdown,
                freeing ~96px so the title stays readable at 320px. The testids are duplicated on
                the menu items so a future mobile-viewport e2e spec can find them here too.
                At md+: the three separate buttons are display:none by default so the span consumes
                zero flex-layout space and the title button fills the full available width — same
                width as in the original absolute-positioned approach. The span becomes display:flex
                only while the pointer is on the row or a child has :focus-visible, confining any
                title truncation to the moment the user is already interacting with the row (DEF-035,
                readability regression fix).
                group-has-[:focus-visible] not group-focus-within: a mouse click gives :focus but
                not :focus-visible, so the strip hides correctly when the pointer leaves (DEF-036). */}

            {/* Mobile overflow menu: one 48px trigger instead of three — hidden at md+ */}
            <span className="flex-none md:hidden">
              <DropdownMenu
                trigger={
                  <IconButton
                    icon={<Ellipsis size={14} aria-hidden />}
                    aria-label={`Actions for ${page.title}`}
                    className="rounded-sm text-panel-text-muted hover:bg-white/12 hover:text-panel-text"
                  />
                }
                align="end"
              >
                {/* setTimeout defers the state update until after the menu has finished closing and
                    Radix has returned focus to the trigger. Without it, the InlineTitleInput's
                    autoFocus fires while Radix's close sequence is still active, the input is
                    immediately blurred, and onCancel resets the renaming state before it takes
                    effect. Deferring by one tick avoids this race: the menu is fully dismissed,
                    then the input mounts and autofocuses without Radix interference. */}
                <DropdownMenuItem
                  data-testid="page-rename"
                  onSelect={() => setTimeout(() => setRenamingId(page.id), 0)}
                >
                  <Pencil size={14} aria-hidden />
                  Rename
                </DropdownMenuItem>
                {page.kind !== 'database' ? (
                  <DropdownMenuItem
                    data-testid="page-add-child"
                    onSelect={() => onCreatePage(page.id)}
                  >
                    <Plus size={14} aria-hidden />
                    Add a page inside
                  </DropdownMenuItem>
                ) : null}
                {page.kind !== 'database' ? (
                  <DropdownMenuItem
                    data-testid="page-add-database-child"
                    onSelect={() => onCreateDatabase(page.id)}
                  >
                    <Table2 size={14} aria-hidden />
                    Add a database inside
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  data-testid="page-delete"
                  variant="danger"
                  onSelect={() => setPendingDelete(page)}
                >
                  <Trash2 size={14} aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenu>
            </span>

            {/* Desktop three-button strip: display:none by default so it takes zero flex-layout
                space. display:flex only while hovered or keyboard-focused so title truncation is
                confined to the hover moment. Pointer-events are automatic: display:none disables
                them; display:flex re-enables them. */}
            <span
              data-testid="page-row-desktop-actions"
              className={cn(
                // hidden = display:none at all widths by default (mobile uses overflow menu).
                // At md+, switch to display:flex only during hover or keyboard focus.
                // display:none removes the span from the flex layout entirely — no width
                // reserved, no gap consumed — so unhovered titles are identical in width to
                // the original before this fix (DEF-035 readability regression fix).
                'hidden',
                'md:group-hover:flex',
                // group-has-[:focus-visible] and NOT group-focus-within: mouse clicks produce
                // :focus but not :focus-visible, so the strip stays hidden after a click and
                // pointer-leave (DEF-036).
                'md:group-has-[:focus-visible]:flex',
                'flex-none items-center gap-px rounded-[7px] p-0.5',
              )}
            >
              {/* size-5 = 20px: desktop pointer-precision; 48px touch target lives on the mobile
                  overflow trigger. At the deepest seed row (depth 3, row 263px) the overlay is
                  66px wide, leaving the hovered title 67px — above the 64px floor (DEF-035). */}
              <button
                type="button"
                className="grid size-5 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-panel-text-muted hover:bg-white/12 hover:text-blue-soft"
                data-testid="page-rename"
                aria-label={`Rename ${page.title}`}
                title="Rename"
                onClick={() => setRenamingId(page.id)}
              >
                <Pencil size={14} aria-hidden />
              </button>
              {page.kind !== 'database' ? (
                <button
                  type="button"
                  className="grid size-5 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-panel-text-muted hover:bg-white/12 hover:text-blue-soft"
                  data-testid="page-add-child"
                  aria-label={`Add a page inside ${page.title}`}
                  title="Add a page inside"
                  onClick={() => onCreatePage(page.id)}
                >
                  <Plus size={14} aria-hidden />
                </button>
              ) : null}
              {page.kind !== 'database' ? (
                // No data-testid here: the testid lives on the overflow menu item so getByTestId
                // finds exactly one element even when multiple rows are rendered.
                <button
                  type="button"
                  className="grid size-5 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-panel-text-muted hover:bg-white/12 hover:text-blue-soft"
                  aria-label={`Add a database inside ${page.title}`}
                  title="Add a database inside"
                  onClick={() => onCreateDatabase(page.id)}
                >
                  <Table2 size={14} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                className="grid size-5 cursor-pointer place-items-center rounded-sm border-0 bg-transparent p-0 text-panel-text-muted hover:bg-danger/22 hover:text-danger-soft"
                data-testid="page-delete"
                aria-label={`Delete ${page.title}`}
                title="Delete"
                onClick={() => setPendingDelete(page)}
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </span>
          </div>

          {children.length > 0 && !isCollapsed ? (
            <ul role="group" className="m-0 list-none p-0">
              {renderRows(children)}
            </ul>
          ) : null}
        </li>
      );
    });

  // What a delete would take with it, named rather than counted, so the confirmation is specific.
  const nestedTitles = pendingDelete
    ? descendantIds(pages, pendingDelete.id).map(
        (id) => pages.find((page) => page.id === id)?.title ?? id,
      )
    : [];
  const nestedCount = nestedTitles.length;

  // For a database page, its immediate children are rows rather than sub-pages. Say "rows" rather
  // than "pages" so the copy matches what the user sees in the table (ADV-055).
  const nestedSummary = (() => {
    if (!pendingDelete) return '';
    if (pendingDelete.kind === 'database') {
      const rowCount = pages.filter(
        (p) => p.parentId === pendingDelete.id && p.kind === 'row',
      ).length;
      return rowCount === 0
        ? 'The database contains no rows.'
        : `${rowCount === 1 ? '1 row' : `${rowCount} rows`} inside it will also be deleted.`;
    }
    return nestedCount === 0
      ? 'It has no nested pages.'
      : `${nestedCount === 1 ? 'One page nested inside it' : `${nestedCount} pages nested inside it`} will be deleted too: ${nestedTitles.slice(0, 3).join(', ')}${nestedCount > 3 ? `, and ${nestedCount - 3} more` : ''}.`;
  })();

  return (
    <aside
      className="flex w-full flex-col gap-1.5 overflow-hidden border-r border-panel-border bg-panel px-3.5 pt-4.5 pb-3.5 text-panel-text outline-none"
      data-testid="sidebar"
      // tabIndex -1 lets the drawer receive programmatic focus on open without adding a tab stop.
      tabIndex={-1}
      ref={sidebarRef as React.Ref<HTMLElement>}
      // Escape on any element inside the drawer closes it and returns focus to the toggle.
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose?.();
      }}
    >
      <header className="flex items-center gap-[11px] px-1 pt-1 pb-3.5">
        {/* Brand mark: amber square with workspace initial. size-9 = 36px, rounded-md = project's
            12px radius (snapped from 11px). */}
        <span
          className="grid size-9 flex-none place-items-center rounded-md bg-amber text-base font-extrabold text-text-on-amber"
          aria-hidden="true"
        >
          {workspaceName.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-bold tracking-[-0.01em]">Personal Space</span>
          <span className="flex items-center gap-1.5 text-xs text-panel-text-muted">
            {workspaceName}
            {/* Role chip: purple at 32% opacity on a dark background. */}
            <span className="rounded-full bg-purple/32 px-[7px] py-px text-[10px] font-bold tracking-[0.07em] text-purple-soft uppercase">
              {role}
            </span>
          </span>
        </span>
      </header>

      <div className="flex items-center justify-between px-1.5 pt-1.5 pb-1">
        <h2 className="m-0 text-xs font-bold tracking-[0.11em] text-panel-text-muted uppercase">
          Pages
        </h2>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className="grid min-h-12 min-w-12 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-panel-text-muted hover:bg-panel-hover hover:text-amber-soft"
            aria-label="Add a top-level page"
            title="Add a top-level page"
            onClick={() => onCreatePage(null)}
          >
            <Plus size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="grid min-h-12 min-w-12 cursor-pointer place-items-center rounded-sm border-0 bg-transparent text-panel-text-muted hover:bg-panel-hover hover:text-blue-soft"
            aria-label="Add a top-level database"
            title="Add a top-level database"
            data-testid="new-database-top"
            onClick={() => onCreateDatabase(null)}
          >
            <Table2 size={14} aria-hidden />
          </button>
        </span>
      </div>

      {/* Page tree: flex-1 + min-h-0 lets it shrink so the footer stays visible on short screens.
          Negative horizontal margin with equal padding keeps the scrollbar visually inset. */}
      <nav className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-label="Page tree">
        {tree.length > 0 ? (
          <ul role="tree" aria-label="Pages" className="m-0 list-none p-0">
            {renderRows(tree)}
          </ul>
        ) : (
          <p className="mx-1.5 mt-2 text-sm leading-normal text-panel-text-muted">
            No pages yet. Add one to get started.
          </p>
        )}
      </nav>

      <div className="mx-0.5 mt-2 mb-2.5 flex gap-1.5">
        <Button className="flex-1" onClick={() => onCreatePage(null)}>
          <Plus size={16} aria-hidden />
          New page
        </Button>
        <Button
          className="flex-1"
          data-testid="new-database-bottom"
          onClick={() => onCreateDatabase(null)}
        >
          <Table2 size={16} aria-hidden />
          New database
        </Button>
      </div>

      <footer className="flex items-center gap-2.5 border-t border-panel-border pt-3">
        {/* Avatar: visually 30px circle, but min-48px hit area is on the footer as a whole. */}
        <span
          className="grid size-[30px] flex-none place-items-center rounded-full bg-blue/28 text-sm font-bold text-blue-soft"
          aria-hidden="true"
        >
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">{userName}</span>
          <span className="overflow-hidden text-[11.5px] text-ellipsis whitespace-nowrap text-panel-text-muted">
            {userEmail}
          </span>
        </span>
      </footer>

      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete "${pendingDelete.title}"?`}
          lines={[nestedSummary, 'Deletion is permanent - there is no trash.']}
          confirmLabel="Delete permanently"
          onConfirm={() => {
            const page = pendingDelete;
            setPendingDelete(null);
            onDeletePage(page);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </aside>
  );
}
