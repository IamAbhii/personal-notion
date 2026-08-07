# Personal Space — Architecture Decisions

REQUIREMENTS.md is the product contract and leaves most stack choices to the build. This file
records the choices that are now **fixed** for this project. Where REQUIREMENTS.md and this file
overlap, REQUIREMENTS.md still wins on *what* the product does; this file decides *how* it is built.

## Stack (fixed)

- **Frontend:** React + TypeScript, built with Vite, using the **TanStack** stack:
  - TanStack Router for navigation, TanStack Query for server state, TanStack Table for the
    database table view, and TanStack Form where a form is warranted. Use TanStack pieces where
    they fit; do not force them where a plain component is simpler.
- **Progressive Web App:** the frontend is an installable PWA — a web app manifest, icons, and a
  service worker (via `vite-plugin-pwa` or equivalent) so it installs and launches from a phone or
  desktop home screen. It works offline for both reading and **editing**, with a durable local write
  queue that syncs when the network returns — see "Offline and sync" below. HTTPS is required for the
  service worker, so every deployment serves over HTTPS.
- **Backend:** **TypeScript on Cloudflare Workers**, with **Hono** as the router (small, Workers-native,
  well supported). The same Worker serves the API and the built PWA static assets via the Workers
  static-assets binding, so the whole app is one origin. There is no Node server, no process to
  supervise and no OS to patch.
- **Storage:** **Cloudflare D1** — SQLite, managed. Access it through **Drizzle ORM** over the D1
  binding. D1's constraints are real and shape the design; they are listed in "D1 constraints" below.
- **Authentication:** **Google Sign-In (OAuth 2.0 / OpenID Connect)** implemented **in the app**, not
  at the edge, so it is portable and testable. Details in "Authentication and access" below.
- **Testing:** frontend unit tests in Vitest; backend unit tests in Vitest via
  **`@cloudflare/vitest-pool-workers`**, so handlers run in the real `workerd` runtime against a local
  D1 rather than against a mock. End-to-end tests with **Playwright** under `e2e/`, driving
  `wrangler dev`.

## Deployment target (fixed)

Personal Space is a **hosted, production-grade web app**, reachable from any machine over the public
internet and installable as a PWA on desktop and mobile. A local run is a developer convenience and
a test harness, not the product.

- One origin over HTTPS serves both the API and the built PWA.
- **One user, one workspace — for now.** Exactly one Google account is allowed in, and it owns one
  workspace. This is the shipped scope, and it keeps the build small.
- **The intended future shape is many accounts, each with its own private workspace** — isolated
  tenants, not a shared space. The seams for it are built in from day one (see "Tenancy seams" and
  "API contract" below). Getting there must be an additive change — new rows, a membership lookup, a
  workspace switcher — with **no change to the database structure and no change to the API contract**,
  and no data backfill.
- **Hostname:** ship on the free `*.workers.dev` subdomain, which comes with HTTPS. A custom domain is
  a later, additive change. Because moving hostnames means re-registering the Google OAuth redirect URI
  and invalidating bookmarks, the public origin is read from `PUBLIC_ORIGIN` and never hardcoded.
- The local developer run still works with one documented command — `wrangler dev` with a local D1
  database and the auth bypass below — so contributors and the test suites need no Cloudflare account,
  no Google credentials and no internet.

### Why Cloudflare, and what it costs

Free tier covers this app comfortably: Workers 100k requests/day, D1 5M row-reads and 100k row-writes
per day, 500 MB per database on free. TLS, CDN and DDoS protection are included, and D1 **Time Travel**
gives 30-day point-in-time restore without a backup cron. Expected running cost is **the domain only**
(and nothing at all while on `workers.dev`). The alternative considered was a small always-on VM
(Fly.io, Oracle free tier, Lightsail at ~USD 60/yr); Cloudflare wins on cost and on ops burden, and the
offline op-queue design below is what makes a stateless edge backend safe — the client tolerates
latency and retries idempotently.

**The exit path is deliberate.** D1 is SQLite, so the schema and queries are portable; only the runtime
bindings are Cloudflare-specific, and they are confined to the repository layer. Moving to Node +
SQLite on a VM, or to Turso, is a rewrite of that layer and nothing else. Every Cloudflare-specific
boundary carries a `// Future:` comment naming this.

## D1 constraints (fixed, and they shape the design)

These are not footnotes. Each one has a design consequence, and ignoring it produces code that works
locally and fails in production.

