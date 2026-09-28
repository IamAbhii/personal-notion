import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { Menu, Search } from 'lucide-react';
import { meQueryOptions, queryKeys, snapshotQueryOptions } from '../../api/queries';
import { flushStashedOps } from '../../sync/ops';
import { usePageMutations } from '../../hooks/usePageMutations';
import { useBlockMutations } from '../../hooks/useBlockMutations';
import { usePropertyMutations } from '../../hooks/usePropertyMutations';
import { useViewMutations } from '../../hooks/useViewMutations';
import { useIsMobile } from '../../hooks/useIsMobile';
import { notify } from '../../lib/notify';
import { QuickFind } from '../../components/QuickFind/QuickFind';
import { Sidebar } from '../../components/Sidebar/Sidebar';
import { SkipLink } from '../../components/SkipLink';
import { IconButton } from '../../components/ui/IconButton/IconButton';
import { WorkspaceContext } from '../../workspace/context';
import { descendantIds } from '../../lib/pageTree';
import { useUiStoreShallow } from '../../stores/uiStore';
import { useThemeStore } from '../../stores/themeStore';
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
  // Phase 4: views. `?? []` keeps the shell rendering against a pre-Phase-4 server.
  const views = snapshot.views ?? [];

  const membership = me.memberships.find((entry) => entry.workspaceId === workspaceId);
  const mutations = usePageMutations(me.user.id, workspaceId, pages, notify);
  const blockMutations = useBlockMutations(me.user.id, workspaceId, blocks, notify);
  const propertyMutations = usePropertyMutations(me.user.id, workspaceId, properties, notify);
  const viewMutations = useViewMutations(me.user.id, workspaceId, views, notify);

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

  // Quick-find dialog state. lastFocusRef holds the element that was active when the dialog
  // opened so we can restore focus when it closes, per the ARIA modal pattern.
  const [isQuickFindOpen, setIsQuickFindOpen] = useState(false);
  const lastFocusRef = useRef<Element | null>(null);

  // Opens the dialog and remembers which element had focus so we can restore it on close.
  const openQuickFind = useCallback(() => {
    lastFocusRef.current = document.activeElement;
    setIsQuickFindOpen(true);
  }, []);

  // Closes the dialog and returns focus to the element that triggered it.
  const closeQuickFind = useCallback(() => {
    setIsQuickFindOpen(false);
    if (lastFocusRef.current instanceof HTMLElement) {
      lastFocusRef.current.focus();
    }
  }, []);

  // Cmd+K / Ctrl+K anywhere in the shell opens the quick-find dialog.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openQuickFind();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [openQuickFind]);

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
    if (!pageId) return;
    if (kind === 'database') {
      // A new database always gets three default views (table, board, list) immediately after
      // the page.create completes, so the view switcher is available on first render. Seeded
      // databases have their views created server-side; this path is UI-creation only.
      await viewMutations.createDefaultViews(pageId);
    }
    selectPage(pageId);
  };

  // Creates a row page inside a database, then opens it.
  const createRow = async (databasePageId: string) => {
    const pageId = await mutations.createPage(databasePageId, 'row');
    if (pageId) selectPage(pageId);
  };

  // Creates a row page without navigating, returning its id so the table can rename it in place
  // (ADV-044). Returns null when the write fails (the user has already been told).
  const createRowInPlace = (databasePageId: string) => mutations.createPage(databasePageId, 'row');

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

  // Read the active theme from the store so the Toaster's theme prop updates reactively when the
  // user toggles, rather than snapping a one-time DOM read at mount.
  const appTheme = useThemeStore((s) => s.theme);

  // When viewing a row page, the sidebar should highlight the parent database as current so the
  // user always knows which database they are in (ADV-054). Row pages are not in the sidebar tree,
  // so without this the current-page highlight disappears on the database page entirely.
  const currentPage = pages.find((p) => p.id === pageParams.pageId);
  const sidebarCurrentPageId =
    currentPage?.kind === 'row' ? (currentPage.parentId ?? null) : (pageParams.pageId ?? null);

  return (
    <WorkspaceContext.Provider
      value={{
        userId: me.user.id,
        workspaceId,
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
        createAndOpenPage: (parentId) => void createPage(parentId),
        createAndOpenDatabase: (parentId) => void createPage(parentId, 'database'),
        createAndOpenRow: (databasePageId) => void createRow(databasePageId),
        createRowInPlace,
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
          {/* Search icon in the topbar: always visible on mobile so the user can reach quick-find
              without opening the sidebar drawer first. */}
          <IconButton
            icon={<Search size={20} aria-hidden />}
            aria-label="Search"
            onClick={openQuickFind}
            className="text-panel-text hover:bg-panel-hover hover:text-panel-text"
          />
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
              // Mobile: absolute top-0/bottom-0 gives it the height of the fixed inset-0 wrapper.
              // md+: static, so it no longer has absolute sizing — h-full is needed so the flex
              // column propagates to the aside, which pins the footer inside the sidebar.
              'pointer-events-auto absolute top-0 bottom-0 left-0 flex w-[292px] max-w-[85vw] transition-transform duration-200 motion-reduce:transition-none md:static md:h-full md:w-auto md:max-w-none md:translate-x-0 md:transition-none',
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
              properties={properties}
              currentPageId={sidebarCurrentPageId}
              onSelectPage={selectPage}
              onCreatePage={(parentId) => void createPage(parentId)}
              onCreateDatabase={(parentId) => void createPage(parentId, 'database')}
              onRenamePage={(page, title) => void mutations.updatePage(page, { title })}
              onDeletePage={(page) => void deletePage(page)}
              sidebarRef={sidebarRef}
              onClose={handleCloseSidebar}
              onOpenSearch={openQuickFind}
            />
          </div>
        </div>

        {/* Page content area. tabIndex -1 makes it focusable as the skip-link target without
            adding a tab stop. inert disables all interactivity while the mobile drawer is open,
            matching the overlay pattern and preventing background interaction. */}
        <div
          className="min-w-0 flex-1 overflow-auto bg-canvas md:flex-none"
          id="page-body"
          data-testid="page-body"
          tabIndex={-1}
          inert={isSidebarOpen || undefined}
        >
          <Outlet />
        </div>
      </div>
      {/* Quick-find dialog: rendered when open, dismissed on Escape, backdrop click, or item pick.
          Placed outside the shell grid so its fixed-position overlay is not clipped. */}
      {isQuickFindOpen ? (
        <QuickFind
          pages={pages}
          onClose={closeQuickFind}
          onSelect={(pageId) => {
            // DEF-093: if the page was deleted in another tab since the snapshot loaded, skip the
            // navigation and inform the user rather than landing on a phantom page.
            const pageExists = pages.some((p) => p.id === pageId);
            if (!pageExists) {
              notify('This page no longer exists. It may have been deleted in another tab.');
              return;
            }
            selectPage(pageId);
            // DEF-094: close the mobile drawer after a quick-find navigation, matching the
            // behaviour of picking a page directly from the sidebar tree.
            closeSidebar();
          }}
        />
      ) : null}

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
