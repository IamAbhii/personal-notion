import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { meQueryOptions, snapshotQueryOptions } from '../api/queries';
import { usePageMutations } from '../hooks/usePageMutations';
import { useBlockMutations } from '../hooks/useBlockMutations';
import { useNotices } from '../hooks/useNotices';
import { Sidebar } from '../components/Sidebar';
import { NoticeStack } from '../components/NoticeStack';
import { WorkspaceContext } from '../workspace/context';
import { descendantIds } from '../lib/pageTree';
import type { PageRecord } from '../api/types';

/**
 * The app shell for one workspace: the sidebar plus whatever page the route names. It owns the
 * workspace-level reads and wires the sidebar's create, rename and delete to the op-based writes.
 */
export function WorkspaceShell() {
  const { workspaceId } = useParams({ from: '/w/$workspaceId' });
  const pageParams = useParams({ strict: false }) as { pageId?: string };
  const navigate = useNavigate();

  const me = useSuspenseQuery(meQueryOptions()).data;
  const snapshot = useSuspenseQuery(snapshotQueryOptions(me.user.id, workspaceId)).data;
  const pages = snapshot.pages;
  // Blocks arrive in the same snapshot; `?? []` keeps the shell rendering against a server that
  // predates the blocks key rather than crashing on it.
  const blocks = snapshot.blocks ?? [];

  const membership = me.memberships.find((entry) => entry.workspaceId === workspaceId);
  const { notices, notify, dismiss } = useNotices();
  const mutations = usePageMutations(me.user.id, workspaceId, pages, notify);
  const blockMutations = useBlockMutations(me.user.id, workspaceId, blocks, notify);

  const selectPage = (pageId: string) =>
    void navigate({ to: '/w/$workspaceId/page/$pageId', params: { workspaceId, pageId } });

  const createPage = async (parentId: string | null) => {
    const pageId = await mutations.createPage(parentId);
    // Null means the write failed and the user has been told; there is no page to open.
    if (pageId) selectPage(pageId);
  };

  const deletePage = async (page: PageRecord) => {
    // If the open page is the one being deleted, or is nested inside it, the route would point at
    // nothing after the write, so leave for the workspace root first.
    const affected = new Set([page.id, ...descendantIds(pages, page.id)]);
    if (pageParams.pageId && affected.has(pageParams.pageId)) {
      await navigate({ to: '/w/$workspaceId', params: { workspaceId } });
    }
    await mutations.deletePage(page);
  };

  return (
    <WorkspaceContext.Provider
      value={{
        userId: me.user.id,
        workspaceId,
        pages,
        blocks,
        mutations,
        blockMutations,
        selectPage,
        createAndOpenPage: (parentId) => void createPage(parentId),
      }}
    >
      <div className="shell">
        <Sidebar
          workspaceName={membership?.name ?? 'Workspace'}
          role={membership?.role ?? 'member'}
          userName={me.user.name}
          userEmail={me.user.email}
          pages={pages}
          currentPageId={pageParams.pageId ?? null}
          onSelectPage={selectPage}
          onCreatePage={(parentId) => void createPage(parentId)}
          onRenamePage={(page, title) => void mutations.updatePage(page, { title })}
          onDeletePage={(page) => void deletePage(page)}
        />
        <div className="shell__content">
          <Outlet />
        </div>
        <NoticeStack notices={notices} onDismiss={dismiss} />
      </div>
    </WorkspaceContext.Provider>
  );
}