- **No interactive transactions.** D1 has no `BEGIN`/`COMMIT` spanning multiple round trips. Atomicity
  comes from `db.batch([...])`, which applies an array of statements as a unit. Every multi-statement
  write — creating a page with its first block, applying a sync chunk — must be expressed as one
  `batch()` call, not as a sequence of awaits. Code that assumes an open transaction is a defect.
- **50 queries per Worker invocation on the free plan** (1000 on paid). This is the binding limit on
  `/api/.../sync`: the client chunks the queue into batches of **at most 25 ops**, and the server
  rejects a larger batch with `413` rather than silently truncating. Chunking is safe because
  `applied_ops` makes replay idempotent, so a chunk that succeeds after a timeout is never applied twice.
- **10 ms CPU per invocation on the free plan.** Keep handlers free of heavy loops; do not build search
  indexes or reconcile whole workspaces inside a request.
- **500 MB per database, 5 GB per account on free.** Ample for text. If uploads are ever added they go
  to R2, never into D1 as blobs.
- **2 MB maximum row size and 100 columns per table.** Database properties are modelled as **rows, not
  columns** — a property is a row in a properties table, a cell is a row in a values table. This is
  required anyway for user-defined properties, and it keeps the 100-column ceiling irrelevant.
- **Single-threaded per database, queries queue.** Fine for one user; another reason sync arrives in
  bounded chunks rather than one enormous batch.
- **No server-side search index, and no FTS5.** The contract asks for quick-find over page, database
  and row *titles* only. The client already holds the whole workspace locally for offline use, so search
  is client-side filtering over that copy: instant, works offline, and no virtual table to keep in sync
  or rebuild on export. D1 does support FTS5 if searching inside block content is ever added — that is
  the trigger for revisiting this, and nothing else.
- **Migrations** are `wrangler d1 migrations` files, forward-only, applied in deploy. The same files run
  against local D1 in development and in tests, so a migration is exercised before it ships.
- **Durable Objects require the paid plan.** They are the natural vehicle for future realtime
  collaboration, so that future carries a USD 5/mo floor. Noted now so it is not a surprise later.

## Authentication and access (fixed)

- **Provider:** Google Sign-In, server-side **authorization-code flow** with OIDC. The frontend
  never holds a Google token. The backend exchanges the code, verifies the ID token signature,
  issuer, audience and `email_verified`, then issues its own session.
- **Redirect, not popup:** full-page redirect. Popup and One Tap flows are unreliable in an installed
  PWA running in standalone display mode. Carry a signed `state` value through the redirect and
  reject any callback whose `state` does not match.
- **Sessions:** an opaque random session id in a cookie — `httpOnly`, `Secure`, `SameSite=Lax`,
  with a sliding expiry (target: sign in once per device, roughly 30 days of inactivity). Sessions
  are a table in D1; sign-out deletes the row server-side, so a stolen cookie dies with it. Expired
  sessions are swept by a **Cron Trigger** (free on Workers), not by a timer inside a request.
- **Who is allowed in:** one environment variable, `ALLOWED_EMAIL`, holding a single address. Any
  other Google account completes the flow and is then refused with a clear "you do not have access to
  this space" screen, and receives no workspace data at any point.
  The check lives in **one function** — `resolveAccess(email): { userId, workspaceId, role } | null` —
  which is the single place that decides who gets in and with what role. Today it compares against
  `ALLOWED_EMAIL` and returns `role: 'owner'`. Making the app multi-user later means changing this one
  function to read the `workspace_members` table; nothing else moves.
- **Enforcement is server-side and role-aware from the start.** One middleware guards every `/api`
  route: no valid session returns `401`, and a request whose role lacks the needed capability returns
  `403`. Today only `owner` exists and it can do everything, so the `403` path is exercised only by
  tests — but the capability check is real code, not a stub, so adding `editor` and `viewer` later is
  a data change rather than a new enforcement layer.
- **Unauthenticated surfaces** are exactly: the sign-in screen, the OAuth callback, the health
  endpoint, and the static PWA assets. Everything else requires a session.
- **Service worker and privacy:** the app shell is cached; API responses and the sign-in redirect
  never are. Sign-out clears the session server-side and drops the service worker caches, so a
  shared or lost device cannot show the previous person's workspace.
- **Dev-only bypass:** `AUTH_DISABLED=true` runs the app with no sign-in as a fixed synthetic owner.
  The server **refuses to start** if this is set while `NODE_ENV=production`. In production the server
  also refuses to start unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
  `PUBLIC_ORIGIN` and `ALLOWED_EMAIL` are present — fail closed, never fail open.
