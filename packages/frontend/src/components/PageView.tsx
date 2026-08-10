import { useState } from 'react';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { InlineTitleInput } from './InlineTitleInput';
import type { PageRecord } from '../api/types';

export interface PageViewProps {
  page: PageRecord;
  /** Root-to-page chain, used for the breadcrumb. */
  breadcrumb: PageRecord[];
  childCount: number;
  onSelectPage: (pageId: string) => void;
  onRename: (title: string) => void;
  onChangeIcon: (icon: string) => void;
}

/**
 * The page area: breadcrumb, the icon and title header, and an empty-state body. The header is the
 * second place a page can be renamed and the only place its icon is chosen.
 */
export function PageView({
  page,
  breadcrumb,
  childCount,
  onSelectPage,
  onRename,
  onChangeIcon,
}: PageViewProps) {
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [isPickingIcon, setPickingIcon] = useState(false);

  return (
    <>
      {/* A sticky bar so the trail to the current page survives scrolling.
          Future: the sync status indicator (synced / N pending / offline) lands on its right. */}
      <div className="topbar">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          {breadcrumb.map((crumb, index) => (
            <span className="breadcrumb__item" key={crumb.id}>
              {index > 0 ? (
                <span className="breadcrumb__sep" aria-hidden="true">
                  /
                </span>
              ) : null}
              <button
                type="button"
                className="breadcrumb__link"
                aria-current={crumb.id === page.id ? 'page' : undefined}
                onClick={() => onSelectPage(crumb.id)}
              >
                <span className="breadcrumb__icon" aria-hidden="true">
                  {crumb.icon}
                </span>
                {crumb.title}
              </button>
            </span>
          ))}
        </nav>
      </div>

      <main className="page">
        <header className="page__header">
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

        {/* Placeholder for the block editor, which is the next phase's task. Not blocks. */}
        <section className="placeholder" aria-label="Page body">
          <p className="placeholder__eyebrow">Editor placeholder</p>
          <p className="placeholder__lead">This page has no content yet.</p>
          <p className="placeholder__note">
            The block editor - text, headings, lists, to-dos, images and drag-to-reorder - arrives
            in the next phase. Until then the page area shows its icon and title only.
          </p>
          <div className="placeholder__lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      </main>
    </>
  );
}
