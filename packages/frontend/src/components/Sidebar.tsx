import { useState, type ReactNode } from 'react';
import { buildPageTree, descendantIds, type PageNode } from '../lib/pageTree';
import { rowIndent } from '../lib/treeLayout';
import { ConfirmDialog } from './ConfirmDialog';
import { InlineTitleInput } from './InlineTitleInput';
import { ChevronIcon, PencilIcon, PlusIcon, TrashIcon } from './icons';
import type { PageRecord } from '../api/types';

export interface SidebarProps {
  workspaceName: string;
  role: string;
  userName: string;
  userEmail: string;
  pages: PageRecord[];
  currentPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (parentId: string | null) => void;
  onRenamePage: (page: PageRecord, title: string) => void;
  onDeletePage: (page: PageRecord) => void;
}

/**
 * The navigation panel: the whole page tree to any depth, with create, rename and delete per row.
 * Presentational on purpose - the route wires it to the router and the op-based mutations - so the
 * tree behaviour can be unit tested without a router or a server.
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
  onRenamePage,
  onDeletePage,
}: SidebarProps) {
  // Collapsed rather than expanded ids: a new page's children are visible without bookkeeping, and
  // the tree opens fully on first load.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PageRecord | null>(null);

  const tree = buildPageTree(pages);

  const toggle = (pageId: string) =>
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  const renderRows = (nodes: PageNode[]): ReactNode =>
    // Future: drag-reorder of the page tree goes here - pages already carry a fractional sortKey,
    // so a drop emits one page.update op with a key computed between the two neighbours.
    nodes.map((node) => {
      const { page, depth, children } = node;
      const isCollapsed = collapsedIds.has(page.id);
      const isCurrent = page.id === currentPageId;

      return (
        <li
          key={page.id}
          role="treeitem"
          aria-expanded={children.length ? !isCollapsed : undefined}
        >
          {/* data-page-id is the end-to-end selector hook: it names one entity unambiguously where
              visible text can repeat across rows. It sits on the row container so the title control
              and the row actions are all inside the matched element.
              Future: blocks and database rows carry the same shape - data-block-id, data-row-id. */}
          <div
            className={`row${isCurrent ? ' row--current' : ''}`}
            data-page-id={page.id}
            // Indentation is capped past a few levels, so a row nested 20 deep still shows its icon
            // and title rather than being indented out of the panel.
            style={{ paddingLeft: `${rowIndent(depth)}px` }}
          >
            {children.length > 0 ? (
              <button
                type="button"
                className={`row__disclosure${isCollapsed ? '' : ' row__disclosure--open'}`}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${page.title}`}
                onClick={() => toggle(page.id)}
              >
                <ChevronIcon />
              </button>
            ) : (
              <span className="row__disclosure row__disclosure--empty" aria-hidden="true" />
            )}

            <span className="row__icon" aria-hidden="true">
              {page.icon}
            </span>

            {renamingId === page.id ? (
              <InlineTitleInput
                value={page.title}
                ariaLabel={`New name for ${page.title}`}
                className="row__input"
                onCommit={(title) => {
                  setRenamingId(null);
                  onRenamePage(page, title);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <button type="button" className="row__title" onClick={() => onSelectPage(page.id)}>
                {page.title}
              </button>
            )}

            <span className="row__actions">
              <button
                type="button"
                className="row__action"
                aria-label={`Rename ${page.title}`}
                title="Rename"
                onClick={() => setRenamingId(page.id)}
              >
                <PencilIcon />
              </button>
              <button
                type="button"
                className="row__action"
                aria-label={`Add a page inside ${page.title}`}
                title="Add a page inside"
                onClick={() => onCreatePage(page.id)}
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className="row__action row__action--danger"
                aria-label={`Delete ${page.title}`}
                title="Delete"
                onClick={() => setPendingDelete(page)}
              >
                <TrashIcon />
              </button>
            </span>
          </div>

          {children.length > 0 && !isCollapsed ? (
            <ul role="group">{renderRows(children)}</ul>
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
  const nestedSummary =
    nestedCount === 0
      ? 'It has no nested pages.'
      : `${nestedCount === 1 ? 'One page nested inside it' : `${nestedCount} pages nested inside it`} will be deleted too: ${nestedTitles.slice(0, 3).join(', ')}${nestedCount > 3 ? `, and ${nestedCount - 3} more` : ''}.`;

  return (
    <aside className="sidebar">
      <header className="sidebar__brand">
        <span className="brand__mark" aria-hidden="true">
          {workspaceName.slice(0, 1).toUpperCase()}
        </span>
        <span className="brand__text">
          <span className="brand__app">Personal Space</span>
          <span className="brand__workspace">
            {workspaceName}
            <span className="chip">{role}</span>
          </span>
        </span>
      </header>

      <div className="sidebar__section">
        <h2 className="sidebar__section-title">Pages</h2>
        <button
          type="button"
          className="sidebar__section-action"
          aria-label="Add a top-level page"
          title="Add a top-level page"
          onClick={() => onCreatePage(null)}
        >
          <PlusIcon />
        </button>
      </div>

      <nav className="sidebar__tree" aria-label="Page tree">
        {tree.length > 0 ? (
          <ul role="tree" aria-label="Pages">
            {renderRows(tree)}
          </ul>
        ) : (
          <p className="sidebar__empty">No pages yet. Add one to get started.</p>
        )}
      </nav>

      <button
        type="button"
        className="button button--primary sidebar__new"
        onClick={() => onCreatePage(null)}
      >
        <PlusIcon />
        New page
      </button>

      <footer className="sidebar__user">
        <span className="avatar" aria-hidden="true">
          {userName.slice(0, 1).toUpperCase()}
        </span>
        <span className="sidebar__user-text">
          <span className="sidebar__user-name">{userName}</span>
          <span className="sidebar__user-email">{userEmail}</span>
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