- **Secrets:** all of the above live in `.env`, never committed and unreadable to the agents. Ship a
  committed `.env.example`, and document in README.md how to create the Google Cloud OAuth client and
  which redirect URI to register.
- **Tests:** unit-test the middleware, `resolveAccess`, the capability check (including a `403` for a
  synthetic viewer role) and the session lifecycle against a stubbed token verifier. End-to-end tests
  run with the bypass by default; a dedicated spec runs the real flow against a local fake OIDC issuer,
  covering sign-in, refusal of a non-allowlisted account, and sign-out — so the suite needs no internet.

## Tenancy seams (fixed)

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

### API contract (fixed)

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

## Data model details (fixed)

Small decisions with schema consequences, settled now because each is painful to change later.

- **Ordering is fractional, not integer positions.** Blocks in a page, rows in a database and pages in
  the sidebar each carry a `sort_key` string, and an item is moved by computing a key between its new
  neighbours. With integer positions, dragging one block rewrites every sibling — turning one gesture
  into N ops, N row-writes and N chances for last-write-wins to clobber. Fractional keys make a move
  exactly one op on one row. Use a maintained library (`fractional-indexing` or equivalent).
- **Pages have a `sort_key` even though the sidebar has no drag-reorder.** REQUIREMENTS.md specifies
  dragging for blocks and board cards, not for the page tree, so the tree renders in `sort_key` order
  seeded to creation order and there is no reorder UI. The column exists so adding one later is a
  feature, not a migration. `// Future:` comment required at the render site.
- **Database properties are rows, not columns** — a property is a row in `properties`, a cell is a row
  in `property_values`. Required for user-defined properties anyway, and it keeps D1's 100-column
  ceiling irrelevant.
- **Theme is per device, not per account.** Light/dark lives in `localStorage`, so it works offline,
  applies before first paint with no flash, and needs no round trip. It deliberately does not follow you
  between devices — a phone in bed and a laptop at a desk reasonably want different answers.

## Seed data (fixed)

The seed is a **reusable template applied when a workspace is created**, not a one-off insert at deploy
time. One function, `seedWorkspace(ctx)`, takes a workspace id and populates it; deploy calls it once for
your workspace, and the multi-account future calls the same function on first sign-in so every new account
gets a populated first run. This is why it must be parameterised by `workspace_id` and callable on demand
rather than being a hand-written SQL migration full of literal ids.

- The template is data (a TypeScript module of plain objects), not SQL, so it is readable and reviewable.
- It is idempotent per workspace: calling it twice does not duplicate content.
- It grows with the phases, per REQUIREMENTS.md, so no feature ever ships empty.
- Because ids are client- or server-minted UUIDs rather than fixed literals, the same template can be
  applied to any number of workspaces without collision.

## Offline and sync (fixed)

The installed app is fully usable with no network, including editing. This is in scope for the build.

**Ops are the write path from Phase 1, not a Phase 6 retrofit.** Every mutation in the app is an op from
the first line of code, even while the offline queue does not exist yet: in Phases 1-5 the client builds
an op and posts it immediately, awaiting the result. Phase 6 then adds only the durable queue, the flush
loop, the service worker and the status indicator. Building Phases 1-5 on plain REST mutations and
converting later would mean rewriting every write path in the product — the editor's autosave, every
drag-reorder, every cell and property edit. This ordering is deliberate; do not "simplify" it away.

- **Local store:** IndexedDB through a maintained wrapper (`idb` or Dexie — not hand-rolled). It holds
  a copy of the workspace for reading and the pending write queue. TanStack Query stays the server-state
  layer, backed by this store as its persister.
- **Local data is namespaced by user and workspace** — every record and every query key is keyed on
  `(userId, workspaceId)`, and sign-out clears that namespace. One browser profile must be able to hold
  two accounts' offline data later without collisions or leakage; a flat local store would have to be
  rebuilt to allow it.
- **Writes are intent-based operations, not replayed HTTP calls.** Every mutation appends an op:
  `{ op_id, workspace_id, entity, entity_id, type, payload, base_version, client_seq, created_at }`.
  `op_id` is a client-minted UUID and `client_seq` is a monotonic per-device counter, so the queue has
  a total order per device.
- **The client mints entity ids.** Creating a page offline generates its UUID locally, so it is
  immediately linkable and nestable, and sync needs no id remapping.
