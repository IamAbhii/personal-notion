import { useParams } from '@tanstack/react-router';
import { PageView } from '../components/PageView';
import { BlockEditor } from '../components/BlockEditor';
import { useWorkspace } from '../workspace/context';
import { ancestorChain, childrenOf } from '../lib/pageTree';
import { blocksForPage } from '../lib/blocks';

/** The route screen for one page: resolves the page and its blocks from the snapshot and renders them. */
export function PageScreen() {
  const { pageId } = useParams({ from: '/w/$workspaceId/page/$pageId' });
  const { pages, blocks, mutations, blockMutations, selectPage } = useWorkspace();

  const page = pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    // Reachable by a stale deep link or a page deleted on another device.
    return (
      <main className="page">
        <section className="placeholder">
          <p className="placeholder__eyebrow">Not found</p>
          <p className="placeholder__lead">This page no longer exists.</p>
          <p className="placeholder__note">Pick another page from the sidebar.</p>
        </section>
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
      />
    </PageView>
  );
}
