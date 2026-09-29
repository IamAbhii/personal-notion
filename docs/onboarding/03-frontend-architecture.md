# 03 — Frontend architecture

`packages/frontend` — React 19 + TypeScript, built with Vite 6, shipped as an installable PWA that
the Worker serves as static assets from `dist/`.

Read [`.claude/skills/react-standards/`](../../.claude/skills/react-standards/) before writing any
component. That skill is the enforced standard; this page is the map.

## The layers, and the direction dependencies flow

```
main.tsx                    entry: QueryClient, RouterProvider, unload watcher
  └── router.tsx            code-based TanStack Router routes + loaders
        └── screens/        route-level components (WorkspaceShell, PageScreen, …)
              └── components/   feature components
                    └── components/ui/   presentational primitives (Button, Dialog, …)

  hooks/      mutation hooks + small reusable hooks   (call sync/ + api/)
  sync/       op builders and the submit path         (calls api/client)
  api/        HTTP client, query options, wire types  (the only place fetch happens)
  stores/     Zustand — client-only UI state
  workspace/  the React context that carries the loaded workspace
  lib/        pure helpers, no React, no side effects
```

The rules that keep this honest:

- **`api/client.ts` is the only place `fetch` is called** for reads and op writes. Credentials, the
  `/api` prefix, error shaping and the `keepalive` decision are made once. (`WorkspaceShell` calls
  `fetch('/api/auth/signout')` directly — the one deliberate exception, because it is a
  session-lifecycle call and not a data read or an op.)
- **`lib/` has no React and no side effects.** Ordering, fractional keys, filter evaluation, search,
  date formatting, error message construction — all pure, all directly unit-testable. When you find
  yourself putting logic in a component, check whether it belongs in `lib/` instead.
- **`ui/` primitives never know about the domain.** No workspace, no ops, no pages. They extend
  native elements and take props.
- **Nothing imports upward.** A `lib/` helper never imports a component; a component never imports
  a screen.

## Boot sequence

1. **`index.html`** runs an inline script _before first paint_ that reads
   `localStorage['personal-space:theme']` and sets `data-theme` on `<html>`. This is why there is no
   dark-mode flash. It is inline and not in React on purpose.
2. **`main.tsx`**
   - creates one `QueryClient` (`retry: 1`, `refetchOnWindowFocus: false`),
   - calls `watchForUnload()` **before React mounts**, so its `pagehide`/`visibilitychange`
     listeners are registered ahead of every editor's own unload flush (listener order for one
     event on one target is registration order — this is load-bearing, see
     [08](./08-writes-updates-and-sync.md)),
   - creates the router with the query client as router context,
   - renders `<StrictMode><QueryClientProvider><RouterProvider/>`.
3. **Route loaders** `ensureQueryData` for `/api/me` and then the workspace snapshot, so the shell
   never renders against an empty cache.
4. **`WorkspaceShell`** reads both with `useSuspenseQuery`, builds all four mutation hook bundles,
   and publishes everything through `WorkspaceContext`.

## Routing

Code-based routes in `src/router.tsx` — there is no `routeTree.gen.ts` file routing here.

| Route                          | Component        | Behaviour                                                      |
| ------------------------------ | ---------------- | -------------------------------------------------------------- |
| `/`                            | `NoWorkspace`    | Loader resolves `/api/me`, redirects to the first membership   |
| `/w/$workspaceId`              | `WorkspaceShell` | Loader ensures `me` + `snapshot`; renders sidebar + `Outlet`   |
| `/w/$workspaceId/`             | `WorkspaceHome`  | Redirects to the first top-level page, or shows an empty state |
| `/w/$workspaceId/page/$pageId` | `PageScreen`     | Renders page, database or row depending on `kind`              |

Two things to know:

- **URLs carry the workspace from day one** (`/w/:workspaceId/page/:pageId`). Retrofitting that
  later would break every bookmark and deep link. `/` exists only to redirect into a workspace.
- **`me.memberships[0]` is a current fact, not an invariant.** The loader picks the first element
  and the code says so in a comment. Never write logic that assumes exactly one membership — that
  is explicitly a defect under [13](./13-tenancy-and-multi-user.md).

Router config: `defaultPreload: 'intent'`, `defaultPendingComponent: AppLoading`. The root route's
`errorComponent` renders `AppError`, which special-cases a `401` into `SignInScreen` — that is how
an expired session becomes a sign-in screen rather than an error card.

## `PageScreen` dispatches on `kind`

A page, a database and a database row are all rows in `pages` with a different `kind`
([01](./01-project-overview.md)). `PageScreen` looks up the routed page in the snapshot and renders
`PageView` + `BlockEditor`, `DatabaseView`, or `RowPage` accordingly. Adding a new content kind is
a branch here plus a component, not a new route.

## Data flow in one direction