- **Optimistic and durable:** an op is applied to local state and persisted to IndexedDB in the same
  step, before any network attempt. Closing the app, or the OS killing it, loses nothing.
- **Flush in bounded chunks.** On reconnect (the `online` event, plus a check on app start and on window
  focus) the client POSTs the queue to `/api/workspaces/:workspaceId/sync` in `client_seq` order, **at
  most 25 ops per request**, one chunk at a time and strictly in order — never in parallel, or ops would
  land out of sequence. The server applies a chunk as a single `db.batch()` so the chunk is atomic, and
  returns the resulting server state. Chunk N+1 is sent only after N is acknowledged; a failed chunk
  stops the flush and leaves the rest queued. Background Sync is a progressive enhancement where the
  browser supports it, never the only trigger.
- **Idempotency is the server's job:** an `applied_ops` table records every `op_id`. Replaying an op
  returns the original outcome instead of applying it twice, so a retry after a timeout — the common
  case on mobile — is always safe.
- **Sync status is visible:** the UI shows synced / N pending / offline / failed. A rejected op (invalid,
  forbidden, or referring to something deleted) is surfaced to the user with what was dropped, removed
  from the queue, and local state reconciled from the server rather than left silently diverged.
- **Deletes are ops too.** Deletion stays permanent (no trash, per REQUIREMENTS.md), but the `op_id`
  lives on in `applied_ops` so a replayed delete is a no-op rather than an error.
- **Unsent ops for the same target coalesce.** Typing produces one op per debounced pause per block; left
  to accumulate, an hour offline on one page yields thousands of queued ops describing a paragraph. So an
  op that is still unsent and targets the same `(entity, entity_id, field)` **replaces** the pending one
  rather than appending. Only ops already in flight are immutable. Without this the ≤25-op chunk limit
  turns a normal offline session into dozens of sequential round trips.
- **An op whose target no longer exists is dropped, not resurrected.** Delete a parent page on one device
  and add a child under it on another, both offline: on sync the child's op refers to a missing parent.
  The server rejects it with a reason, the client drops it and tells the user what was lost. Recreating
  deleted ancestors to host an orphan would silently undo an explicit deletion, which is worse.

### Concurrency: out of scope now, designed for later

Concurrent editing — two devices changing the same thing at once — is **not** built. The policy today
is **last write wins by server arrival order**. The design carries what a future implementation needs:

- Every content row has a `version` integer, bumped on every write, and `updated_at`.
- Every op carries `base_version` — the version the client believed it was editing. The server
  **applies the op regardless (still last write wins) but reports every mismatch** in the sync response,
  and the client surfaces it: "3 changes overwrote newer edits". This is the one real data-loss path in
  the design — two of your own devices, both offline, same page — and it costs almost nothing to make
  visible rather than silent. Turning on true optimistic concurrency later means refusing on mismatch
  instead of reporting it: one line, plus a resolution UI.
- Ops are fine-grained and field-level rather than whole-document PUTs, so two edits to different
  parts of one page can be merged by a later implementation instead of clobbering.
- The op log is append-only and ordered, which is the substrate any future CRDT or
  operational-transform layer needs. Choosing whole-document replacement now would foreclose that.
- Every place these assumptions bite must carry a `// Future:` comment (see "Code comments").

## Production readiness (fixed)

Because this is exposed to the internet and shared, these are build requirements, not polish:

- **Schema migrations:** `wrangler d1 migrations` files, versioned and forward-only, applied as part of
  deploy and run identically against local D1 in development and tests. No hand-edited production schema.
- **Backups and restore:** D1 **Time Travel** provides 30-day point-in-time restore with no cron and no
  object storage. The restore procedure is documented in README.md and **must be executed once against
  a throwaway database** before the project is called done — an untested restore is not a backup.
  A periodic `wrangler d1 export` to a local file is the off-platform copy. There are no virtual tables
  in the schema, so nothing blocks the export.
- **Transport and headers:** HTTPS is inherent on Workers. Set HSTS, a strict `Content-Security-Policy`,
  `X-Content-Type-Options` and `Referrer-Policy` explicitly in the Worker via Hono's secure-headers
  middleware. The CSP must be tight enough that the Google sign-in redirect still works — verify it,
  do not assume it.
