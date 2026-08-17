import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { PageView } from '../components/PageView/PageView';
import { BlockEditor } from '../components/BlockEditor';
import { DatabaseView } from '../components/DatabaseView/DatabaseView';
import { BoardView } from '../components/BoardView/BoardView';
import { ListView } from '../components/ListView/ListView';
import { ViewSwitcher } from '../components/ViewSwitcher/ViewSwitcher';
import { FilterSortControl } from '../components/FilterSortControl/FilterSortControl';
import { RowPage } from '../components/RowPage/RowPage';
import { useWorkspace } from '../workspace/context';
import { ancestorChain, childrenOf } from '../lib/pageTree';
import { blocksForPage } from '../lib/blocks';
import { StatusCard } from '../components/ui/StatusCard/StatusCard';
import { bySortKeyThenId } from '../lib/ordering';
import {
  buildValuesMap,
  cleanViewAfterPropertyDelete,
  filterRows,
  groupRows,
  sortRows,
} from '../lib/viewData';
import { useUiStoreShallow } from '../stores/uiStore';
import type { ViewKind } from '../api/types';

/** The route screen for one page: branches on page kind for database, row and plain page views. */
export function PageScreen() {
  const { pageId } = useParams({ from: '/w/$workspaceId/page/$pageId' });
  const {
    pages,
    blocks,
    properties,
    values,
    views,
    mutations,
    blockMutations,
    propertyMutations,
    viewMutations,
    selectPage,
    notify,
    createRowInPlace,
  } = useWorkspace();

  const { activeViewKindByDb, setActiveViewKind } = useUiStoreShallow((s) => ({
    activeViewKindByDb: s.activeViewKindByDb,
    setActiveViewKind: s.setActiveViewKind,
  }));

  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    // Reachable by a stale deep link or a page deleted on another device.
    return (
      <main className="mx-auto max-w-[860px] px-4 py-8 pb-24 sm:px-14">
        {/* sunken variant matches the original .placeholder shell: dashed border, sunken bg.
            mt-8 replaces the original margin-top: 34px on .placeholder. */}
        <StatusCard
          variant="sunken"
          eyebrowIntent="info"
          eyebrow="Not found"
          lead="This page no longer exists."
          note="Pick another page from the sidebar."
          className="mt-8"
        />
      </main>
    );
  }

  // ---------- Database view ----------

  if (page.kind === 'database') {
    const dbProperties = properties
      .filter((p) => p.databasePageId === page.id)
      .sort(bySortKeyThenId);
    const rowPages = pages
      .filter((p) => p.parentId === page.id && p.kind === 'row')
      .sort(bySortKeyThenId);
    const dbValues = values.filter((v) => rowPages.some((r) => r.id === v.rowPageId));

    // Views for this database, sorted by their sort key.
    const dbViews = views.filter((v) => v.databasePageId === page.id).sort(bySortKeyThenId);

    // Active view kind: stored locally per database, defaulting to table.
    // Future: persist per user on the server (user_preferences table, key: workspaceId + dbPageId)
    // so the chosen view follows the user across devices.
    const activeKind: ViewKind = activeViewKindByDb[page.id] ?? 'table';

    // Find the ViewRecord for the active kind so filters/sort/group are applied from it.
    const activeView = dbViews.find((v) => v.kind === activeKind) ?? dbViews[0] ?? null;

    return (
      <DatabasePageContent
        page={page}
        dbProperties={dbProperties}
        dbViews={dbViews}
        rowPages={rowPages}
        dbValues={dbValues}
        activeKind={activeKind}
        activeView={activeView}
        onSwitchView={(kind) => setActiveViewKind(page.id, kind)}
        onSelectRow={selectPage}
        onCreateRow={() => createRowInPlace(page.id)}
        onDeleteRow={(row) => void mutations.deletePage(row)}
        onRenameRow={(row, title) => void mutations.updatePage(row, { title })}
        onCreateProperty={(args) =>
          void propertyMutations.createProperty({
            databasePageId: page.id,
            ...args,
          })
        }
        onUpdateProperty={(prop, changes) => void propertyMutations.updateProperty(prop, changes)}
        onDeleteProperty={(prop) => void propertyMutations.deleteProperty(prop)}
        onSetValue={(args) => void propertyMutations.setValue(args)}
        onUpdateView={(view, changes) => void viewMutations.updateView(view, changes)}
        onCreateDefaultViews={() => void viewMutations.createDefaultViews(page.id)}
        notify={notify}
        onRenamePage={(title) => void mutations.updatePage(page, { title })}
        onChangeIcon={(icon) => void mutations.updatePage(page, { icon })}
        pages={pages}
      />
    );
  }

  // ---------- Row page view ----------

  if (page.kind === 'row') {
    const dbPage = pages.find((p) => p.id === page.parentId);
    const dbProperties = dbPage
      ? properties.filter((p) => p.databasePageId === dbPage.id).sort(bySortKeyThenId)
      : [];
    const rowValues = values.filter((v) => v.rowPageId === page.id);

    return (
      <PageView
        page={page}
        breadcrumb={ancestorChain(pages, page.id)}
        childCount={0}
        onSelectPage={selectPage}
        onRename={(title) => void mutations.updatePage(page, { title })}
        onChangeIcon={(icon) => void mutations.updatePage(page, { icon })}
      >
        <RowPage
          row={page}
          dbPage={dbPage}
          properties={dbProperties}
          values={rowValues}
          onSetValue={(args) => void propertyMutations.setValue(args)}
          onUpdateOptions={(prop, options) => {
            void propertyMutations.updateProperty(prop, { options });
            // Return the last option — the caller appended the new one — so SelectCell can select it immediately.
            return options[options.length - 1] ?? null;
          }}
        >
          {/* The editor is keyed by page so switching pages rebuilds it. */}
          <BlockEditor
            key={page.id}
            blocks={blocksForPage(blocks, page.id)}
            onCreateBlock={(args) => blockMutations.createBlock({ pageId: page.id, ...args })}
            onUpdateBlock={(block, changes) => void blockMutations.updateBlock(block, changes)}
            onDeleteBlock={(block) => void blockMutations.deleteBlock(block)}
            onNotice={notify}
          />
        </RowPage>
      </PageView>
    );
  }

  // ---------- Plain page view ----------

  return (
    <PageView
      page={page}
      breadcrumb={ancestorChain(pages, page.id)}
      childCount={childrenOf(pages, page.id).length}
      onSelectPage={selectPage}
      onRename={(title) => void mutations.updatePage(page, { title })}
      onChangeIcon={(icon) => void mutations.updatePage(page, { icon })}
    >
      {/* The editor is keyed by page so switching pages rebuilds it, which resets every block's
          local editing state rather than carrying one page's drafts into another. */}
      <BlockEditor
        key={page.id}
        blocks={blocksForPage(blocks, page.id)}
        onCreateBlock={(args) => blockMutations.createBlock({ pageId: page.id, ...args })}
        onUpdateBlock={(block, changes) => void blockMutations.updateBlock(block, changes)}
        onDeleteBlock={(block) => void blockMutations.deleteBlock(block)}
        onNotice={notify}
      />
    </PageView>
  );
}

