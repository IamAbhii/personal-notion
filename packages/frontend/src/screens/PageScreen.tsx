import { useParams } from '@tanstack/react-router';
import { PageView } from '../components/PageView';
import { useWorkspace } from '../workspace/context';
import { ancestorChain, childrenOf } from '../lib/pageTree';

/** The route screen for one page: resolves the page from the workspace snapshot and renders it. */
export function PageScreen() {
  const { pageId } = useParams({ from: '/w/$workspaceId/page/$pageId' });
  const { pages, mutations, selectPage } = useWorkspace();

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
    />
  );
}
