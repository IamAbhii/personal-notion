import { useParams } from '@tanstack/react-router';
import { PageView } from '../components/PageView/PageView';
import { BlockEditor } from '../components/BlockEditor';
import { DatabaseView } from '../components/DatabaseView/DatabaseView';
import { RowPage } from '../components/RowPage/RowPage';
import { useWorkspace } from '../workspace/context';
import { ancestorChain, childrenOf } from '../lib/pageTree';
import { blocksForPage } from '../lib/blocks';
import { StatusCard } from '../components/ui/StatusCard/StatusCard';
import { bySortKeyThenId } from '../lib/ordering';

/** The route screen for one page: branches on page kind for database, row and plain page views. */
export function PageScreen() {
  const { pageId } = useParams({ from: '/w/$workspaceId/page/$pageId' });
  const {
    pages,
    blocks,
    properties,
    values,
    mutations,
    blockMutations,
    propertyMutations,
    selectPage,
    notify,
    createRowInPlace,
  } = useWorkspace();

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

    return (
      <PageView
        page={page}
        breadcrumb={ancestorChain(pages, page.id)}
        childCount={0}
        onSelectPage={selectPage}
        onRename={(title) => void mutations.updatePage(page, { title })}
        onChangeIcon={(icon) => void mutations.updatePage(page, { icon })}
      >
        <DatabaseView
          dbPage={page}
          rowPages={rowPages}
          properties={dbProperties}
          values={dbValues}
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
        />
      </PageView>
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
