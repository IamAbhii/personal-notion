# 04 — State management

There are four kinds of state in this app, and each has exactly one home. Putting a piece of state
in the wrong one is the most common way to create a bug here, so the boundaries are worth learning
before you write anything.

| Kind                             | Home                               | Example                                       |
| -------------------------------- | ---------------------------------- | --------------------------------------------- |
| Server truth                     | TanStack Query                     | pages, blocks, properties, values, views      |
| Workspace-wide derived + actions | React context (`WorkspaceContext`) | the snapshot arrays, the mutation bundles     |
| Client-only UI state             | Zustand (`stores/`)                | drawer open, collapsed tree rows, active view |
| Ephemeral component state        | `useState` in the component        | the text being typed, which cell is editing   |

## 1. Server state — TanStack Query

`src/api/queries.ts` is the whole surface. There are exactly **two** queries in the app.

```ts
export const queryKeys = {
  me: () => ['me'] as const,
  snapshot: (userId: string, workspaceId: string) => ['snapshot', userId, workspaceId] as const,
};
```

### `meQueryOptions()`

`GET /api/me`, `staleTime: 5 * 60 * 1000`. Returns the user and their memberships. Everything else
keys off this.

### `snapshotQueryOptions(userId, workspaceId)`

`GET /api/workspaces/:id/snapshot`, `refetchInterval: 30_000`. The **entire workspace in one
object**. This is the only data read the app makes.

Two details that are easy to miss and both deliberate:

- **The query key is namespaced by `userId` _and_ `workspaceId`.** One browser profile must be able
  to hold two accounts' cached data without collisions. The user id is in the key from day one even
  though there is one user today. Do not "simplify" it out.
- **`refetchInterval: 30_000`** is the answer to "how does this tab learn about a change made in
  another tab". TanStack Query's default `refetchOnWindowFocus` covers switching back to the tab;
  the interval covers the same tab with no interaction. See
  [08](./08-writes-updates-and-sync.md) for the full picture on update propagation.

The `QueryClient` itself is created in `main.tsx` with `retry: 1` and
`refetchOnWindowFocus: false` at the default level — note the snapshot query's own
`refetchInterval` is what does the polling, and window-focus refetching for the snapshot is
described in the code comment as the covered case. If you change either, check
`src/api/queries.test.ts`.

> **Future:** this client is where the IndexedDB persister will be wired
> (`// Future:` marker in `main.tsx`), making a cold start with no network render the last known
> workspace. Not built — see [01](./01-project-overview.md).

### Why one big query instead of many small ones

Because the app must work offline and search client-side, it needs the whole workspace locally
anyway. One read means one cache entry to invalidate, one ETag to compare, and no waterfall of
dependent fetches. The cost is paid back by `computeSnapshotEtag`: an unchanged workspace answers
`304` from cheap SQL aggregates without building the payload at all
([10](./10-data-layer-and-database.md)).

### Invalidation is the update mechanism

Every mutation hook ends with:

```ts
queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(userId, workspaceId) });
```

There is no optimistic cache patching today. The write is posted, awaited, then server truth is
re-read. That is why edits survive a refresh, and why a rejected write leaves the UI consistent
rather than silently diverged.

## 2. Workspace context — the distribution layer

`src/workspace/context.ts` defines `WorkspaceContextValue`, provided by `WorkspaceShell` and read
via `useWorkspace()` (which throws outside the shell — a programming error, not a runtime state).

It carries:

- **the snapshot arrays** — `pages`, `blocks`, `properties`, `values`, `views`
- **`userId` and `workspaceId`** explicitly. There is deliberately **no "the workspace" global.**
- **four mutation bundles** — `mutations` (pages), `blockMutations`, `propertyMutations`,
  `viewMutations`
- **navigation and notification** — `selectPage`, `notify`
- **composite actions** — `createAndOpenPage`, `createAndOpenDatabase`, `createAndOpenRow`,
  `createRowInPlace`

The composite actions exist so that "create and then navigate to it" is written once rather than in
every call site. `createRowInPlace` is the variant that returns the new row id without navigating,
so the table can switch its title cell into inline rename mode.

Note the defensive `?? []` in `WorkspaceShell` for `blocks`, `properties`, `values` and `views`:
they keep the shell rendering against a server that predates each key, which is what makes a
frontend deploy safe ahead of a Worker deploy.

## 3. UI state — Zustand

Two stores, and they are separate for a concrete reason.

### `stores/uiStore.ts`

```ts
isSidebarOpen; // off-canvas drawer, only meaningful below md
collapsedPageIds; // ReadonlySet<string> of explicitly collapsed sidebar rows
activeViewKindByDb; // Record<databasePageId, ViewKind>
```

