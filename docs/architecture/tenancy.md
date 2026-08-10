# Tenancy seams (fixed)

The product ships single-user, single-workspace. These seams exist so that stays a choice rather than
a ceiling. They cost little now and are expensive to retrofit later.

- **`users` table** — `id`, `google_sub`, `email`, `name`, `created_at`. One row, created on first
  sign-in. `google_sub` is the stable identity, not the email (people change emails).
- **`workspaces` table** — `id`, `name`, `created_at`. One row, created by the seed.
- **`workspace_members` table** — `workspace_id`, `user_id`, `role`. One row: the owner. This table
  exists now precisely so that inviting people later is an insert, not a schema change.
- **Every content row carries `workspace_id`**, `NOT NULL`, indexed, with a foreign key — pages,
  blocks, databases, properties, rows, views, everything. This is the single most important seam:
  adding a tenancy column to a populated table later means a migration, a backfill and an audit of
  every query. Do it now, while it is free.
- **No route builds a query without a context object.** All data access goes through a repository
  layer whose functions take `ctx: { userId, workspaceId, role }` derived from the session, and every
  read and write filters on `ctx.workspaceId`. There is no code path that can reach another
  workspace's data even by accident. Multi-workspace later = resolve `workspaceId` from the route
  instead of from "the one workspace", plus a picker in the UI.
- **Ids are UUIDs, not autoincrement integers.** Globally unique ids are required anyway for the
  offline queue (the client mints ids before the server sees them), and they mean nothing collides if
  workspaces are ever merged, exported or moved between servers.
- **The API is workspace-scoped from day one.** Not "flat now, scoped later" — a route reshape is
  exactly the kind of breaking change this section exists to avoid. Every data route lives under
  `/api/workspaces/:workspaceId/...`, and `:workspaceId` is validated against the session's
  memberships on every request. Today there is one workspace and one membership, so the segment is
  effectively constant, but no route shape, client call or test changes when there are many. See
  "API contract" below.
- **App URLs carry the workspace too:** `/w/:workspaceId/page/:pageId`. `/` redirects to the user's
  workspace, so the address bar is the only place you notice. Retrofitting this later would break
  every bookmark and every deep link.

## API contract (fixed)

The contract is written now as if there were many users with many workspaces, and then used with one
of each. This is the whole point: going multi-account must add rows and screens, not change endpoints.

- `GET /api/me` — the signed-in user plus their workspace memberships:
  `{ user: { id, email, name }, memberships: [{ workspaceId, name, role }] }`. It returns an **array**
  today with one element. The client picks the workspace from this list; it never assumes a singleton,
  never hardcodes an id, and never has a "the workspace" global.
- `GET /api/workspaces/:workspaceId/snapshot` — the whole workspace in one response: the page tree,
  every block, databases, properties, rows, values and view settings, each with its `version`. This is
  what the client stores locally to work offline, and it is the only read the app needs on cold start.
  Because Workers allows **10 ms CPU per invocation on free**, this is the likeliest handler to hit that
  ceiling: it must stream or paginate rather than build one large object in memory, and it takes an
  `If-None-Match`/`ETag` so an unchanged workspace costs almost nothing.
- `GET|POST|PATCH|DELETE /api/workspaces/:workspaceId/pages/...`, `.../databases/...`, `.../views/...` —
  every data route nested under the workspace. No unscoped data route exists. There is **no search
  endpoint**: search is client-side over the local copy.
- `POST /api/workspaces/:workspaceId/sync` — the offline op batch, scoped like everything else. Ops
  carry `workspace_id` and the server rejects any op whose workspace does not match the path.
- **Authorisation on every request:** `:workspaceId` must appear in the session's memberships, else
  `404` (not `403` — do not leak which workspace ids exist). This check is real today with one
  membership, so it is not new code later.
- **What "going multi-account" then costs**, and this list is the acceptance test for the design:
  drop the single-address check in `resolveAccess`; create a user, workspace and membership row on
  first sign-in instead of at seed time; add a workspace switcher to the sidebar. No table gains or
  loses a column, no endpoint changes shape, no client call is rewritten, no data is backfilled.
- **Anything that would break that list is a defect now**, not a future problem — for example a query
  without `workspace_id` in its `WHERE`, a client that reads `memberships[0]` as an invariant rather
  than a current fact, or a seed script that assumes exactly one user.