```
snapshot (TanStack Query cache)
  → WorkspaceContext value (pages, blocks, properties, values, views)
    → components read what they need and derive the rest with lib/ helpers
      → user action → hooks/use*Mutations → sync/*Ops builds an op
        → sync/ops submitOps → api/client apiPost → POST /sync
          → invalidateQueries(snapshot) → refetch → re-render
```

There is no optimistic local mutation of the cache today. A write is posted, awaited, and then the
snapshot is re-read. That is why an edit survives a refresh, and it is also why the write path is
the thing to understand first — see [08](./08-writes-updates-and-sync.md).

## Derived state, not stored state

The snapshot arrives as flat arrays (`pages`, `blocks`, `properties`, `values`, `views`). Components
derive what they render:

- `lib/pageTree.ts` — `childrenOf`, `descendantIds`, `sortKeyForNewChild`
- `lib/treeLayout.ts` — flattening the tree for the sidebar with collapse state
- `lib/blocks.ts` — block ordering, list numbering, props parsing, the slash-menu catalogue,
  text clamping on code-point boundaries
- `lib/viewData.ts` — legal operators per property type, filter evaluation, sorting, board grouping
- `lib/search.ts` — accent- and case-insensitive quick-find with prefix ranking
- `lib/ordering.ts` — fractional key generation for drag-and-drop

None of that is duplicated in state. If you catch yourself adding a `useState` that mirrors
something derivable from the snapshot, that is the smell.

## The PWA

Configured in `packages/frontend/vite.config.ts` via `VitePWA`:

- `registerType: 'autoUpdate'`, manifest with `display: 'standalone'`, a single scalable SVG icon
  (`// Future:` marker for rasterised PNGs).
- Workbox precaches the app shell: `**/*.{js,css,html,svg,woff2}`, `navigateFallback: '/index.html'`.
- **`navigateFallbackDenylist: [/^\/api\//]`** — load-bearing. Both legs of the OAuth round trip
  (`/api/auth/google` and `/api/auth/callback`) are top-level _document_ navigations to `/api/*`.
  Without this denylist, Workbox answers them from the precache and the Worker never sees the
  request, so sign-in silently breaks. Do not remove it.
- There is **no runtime cache for API responses** yet — a `// Future:` marker names it.

A consequence of being a service-worker app that bites the write path: **Chromium drops a request
routed through a service worker once its client is gone**, so no unload-time network write can be
relied on. That is the whole reason the `localStorage` op stash exists. See
[08](./08-writes-updates-and-sync.md).

## Mobile-first layout

The layout is built from 320px up, with `md` (768px) as the breakpoint where the sidebar stops
being an off-canvas drawer and becomes a persistent grid column.

- `hooks/useIsMobile.ts` subscribes to a `MediaQueryList` for the md breakpoint. It gates
  behaviour, not styling — styling is Tailwind `md:` variants.
- When the drawer is closed on mobile it is marked `inert` so its contents leave the tab order.
  `useIsMobile()` gates that, so the always-visible desktop sidebar is never inerted.
- Focus management in `WorkspaceShell`: opening the drawer focuses the sidebar; Escape closes it
  and returns focus to the hamburger — but **only if no `[role="dialog"]` is in the DOM**, so Radix
  dialogs get their own Escape. Radix portals dialogs to `<body>`, which is why the check is a DOM
  query rather than component state.
- Minimum touch target is 48x48px (`min-h-12` on `Button`).

## Accessibility is part of the definition of done

Real patterns in this codebase, not aspirations:

- `SkipLink` to the main content region
- `SlashMenu` is a listbox using `aria-activedescendant` — focus stays in the textarea because the
  user keeps typing to filter
- `lib/dragAnnouncements.ts` produces live-region announcements for dnd-kit drag operations
- `QuickFind` follows the ARIA modal pattern, restoring focus to the element that opened it
- Board keyboard navigation lives in `components/BoardView/boardKeyboard.ts`, separated from the
  component so it is unit-testable

## Where to start reading

| To understand…           | Read                                                            |
| ------------------------ | --------------------------------------------------------------- |
| App boot                 | `src/main.tsx`, `src/router.tsx`                                |
| The workspace contract   | `src/workspace/context.ts`                                      |
| The shell and its wiring | `src/screens/WorkspaceShell/WorkspaceShell.tsx`                 |
| The editor               | `src/components/BlockEditor.tsx`, `src/components/BlockRow.tsx` |
| Databases and views      | `src/components/DatabaseView/`, `src/lib/viewData.ts`           |
| The write path           | `src/sync/ops.ts`, `src/hooks/usePageMutations.ts`              |

## Next

- [04 — State management](./04-state-management.md)
- [05 — Component structure](./05-component-structure.md)
- [06 — Styling and theming](./06-styling-and-theming.md)
- [07 — The API](./07-api-contract.md)
