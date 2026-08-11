import { useState } from 'react';
import type { ReactNode } from 'react';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { InlineTitleInput } from './InlineTitleInput';
import { collapseBreadcrumb } from '../lib/treeLayout';
import type { PageRecord } from '../api/types';

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
      <div className="topbar">
        {/* The chain is collapsed rather than rendered whole: pages nest to any depth, and a 26-deep
            trail otherwise wraps to several lines and pushes itself out of the fixed-height bar. */}
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {collapseBreadcrumb(breadcrumb).map((item, index) => (
            <span className="breadcrumb__item" key={item.kind === 'page' ? item.page.id : 'gap'}>
              {index > 0 ? (
                <span className="breadcrumb__sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              {item.kind === 'gap' ? (
                <span
                  className="breadcrumb__gap"
                  title={`${item.hidden.length} pages between: ${item.hidden.map((crumb) => crumb.title).join(' / ')}`}
                >
                  ...
                </span>
              ) : (
                <button
                  type="button"
                  className="breadcrumb__link"
                  aria-current={item.page.id === page.id ? 'page' : undefined}
                  title={item.page.title}
                  onClick={() => onSelectPage(item.page.id)}
                >
                  <span className="breadcrumb__icon" aria-hidden="true">
                    {item.page.icon}
                  </span>
                  {/* A long title is truncated here rather than in the button, so the icon stays
                      visible instead of being pushed out by the text. */}
                  <span className="breadcrumb__label">{item.page.title}</span>
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>

      <main className="page">
        {/* data-page-id here lets a test assert which page the main area is showing without
            parsing the URL. Same convention as the sidebar rows. */}
        <header className="page__header" data-page-id={page.id}>
          <div className="page__icon-wrap">
            <button
              type="button"
              className="page__icon"
              aria-label={`Change the icon for ${page.title}`}
              onClick={() => setPickingIcon(true)}
            >
              <span aria-hidden="true">{page.icon}</span>
            </button>
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
              className="page__title-input"
              onCommit={(title) => {
                setEditingTitle(false);
                onRename(title);
              }}
              onCancel={() => setEditingTitle(false)}
            />
          ) : (
            <h1 className="page__title">
              <button
                type="button"
                className="page__title-button"
                aria-label={`Rename ${page.title}`}
                onClick={() => setEditingTitle(true)}
              >
                {page.title}
              </button>
            </h1>
          )}

          <p className="page__meta">
            {/* A leaf page says nothing about nesting rather than saying "0 nested pages". */}
            {childCount > 0 ? (
              <>
                <span className="dot dot--amber" aria-hidden="true" />
                {childCount === 1 ? '1 nested page' : `${childCount} nested pages`}
                <span className="page__meta-sep" aria-hidden="true">
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