// ── Database page content ─────────────────────────────────────────────────────

// Pulled into a child component so the filter/sort memos run inside the database branch only.
// The parent `PageScreen` function cannot call hooks conditionally, so separating it here keeps
// the hook call count stable across all three page kinds.

import type { PageRecord, PropertyRecord, PropertyValueRecord, ViewRecord } from '../api/types';

interface DatabasePageContentProps {
  page: PageRecord;
  dbProperties: PropertyRecord[];
  /** All views for this database, in sort-key order. Used for no-views state and filter cleanup. */
  dbViews: ViewRecord[];
  rowPages: PageRecord[];
  dbValues: PropertyValueRecord[];
  activeKind: ViewKind;
  activeView: ViewRecord | null;
  onSwitchView: (kind: ViewKind) => void;
  onSelectRow: (rowPageId: string) => void;
  onCreateRow: () => Promise<string | null>;
  onDeleteRow: (row: PageRecord) => void;
  onRenameRow: (row: PageRecord, title: string) => void;
  onCreateProperty: (args: {
    name: string;
    type: PropertyRecord['type'];
    options?: PropertyRecord['options'];
  }) => void;
  onUpdateProperty: (
    property: PropertyRecord,
    changes: { name?: string; options?: PropertyRecord['options'] },
  ) => void;
  onDeleteProperty: (property: PropertyRecord) => void;
  onSetValue: (args: { rowPageId: string; propertyId: string; value: string | null }) => void;
  onUpdateView: (
    view: ViewRecord,
    changes: Partial<Pick<ViewRecord, 'filters' | 'sort' | 'groupPropertyId'>>,
  ) => void;
  /** Creates the three default views for this database when none exist (DEF-073). */
  onCreateDefaultViews: () => void;
  /** Toast notification channel, forwarded to BoardView for post-move feedback (DEF-078). */
  notify: (message: string) => void;
  onRenamePage: (title: string) => void;
  onChangeIcon: (icon: string) => void;
  pages: PageRecord[];
}

/**
 * The database surface: view switcher + filter/sort bar + the active view.
 * Separated from PageScreen so filter/sort memos can run unconditionally inside this component.
 */
