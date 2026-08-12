import { useParams } from '@tanstack/react-router';
import { PageView } from '../components/PageView/PageView';
import { BlockEditor } from '../components/BlockEditor';
import { useWorkspace } from '../workspace/context';
import { ancestorChain, childrenOf } from '../lib/pageTree';
import { blocksForPage } from '../lib/blocks';
import { StatusCard } from '../components/ui/StatusCard/StatusCard';

/** The route screen for one page: resolves the page and its blocks from the snapshot and renders them. */
export function PageScreen() {
  const { pageId } = useParams({ from: '/w/$workspaceId/page/$pageId' });
  const { pages, blocks, mutations, blockMutations, selectPage, notify } = useWorkspace();

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