- **Abuse resistance:** a Cloudflare rate-limiting rule in front of the sign-in and callback routes,
  plus application-level limits on `/sync` and search. Validate and bound every request body with a
  schema (Zod or equivalent) — op count per chunk, text length, nesting depth — and reject rather than
  truncate. This matters more than on a private box: the origin is public and the free tier is a quota
  someone else can burn.
- **Operability:** structured JSON logs with a request id via `console.log` into Workers Logs; never log
  secrets, tokens or page content. An unauthenticated `/healthz` that checks D1 connectivity. Workers
  handles crash recovery and restarts, so there is no supervisor and no graceful-shutdown path to write.
- **Errors:** no stack traces or internal messages in any client response; the request id is returned so
  a user report can be correlated with a log line.
- **Quota awareness:** the free tier is a hard daily ceiling, not a bill. A runaway sync loop degrades to
  errors rather than to a surprise invoice, but it does take the app down for the rest of the day — so
  the client must back off exponentially on repeated sync failure rather than retry tightly.

## Code comments (fixed)

Every agent writing code follows this. It applies to frontend, backend, and tests.

- **Every exported function, component, hook, route handler and module gets a short comment** saying
  what it does and why it exists — one or two lines, above the declaration. Not a restatement of the
  signature: `// Applies a queued op batch in client_seq order, skipping ops already in applied_ops.`
  beats `// applies ops`.
- **Comment the non-obvious inside functions too**, briefly: why a guard exists, why an order matters,
  why the obvious simpler thing does not work. Skip commentary on code that already reads plainly.
- **Mark every scalability seam with a `// Future:` comment** naming what would change and where.
  Examples of places that must carry one:
  - `resolveAccess` — "Future: read workspace_members instead of ALLOWED_EMAIL to support many users."
  - the workspace resolver — "Future: take workspaceId from the route for multi-workspace."
  - the `base_version` handling in the sync endpoint — "Future: reject on mismatch to enable optimistic
    concurrency; recorded but unused today."
  - the last-write-wins merge point — "Future: field-level merge or CRDT goes here."
  A `// Future:` comment states the intended change, not a vague aspiration. If it cannot name the
  change, it should not be written.
- **Keep it proportional.** Small modules with clear names plus these comments; no essays, no
  redundant JSDoc tag blocks restating types TypeScript already declares, no commented-out code.
- **No emojis anywhere in code or comments**, per CLAUDE.md.

## Deploying to Cloudflare

One Worker, one D1 database, one static-assets binding, one origin. Everything below is free.

1. **Create the resources:** `wrangler d1 create personal-space`, then put the database binding, the
   static-assets binding, the Cron Trigger for session sweeping, and `PUBLIC_ORIGIN` in
   `wrangler.toml`. `wrangler.toml` is committed; it holds no secrets.
2. **Secrets** go in via `wrangler secret put` — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `SESSION_SECRET`, `ALLOWED_EMAIL`. They are never in `wrangler.toml`, never in git. `.dev.vars`
   holds the local equivalents and is gitignored; `.dev.vars.example` is committed.
3. **Google OAuth client:** create a Web application client in Google Cloud Console and register the
   redirect URI `https://<worker>.workers.dev/api/auth/callback`. Keep the consent screen in Testing
   mode with your own account as the only test user — no verification review needed. The app issues
   its own session and never stores a Google refresh token, so the 7-day refresh-token expiry that
   applies to unverified apps is irrelevant here.
4. **Deploy:** `wrangler deploy` runs the D1 migrations and publishes the Worker with the built PWA
   assets. Rollback is `wrangler rollback`.
5. **Verify from another machine** — the deployed URL, signed in, installed as a PWA on a phone. Not
   localhost. This is a final success criterion, not a nicety.

**Running cost: USD 0** on `workers.dev`, plus roughly USD 10/year if a custom domain is added later
(Cloudflare Registrar sells at cost). The first thing that would push this to USD 5/mo is not traffic —
it is wanting Durable Objects for realtime collaboration, or exceeding 500 MB in one database.

**If Cloudflare ever stops fitting:** the schema is portable SQLite and the Cloudflare-specific code is
confined to the repository layer. Node + `better-sqlite3` on Fly.io or a small VM, or Turso for hosted
libSQL, are each a rewrite of that one layer. Do not spread `env.DB` or Workers globals through the
codebase, or this stops being true.

**Domain and TLS:** a `.com` via Route 53 is about USD 12/year; TLS is free via Caddy/Let's Encrypt
on the instance, or via CloudFront + ACM on the S3 path. A free subdomain also works for private use.
