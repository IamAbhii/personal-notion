import { useEffect } from 'react';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { meQueryOptions, queryKeys, snapshotQueryOptions } from '../api/queries';
import { flushStashedOps } from '../sync/ops';
import { usePageMutations } from '../hooks/usePageMutations';
import { useBlockMutations } from '../hooks/useBlockMutations';
import { useNotices } from '../hooks/useNotices';
import { Sidebar } from '../components/Sidebar';
import { NoticeStack } from '../components/NoticeStack';
import { SkipLink } from '../components/SkipLink';
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

  // An edit flushed as the last page was closing may not have reached the server - a service worker
  // controls the page, and Chromium drops a request routed through it once its client is gone. It was
  // written down at unload, so it is sent here, on the first render after the reload, and the snapshot
  // is re-read if anything went. Replays are safe: the server recognises an opId it has already
  // applied.
  const queryClient = useQueryClient();
  useEffect(() => {
    void flushStashedOps(workspaceId)
      .then((sent) => {
        if (sent > 0) {
          return queryClient.invalidateQueries({
            queryKey: queryKeys.snapshot(me.user.id, workspaceId),
          });
        }
      })
      .catch(() => {
        // A refused replay is dropped rather than retried for ever; the snapshot stays server truth.
      });
  }, [queryClient, workspaceId, me.user.id]);

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
        notify,
        createAndOpenPage: (parentId) => void createPage(parentId),
      }}
    >
      <div className="shell">
        {/* First in the tab order, so the page body is a couple of presses away rather than a
            hundred. The block gutter controls stay focusable, because the keyboard drag path runs
            through the drag handle. */}
        <SkipLink targetId="page-body">Skip to the page body</SkipLink>
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
        {/* tabIndex -1 makes the region focusable as a skip target without adding a tab stop. */}
        <div className="shell__content" id="page-body" tabIndex={-1}>
          <Outlet />
        </div>
        <NoticeStack notices={notices} onDismiss={dismiss} />
      </div>
    </WorkspaceContext.Provider>
  );
}
