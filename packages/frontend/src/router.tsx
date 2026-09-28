import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { meQueryOptions, snapshotQueryOptions } from './api/queries';
import { WorkspaceShell } from './screens/WorkspaceShell/WorkspaceShell';
import { PageScreen } from './screens/PageScreen';
import { WorkspaceHome } from './screens/WorkspaceHome';
import { AppError, AppLoading, NoWorkspace } from './screens/StatusScreens';
import { childrenOf } from './lib/pageTree';

// Code-based routes. URLs carry the workspace from day one - /w/$workspaceId/page/$pageId - so no
// bookmark or deep link changes when one account can hold several workspaces.

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Outlet,
  pendingComponent: AppLoading,
  errorComponent: ({ error }) => <AppError error={error} />,
});

/** `/` resolves the user's workspace from /api/me and redirects into it. */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  loader: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    // memberships is an array and may be empty; picking the first is a current fact, not a rule.
    const first = me.memberships[0];
    if (!first) return;
    throw redirect({
      to: '/w/$workspaceId',
      params: { workspaceId: first.workspaceId },
      replace: true,
    });
  },
  component: NoWorkspace,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/w/$workspaceId',
  loader: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    await context.queryClient.ensureQueryData(snapshotQueryOptions(me.user.id, params.workspaceId));
  },
  component: WorkspaceShell,
});

/** The workspace root opens the first top-level page, or the empty state if there is none. */
const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  loader: async ({ context, params }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    const snapshot = await context.queryClient.ensureQueryData(
      snapshotQueryOptions(me.user.id, params.workspaceId),
    );
    const firstTopLevel = childrenOf(snapshot.pages, null)[0];
    if (!firstTopLevel) return;
    throw redirect({
      to: '/w/$workspaceId/page/$pageId',
      params: { workspaceId: params.workspaceId, pageId: firstTopLevel.id },
      replace: true,
    });
  },
  component: WorkspaceHome,
});

const pageRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: 'page/$pageId',
  component: PageScreen,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workspaceRoute.addChildren([workspaceIndexRoute, pageRoute]),
]);

/** Builds the app router. The query client is the router context so loaders can prefetch reads. */
export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPendingComponent: AppLoading,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