function DatabasePageContent({
  page,
  dbProperties,
  dbViews,
  rowPages,
  dbValues,
  activeKind,
  activeView,
  onSwitchView,
  onSelectRow,
  onCreateRow,
  onDeleteRow,
  onRenameRow,
  onCreateProperty,
  onUpdateProperty,
  onDeleteProperty,
  onSetValue,
  onUpdateView,
  onCreateDefaultViews,
  notify,
  onRenamePage,
  onChangeIcon,
  pages,
}: DatabasePageContentProps) {
  // Build the values map once for filter and sort.
  const valuesMap = useMemo(() => buildValuesMap(dbValues), [dbValues]);

  // Apply filter and sort from the active view. These compute during render (derived state),
  // not in effects, so there is no stale-state lag after a view.update lands.
  const filteredRows = useMemo(
    () => filterRows(rowPages, valuesMap, dbProperties, activeView?.filters ?? []),
    [rowPages, valuesMap, dbProperties, activeView?.filters],
  );

  const displayRows = useMemo(
    () => sortRows(filteredRows, valuesMap, dbProperties, activeView?.sort ?? null),
    [filteredRows, valuesMap, dbProperties, activeView?.sort],
  );

  // Grouping property for the board view (null if not set or not a select property).
  const groupProperty = useMemo(() => {
    if (!activeView) return null;
    if (!activeView.groupPropertyId) return null;
    return dbProperties.find((p) => p.id === activeView.groupPropertyId) ?? null;
  }, [activeView, dbProperties]);

  // Board columns: computed when the board view is active.
  const boardColumns = useMemo(() => {
    if (activeKind !== 'board' || !groupProperty) return [];
    return groupRows(displayRows, dbValues, groupProperty);
  }, [activeKind, displayRows, dbValues, groupProperty]);

  const handleViewUpdate = (changes: {
    filters?: ViewRecord['filters'];
    sort?: ViewRecord['sort'];
    groupPropertyId?: string | null;
  }) => {
    if (!activeView) return;
    onUpdateView(activeView, changes);
  };

  // When a property is deleted, any view that references it in a filter or sort will render a
  // dangling filter (DEF-071). Drop the stale references from all affected views before the
  // property.delete op lands, so the panel never shows a filter that is not the stored one.
  const handleDeleteProperty = (prop: PropertyRecord) => {
    for (const view of dbViews) {
      const cleaned = cleanViewAfterPropertyDelete(view, prop.id);
      if (cleaned) {
        onUpdateView(view, cleaned);
      }
    }
    onDeleteProperty(prop);
  };

  // When the database has no views (e.g. they were rejected at creation — DEF-073), show an
  // honest empty state with a recovery button rather than a broken shell.
  if (dbViews.length === 0) {
    return (
      <PageView
        page={page}
        breadcrumb={ancestorChain(pages, page.id)}
        childCount={0}
        onSelectPage={onSelectRow}
        onRename={onRenamePage}
        onChangeIcon={onChangeIcon}
      >
        <div className="flex flex-col items-center gap-4 rounded-lg border-2 border-dashed border-border px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">This database has no views yet.</p>
          <p className="text-sm text-text-muted">
            Views are normally created automatically. You can recreate them now.
          </p>
          <button
            type="button"
            className="min-h-12 rounded-md bg-blue px-4 py-3 text-sm font-medium text-white hover:opacity-90"
            onClick={onCreateDefaultViews}
          >
            Create default views
          </button>
        </div>
      </PageView>
    );
  }

  return (
    <PageView
      page={page}
      breadcrumb={ancestorChain(pages, page.id)}
      childCount={0}
      onSelectPage={onSelectRow}
      onRename={onRenamePage}
      onChangeIcon={onChangeIcon}
    >
      {/* View bar: switcher on the left, filter/sort on the right */}
      <div className="mb-3 flex items-center gap-2 border-b border-border pb-3">
        <ViewSwitcher activeKind={activeKind} onSwitch={onSwitchView} className="flex-1" />
        {activeView && (
          <FilterSortControl
            view={activeView}
            properties={dbProperties}
            rows={displayRows}
            viewKind={activeKind}
            onUpdate={handleViewUpdate}
          />
        )}
      </div>

      {/* Active view body */}
      {activeKind === 'table' && (
        <DatabaseView
          dbPage={page}
          rowPages={displayRows}
          properties={dbProperties}
          values={dbValues}
          onSelectRow={onSelectRow}
          onCreateRow={onCreateRow}
          onDeleteRow={onDeleteRow}
          onRenameRow={onRenameRow}
          onCreateProperty={onCreateProperty}
          onUpdateProperty={onUpdateProperty}
          onDeleteProperty={handleDeleteProperty}
          onSetValue={onSetValue}
        />
      )}

      {activeKind === 'board' && (
        <BoardView
          columns={boardColumns}
          allRows={rowPages}
          groupProperty={groupProperty}
          onSelectRow={onSelectRow}
          onCreateRow={onCreateRow}
          onSetValue={onSetValue}
          notify={notify}
        />
      )}

      {activeKind === 'list' && (
        <ListView
          rows={displayRows}
          properties={dbProperties}
          values={dbValues}
          onSelectRow={onSelectRow}
        />
      )}
    </PageView>
  );
}
