import { useState } from 'react';
import type { ReactNode } from 'react';
import { EmojiPickerPopover } from '../EmojiPickerPopover';
import { InlineTitleInput } from '../InlineTitleInput/InlineTitleInput';
import { collapseBreadcrumb } from '../../lib/treeLayout';
import { cn } from '../../lib/cn';
import type { PageRecord } from '../../api/types';
import styles from './PageView.module.css';

export interface PageViewProps {
  page: PageRecord;
  /** Root-to-page chain, used for the breadcrumb. */
  breadcrumb: PageRecord[];
  childCount: number;
  onSelectPage: (pageId: string) => void;
  onRename: (title: string) => void;
  onChangeIcon: (icon: string) => void;
  /** The page body - the block editor. Composed by the route screen, which owns the block writes. */
  children?: ReactNode;
}

/**
 * The page area: breadcrumb, the icon and title header, and the body its caller supplies. The
 * header is the second place a page can be renamed and the only place its icon is chosen.
 */
export function PageView({
  page,
  breadcrumb,
  childCount,
  onSelectPage,
  onRename,
  onChangeIcon,
  children,
}: PageViewProps) {
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [isPickingIcon, setPickingIcon] = useState(false);

  return (
    <>
      {/* A sticky bar so the trail to the current page survives scrolling.
          Future: the sync status indicator (synced / N pending / offline) lands on its right. */}
      <div className="sticky top-0 z-5 flex h-13 items-center justify-between gap-4 border-b border-border bg-canvas/97 px-4 backdrop-blur sm:px-7">
        {/* The chain is collapsed rather than rendered whole: pages nest to any depth, and a 26-deep
            trail otherwise wraps to several lines and pushes itself out of the fixed-height bar. */}
        <nav
          className="flex min-h-5 min-w-0 flex-nowrap items-center gap-1 overflow-hidden text-xs text-text-muted"
          aria-label="Breadcrumb"
        >
          {collapseBreadcrumb(breadcrumb).map((item, index) => (
            <span
              className="inline-flex min-w-0 items-center gap-1 last:flex-[0_1_auto]"
              data-testid="breadcrumb-item"
              key={item.kind === 'page' ? item.page.id : 'gap'}
            >
              {index > 0 ? (
                <span className="text-border" aria-hidden="true">
                  /
                </span>
              ) : null}
              {item.kind === 'gap' ? (
                <span
                  className="px-0.5 font-bold tracking-[0.05em] text-text-muted"
                  data-testid="breadcrumb-gap"
                  title={`${item.hidden.length} pages between: ${item.hidden.map((crumb) => crumb.title).join(' / ')}`}
                >
                  ...
                </span>
              ) : (
                <button
                  type="button"
                  className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-text-muted hover:bg-surface hover:text-blue-fg aria-[current=page]:font-semibold aria-[current=page]:text-text"
                  data-testid="breadcrumb-link"
                  aria-current={item.page.id === page.id ? 'page' : undefined}
                  title={item.page.title}
                  onClick={() => onSelectPage(item.page.id)}
                >
                  <span className="font-emoji text-[13px] leading-none" aria-hidden="true">
                    {item.page.icon}
                  </span>
                  {/* A long title is truncated here rather than in the button, so the icon stays
                      visible instead of being pushed out by the text. */}
                  <span
                    className="inline-block max-w-[22ch] overflow-hidden align-bottom text-ellipsis whitespace-nowrap"
                    data-testid="breadcrumb-label"
                  >
                    {item.page.title}
                  </span>
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>

      {/* Database pages get full content-area width so all columns fit at desktop widths.
          Prose pages (page and row) keep the 860px reading measure — databases are tables
          and tables are the content; paragraphs are not. Row pages are kept at the prose width
          because they combine a property panel with a block editor: both read better in a
          constrained column. Only `px-4` is applied for databases so no desktop padding eats
          into the available table width. */}
      <main
        className={cn(
          'mx-auto pt-6 pb-24 sm:pt-8',
          page.kind === 'database' ? 'px-4' : 'max-w-[860px] px-4 sm:px-8 md:px-14',
        )}
      >
        {/* data-page-id here lets a test assert which page the main area is showing without
            parsing the URL. Same convention as the sidebar rows. */}
        <header className="mt-2.5" data-testid="page-header" data-page-id={page.id}>
          <div className="relative inline-block">
            {page.icon ? (
              /* Icon button: visually 76px so it naturally exceeds the 48px touch minimum. The
                 hover transform + compound shadow are in the module CSS because Tailwind cannot
                 compose two shadow layers into a single shadow property. */
              <button
                type="button"
                className={cn(
                  'grid size-[76px] cursor-pointer place-items-center rounded-lg border border-border bg-surface font-emoji text-[44px] leading-none shadow-panel transition-[transform,box-shadow] duration-[120ms] ease-in-out hover:-translate-y-px motion-reduce:transition-none',
                  styles.icon,
                )}
                aria-label={`Change the icon for ${page.title}`}
                onClick={() => setPickingIcon(true)}
              >
                <span aria-hidden="true">{page.icon}</span>
              </button>
            ) : (
              /* When no icon is set (e.g. row pages), render a small affordance instead of an
                 empty bordered tile. Always visible so it is reachable on touch. */
              <button
                type="button"
                className="min-h-[48px] cursor-pointer rounded-md border border-dashed border-border px-3 py-2 text-sm text-text-muted hover:border-blue hover:text-blue-fg focus-visible:outline-2 focus-visible:outline-blue"
                aria-label={`Add an icon for ${page.title}`}
                onClick={() => setPickingIcon(true)}
              >
                Add icon
              </button>
            )}
            {isPickingIcon ? (
              <EmojiPickerPopover
                onPick={(emoji) => onChangeIcon(emoji)}
                onClose={() => setPickingIcon(false)}
              />
            ) : null}
          </div>

          {isEditingTitle ? (
            <InlineTitleInput
              value={page.title}
              ariaLabel={`New name for ${page.title}`}
              // Heading-sized input: inherits the same font stack and responsive sizes as the h1,
              // with a blue underline to signal edit mode. [overflow-wrap:anywhere] matches the h1.
              className="mt-4.5 w-full border-0 border-b-2 border-blue bg-transparent pb-0.5 font-sans text-[28px] leading-[1.1] font-[750] tracking-tight [overflow-wrap:anywhere] text-text focus:outline-none sm:text-4xl md:text-[42px]"
              layout="block"
              onCommit={(title) => {
                setEditingTitle(false);
                onRename(title);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            // A title has no length limit worth relying on, so it wraps - including mid-word for
            // a title with no spaces (overflow-wrap:anywhere). The h1 carries the overflow-wrap
            // and word-break so the button inherits them via [font:inherit].
            <h1
              className="mt-4.5 text-[28px] leading-[1.1] font-[750] tracking-tight [overflow-wrap:anywhere] break-words sm:text-4xl md:text-[42px]"
              data-testid="page-title"
            >
              <button
                type="button"
                className="[display:block] max-w-full cursor-text border-0 bg-transparent p-0 text-left tracking-[inherit] [overflow-wrap:anywhere] break-words [font:inherit]"
                aria-label={`Rename ${page.title}`}
                onClick={() => setEditingTitle(true)}
              >
                {page.title}
              </button>
            </h1>
          )}

          <p className="mt-3.5 flex items-center gap-2 text-xs text-text-muted">
            {/* A leaf page says nothing about nesting rather than saying "0 nested pages". */}
            {childCount > 0 ? (
              <>
                <span className="inline-block size-2 rounded-full bg-amber" aria-hidden="true" />
                {childCount === 1 ? '1 nested page' : `${childCount} nested pages`}
                <span className="text-border" aria-hidden="true">
                  &middot;
                </span>
              </>
            ) : null}
            Updated {new Date(page.updatedAt).toLocaleDateString()}
          </p>
        </header>

        {children}
      </main>
    </>
  );
}
