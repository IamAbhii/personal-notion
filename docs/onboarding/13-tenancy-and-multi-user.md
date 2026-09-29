# 13 — Tenancy and multi-user

Decision record: [`docs/architecture/tenancy.md`](../architecture/tenancy.md).

The product ships **single-user, single-workspace**. These seams exist so that stays a choice rather
than a ceiling. They cost little now and are expensive to retrofit later.

You need this page even though the app has one user, because **several rules that look like
pointless ceremony are load-bearing**, and breaking one of them is treated as a defect rather than a
simplification.

## The seams

### 1. Three tables that exist for one row each

| Table               | Rows today | Why it exists now                                                        |
| ------------------- | ---------- | ------------------------------------------------------------------------ |
| `users`             | one        | Created on first sign-in. `google_sub` is the stable identity, not email |
| `workspaces`        | one        | Created by `GET /api/me` on first request                                |
| `workspace_members` | one        | So inviting people later is an **insert**, not a schema change           |

### 2. Every content row carries `workspace_id`

`NOT NULL`, indexed, foreign-keyed — pages, blocks, properties, values, views, `applied_ops`,
everything.

> This is the single most important seam: adding a tenancy column to a populated table later means a
> migration, a backfill and an audit of every query. Do it now, while it is free.

### 3. No route builds a query without a context object

All data access goes through the repository layer, whose functions take
`ctx: { userId, workspaceId, role }` derived from the session, and **every read and write filters on
`ctx.workspaceId`**. There is no code path that can reach another workspace's data even by accident.

Multi-workspace later = resolve `workspaceId` from the route instead of from "the one workspace",
plus a picker in the UI.

### 4. Ids are UUIDs, not autoincrement integers

Required anyway for the offline queue (the client mints ids before the server sees them), and they
mean nothing collides if workspaces are ever merged, exported or moved between servers.

### 5. The API is workspace-scoped from day one

Not "flat now, scoped later" — a route reshape is exactly the breaking change this design exists to
avoid. Every data route lives under `/api/workspaces/:workspaceId/...` and `:workspaceId` is
validated against the session's memberships on every request. Today there is one workspace and one
membership, so the segment is effectively constant, but **no route shape, client call or test
changes when there are many.**

### 6. App URLs carry the workspace too

`/w/:workspaceId/page/:pageId`. `/` redirects to the user's workspace, so the address bar is the
only place you notice. Retrofitting this later would break every bookmark and every deep link.

### 7. Local client state is namespaced by user and workspace

TanStack Query keys are `['snapshot', userId, workspaceId]`. One browser profile must be able to
hold two accounts' cached data later without collisions or leakage; a flat local store would have to
be rebuilt to allow it. The same rule will apply to the Phase 6 IndexedDB store, where sign-out
clears the `(userId, workspaceId)` namespace.

### 8. `memberships` is an array

`GET /api/me` returns `memberships: [...]` with one element today. The client picks its workspace
from the list; it never assumes a singleton, never hardcodes an id, and **never has a "the
workspace" global**. `WorkspaceContext` carries `workspaceId` explicitly for exactly this reason.

### 9. Roles come from data, not from code

`resolveAccess` returns the role from the membership row. `capabilities.ts` already has `editor` and
`viewer` entries. Adding a role is a different string in `workspace_members`, not a new enforcement
layer.

## What going multi-account actually costs

This list is the **acceptance test for the design**. If a change would add to it, that change is
wrong:

1. Drop the `ALLOWED_EMAIL` comparison in `resolveAccess`, and let membership in
   `workspace_members` alone decide access.
2. Create a user, workspace and membership row on first sign-in instead of at seed time — which
   `routes/me.ts` **already does**.
3. Add a workspace switcher to the sidebar.

And that is all. **No table gains or loses a column, no endpoint changes shape, no client call is
rewritten, no data is backfilled.**

## Things that are defects now, not future problems

Taken directly from the decision record. Any of these in a diff should be sent back:

- **A query without `workspace_id` in its `WHERE`.**
- **A client that reads `memberships[0]` as an invariant** rather than as a current fact.
- **A seed script that assumes exactly one user.**
- A route that takes a bare workspace id instead of a `ctx`.
- A new data route that is not nested under `/api/workspaces/:workspaceId/`.
- A "the current workspace" module-level singleton on the client.
- A local storage or query key that is not namespaced by user and workspace.

## Where the code says so

| Seam                             | Read                                                               |
| -------------------------------- | ------------------------------------------------------------------ |
| The `ctx` type and `contextFor`  | `packages/worker/src/repo/context.ts`                              |
| The access decision              | `packages/worker/src/auth/resolveAccess.ts`                        |
| The membership check per request | `requireWorkspace` in `packages/worker/src/auth/middleware.ts`     |
| Workspace + membership creation  | `createWorkspaceForUser` in `packages/worker/src/repo/accounts.ts` |
| The seed as a reusable template  | `packages/worker/src/seed/seedWorkspace.ts`                        |
| Namespaced query keys            | `packages/frontend/src/api/queries.ts`                             |
| The explicit workspace id        | `packages/frontend/src/workspace/context.ts`                       |

Each of these carries a `// Future:` comment naming the change that would be made. Use the
TypeScript language server's find-references on `Ctx` and `resolveAccess` rather than grep — those
are the seams where a rename must reach every caller.

## Next

- [11 — Auth and authorization](./11-auth-and-authorization.md)
- [10 — Data layer and database](./10-data-layer-and-database.md)
