import { useEffect, useRef } from 'react';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Menu } from 'lucide-react';
import { meQueryOptions, queryKeys, snapshotQueryOptions } from '../../api/queries';
import { flushStashedOps } from '../../sync/ops';
import { usePageMutations } from '../../hooks/usePageMutations';
import { useBlockMutations } from '../../hooks/useBlockMutations';
import { usePropertyMutations } from '../../hooks/usePropertyMutations';
import { useIsMobile } from '../../hooks/useIsMobile';
import { notify } from '../../lib/notify';
import { Sidebar } from '../../components/Sidebar/Sidebar';
import { SkipLink } from '../../components/SkipLink';
import { IconButton } from '../../components/ui/IconButton/IconButton';
import { WorkspaceContext } from '../../workspace/context';
import { descendantIds } from '../../lib/pageTree';
import { useUiStoreShallow } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import type { PageRecord } from '../../api/types';

/**
 * The app shell for one workspace: the sidebar plus whatever page the route names. It owns the
 * workspace-level reads and wires the sidebar's create, rename and delete to the op-based writes.
 *
 * On mobile (< md breakpoint) the sidebar is an off-canvas drawer driven by the UI store.
 * At md+ it becomes a persistent two-column grid layout.
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
  // Phase 3: properties and values. `?? []` keeps the shell rendering against a pre-Phase-3 server.
  const properties = snapshot.properties ?? [];
  const values = snapshot.values ?? [];

  const membership = me.memberships.find((entry) => entry.workspaceId === workspaceId);
  const mutations = usePageMutations(me.user.id, workspaceId, pages, notify);
  const blockMutations = useBlockMutations(me.user.id, workspaceId, blocks, notify);
  const propertyMutations = usePropertyMutations(me.user.id, workspaceId, properties, notify);

  // An edit flushed as the last page was closing may not have reached the server - a service worker
  // controls the page, and Chromium drops a request routed through it once its client is gone. It
  // was written down at unload, so it is sent here, on the first render after the reload, and the
  // snapshot is re-read if anything went. Replays are safe: the server recognises an opId it has
  // already applied.
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

  // Drawer state from the global UI store (two consumers: topbar toggle and Sidebar onClose).
  const { isSidebarOpen, openSidebar, closeSidebar } = useUiStoreShallow((s) => ({
    isSidebarOpen: s.isSidebarOpen,
    openSidebar: s.openSidebar,
    closeSidebar: s.closeSidebar,
  }));

  // At md+ the sidebar is a persistent grid column, always in the visual flow. On mobile it is
  // an off-canvas drawer that must be inert when closed so the hidden elements are not reachable
  // from the tab order. isMobile gates the inert prop so we do not accidentally inert the always-
  // visible desktop sidebar.
  const isMobile = useIsMobile();

  // Refs for mobile drawer focus management.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Focus the sidebar when the drawer opens so keyboard and screen-reader users land inside it.
  useEffect(() => {
    if (isSidebarOpen) {
      sidebarRef.current?.focus();
    }
  }, [isSidebarOpen]);

  // Escape closes the drawer and returns focus to the hamburger toggle.
  useEffect(() => {
    if (!isSidebarOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSidebar();
        // Focus the toggle after close so keyboard users have a clear return point.
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSidebarOpen, closeSidebar]);

  // Close the drawer and return focus to the toggle. Passed to Sidebar as onClose so any
  // page selection or explicit close also returns focus to a predictable landmark.
  const handleCloseSidebar = () => {
    closeSidebar();
    toggleRef.current?.focus();
  };

  const selectPage = (pageId: string) =>
    void navigate({ to: '/w/$workspaceId/page/$pageId', params: { workspaceId, pageId } });

  const createPage = async (parentId: string | null, kind?: 'page' | 'database') => {
    const pageId = await mutations.createPage(parentId, kind);
    // Null means the write failed and the user has been told; there is no page to open.
    if (pageId) selectPage(pageId);
  };

  // Creates a row page inside a database, then opens it.
  const createRow = async (databasePageId: string) => {
    const pageId = await mutations.createPage(databasePageId, 'row');
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

  // Sidebar needs a flat delete that also works for databases and rows.

  // Read the active theme once; tokens handle light/dark switching, so the Toaster's theme prop
  // is mainly for accessibility metadata rather than visual styling.
  const appTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

  return (
    <WorkspaceContext.Provider
      value={{
        userId: me.user.id,
        workspaceId,
        pages,
        blocks,
        properties,
        values,
        mutations,
        blockMutations,
        propertyMutations,
        selectPage,
        notify,
        createAndOpenPage: (parentId) => void createPage(parentId),
        createAndOpenDatabase: (parentId) => void createPage(parentId, 'database'),
        createAndOpenRow: (databasePageId) => void createRow(databasePageId),
      }}
    >
      {/*
        Mobile-first shell: column flex at narrow widths, a two-column grid at md+.
        min-h-dvh on mobile ensures the shell fills the viewport even when the page is short;
        md:min-h-0 releases that constraint inside the full-height grid.
      */}
      <div className="flex min-h-dvh flex-col md:grid md:h-full md:min-h-0 md:grid-cols-[292px_minmax(0,1fr)] md:grid-rows-[1fr]">
        {/* First in the tab order, so the page body is a couple of presses away rather than a
            hundred. The block gutter controls stay focusable, because the keyboard drag path runs
            through the drag handle. */}
        <SkipLink targetId="page-body">Skip to the page body</SkipLink>

        {/* Mobile-only topbar: visible below md, hidden at md+ where the persistent sidebar
            appears. Uses sticky so it stays visible as the user scrolls. */}
        <div className="sticky top-0 z-10 flex h-13 items-center gap-3 border-b border-border bg-panel px-3 md:hidden">
          <IconButton
            ref={toggleRef}
            icon={<Menu size={20} aria-hidden />}
            aria-label="Open navigation"
            aria-expanded={isSidebarOpen}
            onClick={openSidebar}
            className="text-panel-text hover:bg-panel-hover hover:text-panel-text"
          />
          <span className="min-w-0 flex-1 overflow-hidden text-sm font-bold text-ellipsis whitespace-nowrap text-panel-text">
            {membership?.name ?? 'Workspace'}
          </span>
        </div>

        {/* Sidebar wrapper. On mobile it is a fixed overlay (off-canvas drawer); at md+ it
            resets to a normal in-flow grid column. The scrim and slide animation are driven by
            isSidebarOpen via cn(). */}
        <div className="pointer-events-none fixed inset-0 z-40 md:pointer-events-auto md:static md:z-auto">
          {/* Scrim: semi-transparent backdrop behind the drawer on mobile. Hidden at md+ where the
              drawer is in-flow. Clicking it closes the drawer. */}
          <div
            className={cn(
              'pointer-events-none absolute inset-0 bg-black/55 transition-opacity duration-200 md:hidden',
              isSidebarOpen ? 'pointer-events-auto opacity-100' : 'opacity-0',
            )}
            aria-hidden="true"
            onClick={handleCloseSidebar}
          />
          {/* The drawer panel: slides in from the left on mobile, static at md+. The transition
              only applies on mobile; md:transition-none removes it so the grid layout is instant.
              inert is set when the drawer is closed on mobile so the off-canvas subtree is removed
              from the tab order and pointer events — deriving it from isSidebarOpen keeps the
              inert state in sync with the visual state. The isMobile gate prevents inert from
              being set at md+ where the sidebar is a permanently visible grid column. */}
          <div
            className={cn(
              'pointer-events-auto absolute top-0 bottom-0 left-0 flex w-[292px] max-w-[85vw] transition-transform duration-200 motion-reduce:transition-none md:static md:w-auto md:max-w-none md:translate-x-0 md:transition-none',
              isSidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            inert={(isMobile && !isSidebarOpen) || undefined}
          >
            <Sidebar
              workspaceName={membership?.name ?? 'Workspace'}
              role={membership?.role ?? 'member'}
              userName={me.user.name}
              userEmail={me.user.email}
              pages={pages}
              currentPageId={pageParams.pageId ?? null}
              onSelectPage={selectPage}
              onCreatePage={(parentId) => void createPage(parentId)}
              onCreateDatabase={(parentId) => void createPage(parentId, 'database')}
              onRenamePage={(page, title) => void mutations.updatePage(page, { title })}
              onDeletePage={(page) => void deletePage(page)}
              sidebarRef={sidebarRef}
              onClose={handleCloseSidebar}
            />
          </div>
        </div>

        {/* Page content area. tabIndex -1 makes it focusable as the skip-link target without
            adding a tab stop. inert disables all interactivity while the mobile drawer is open,
            matching the overlay pattern and preventing background interaction. */}
        <div
          className="flex-1 overflow-auto bg-canvas md:flex-none"
          id="page-body"
          data-testid="page-body"
          tabIndex={-1}
          inert={isSidebarOpen || undefined}
        >
          <Outlet />
        </div>
      </div>
      {/*
        Toaster is outside the shell grid so it can use a fixed position without being clipped.
        `toastOptions.unstyled` disables sonner's built-in CSS; classNames + project tokens
        handle the look in both themes without any `dark:` utilities.
        `toastOptions.duration` is overridden per toast in notify.ts to Infinity (stays until dismissed).
      */}
      <Toaster
        position="bottom-right"
        theme={appTheme}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex items-start gap-3.5 rounded-md bg-toast-warning-surface py-3.5 px-4 text-amber-soft shadow-pop w-[min(420px,calc(100vw-2.5rem))]',
            title: 'flex-1 min-w-0 [overflow-wrap:anywhere] text-sm font-[600] leading-[1.5]',
            closeButton:
              'flex-none rounded-sm border-0 bg-white/12 px-2.5 py-1 text-xs font-bold text-inherit cursor-pointer min-h-12 min-w-12 inline-flex items-center justify-center hover:bg-white/22',
          },
          closeButtonAriaLabel: 'Dismiss notice',
        }}
        closeButton
      />
    </WorkspaceContext.Provider>
  );
}