- Created with the curried `create<UiState>()(...)` form — **required** for correct inference in
  Zustand v5.
- `togglePageCollapsed` **replaces** the Set rather than mutating it, so React sees a referential
  change. Immutability is not optional here.
- Wrapped in `persist` with `partialize` so that **only `activeViewKindByDb` is persisted**. The
  drawer state and collapsed rows are session-only by design and reset on each visit.
- `useUiStoreShallow(selector)` wraps `useShallow`. **Use it whenever you read two or more values**
  from the store in one component, or you get spurious re-renders:

  ```ts
  const { isSidebarOpen, openSidebar, closeSidebar } = useUiStoreShallow((s) => ({
    isSidebarOpen: s.isSidebarOpen,
    openSidebar: s.openSidebar,
    closeSidebar: s.closeSidebar,
  }));
  ```

### `stores/themeStore.ts`

Theme is **per device, not per account** — it lives in `localStorage`, works offline, applies
before first paint, and deliberately does not follow you between devices.

It is a separate store from `uiStore` because of the persistence format. The inline script in
`index.html` reads the raw key directly:

```js
localStorage.getItem('personal-space:theme') === 'dark';
```

Zustand's `persist` middleware would wrap that in `{"state":{...},"version":0}` and break the
pre-paint script. So `themeStore` writes the raw string itself in `applyTheme()`, which also:

- sets `document.documentElement.dataset.theme`
- updates the `<meta name="theme-color">` tag so the mobile status bar matches the panel colour
- swallows `localStorage` failures (private browsing, embedded iframes) rather than throwing

It also installs a `storage` event listener so **a theme change in another tab applies here**
(DEF-101). That is the pattern to copy if you ever add another cross-tab device preference.

## 4. Component state

Everything transient: the text currently being typed, which cell is in edit mode, whether a popover
is open, the quick-find query.

The one pattern worth knowing is **`hooks/useAutosavedText.ts`**. There is no save button anywhere
in this app, so a settled edit is written once after `delayMs` rather than once per keystroke, and
any pending write is flushed on **blur and on unmount** — which is what makes navigating away
mid-sentence safe. It returns the debounced editing state plus the two ways to leave it.

Its interaction with page unload is the subtlest thing in the frontend and is documented in
[08](./08-writes-updates-and-sync.md).

## Mutation hooks

`src/hooks/use*Mutations.ts` — one per entity family: `usePageMutations`, `useBlockMutations`,
`usePropertyMutations`, `useViewMutations`. All four follow the same contract, and
`usePageMutations` is the one to read first.

```ts
export interface PageMutations {
  createPage: (parentId: string | null, kind?: PageKind) => Promise<string | null>;
  updatePage: (page: PageRecord, changes: PageUpdatePayload) => Promise<void>;
  deletePage: (page: PageRecord) => Promise<void>;
  isMutating: boolean;
}
```

The rules these hooks establish, which any new mutation hook must follow:

1. **No call here rejects.** A failed write is reported to the user through `notify` and the
   snapshot is re-read, so local state is reconciled with the server instead of diverging silently
   — and a `void`-ed call in a click handler can never become an unhandled rejection.
2. **Ids are minted client-side** (`crypto.randomUUID()`), so the caller can navigate to the new
   page before the server replies, and sync never has to remap ids.
3. **One op per call**, built by a named builder in `sync/*Ops.ts` — never an op literal by hand.
4. **`invalidate()` on success**, always the snapshot key.
5. **`baseVersion` comes from the record being edited** (`page.version`), or `0` for a create.

### The reserved-sort-key detail

`usePageMutations` keeps a `useRef<Map<string, Set<string>>>` of sort keys minted for creates that
are still in flight. `pages` is the last snapshot the render saw, so without this, two clicks in
the same render both compute the key after the same sibling and collide. The reservation is held
until the refetched snapshot carries the key. If you add another "create with an appended
position" mutation, you need the same guard.

## Decision table: where does my new state go?

| If it…                                                    | Put it in                                          |
| --------------------------------------------------------- | -------------------------------------------------- |
| comes from the server and must survive a refresh          | the snapshot (add it to the API)                   |
| is derivable from the snapshot                            | nowhere — derive it in `lib/`                      |
| is a UI preference that should survive a reload           | `uiStore` with `partialize`                        |
| is a UI preference read before first paint                | its own store, raw localStorage (see `themeStore`) |
| is session-only UI state shared by two or more components | `uiStore`, not persisted                           |
| is session-only and used by exactly one component subtree | `useState` / `useReducer`                          |
| is an action several unrelated components need            | `WorkspaceContext`                                 |

## Next

- [05 — Component structure](./05-component-structure.md)
- [08 — Writes, updates and sync](./08-writes-updates-and-sync.md)
