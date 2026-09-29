# 01 — Project overview

## What the product is

Personal Space is a personal knowledge manager in the shape of Notion: nested pages, a block
editor, and databases with table, board and list views. It ships as an installable PWA served from
a single origin, gated behind Google sign-in, with one allowed account and one workspace.

The whole thing runs on Cloudflare's free tier: one Worker serving both the API and the built
frontend, one D1 (managed SQLite) database, one static-assets binding.

## The stack, concretely

| Layer        | Choice                                                      | Where                                                    |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| Frontend     | React 19 + TypeScript, Vite 6                               | `packages/frontend`                                      |
| Routing      | TanStack Router (code-based routes, no file routing)        | `packages/frontend/src/router.tsx`                       |
| Server state | TanStack Query 5                                            | `packages/frontend/src/api/queries.ts`                   |
| UI state     | Zustand 5                                                   | `packages/frontend/src/stores/`                          |
| Styling      | Tailwind CSS 4 over a CSS custom-property token layer       | `packages/frontend/src/styles/`                          |
| Primitives   | Radix UI, lucide-react icons, sonner toasts, dnd-kit drag   | `packages/frontend/src/components/ui/`                   |
| PWA          | `vite-plugin-pwa` (Workbox)                                 | `packages/frontend/vite.config.ts`                       |
| Backend      | TypeScript on Cloudflare Workers, Hono 4 router             | `packages/worker/src/index.ts`                           |
| Validation   | Zod 4                                                       | `packages/worker/src/sync/ops.ts`                        |
| Database     | Cloudflare D1 via Drizzle ORM                               | `packages/worker/src/db/`, `packages/worker/migrations/` |
| Auth         | Google OAuth 2.0 / OIDC, in-app, `jose` for ID-token verify | `packages/worker/src/routes/auth.ts`                     |
| Unit tests   | Vitest; worker tests in real `workerd` via pool-workers     | `*.test.ts` co-located                                   |
| E2E tests    | Playwright                                                  | `e2e/`                                                   |

## Repository layout

```
personal-notion/
├── packages/
│   ├── frontend/           # React PWA. Built to dist/, served by the Worker.
│   │   ├── index.html      # Inline pre-paint theme script lives here
│   │   ├── vite.config.ts  # Vite + Tailwind + PWA + Vitest config in one file
│   │   └── src/
│   │       ├── api/        # HTTP client, query options, wire types
│   │       ├── components/ # Feature components + ui/ primitives
│   │       ├── hooks/      # Mutation hooks and small reusable hooks
│   │       ├── lib/        # Pure helpers, no React
│   │       ├── screens/    # Route-level components
│   │       ├── stores/     # Zustand stores
│   │       ├── styles/     # theme.css (tokens) + app.css (Tailwind bridge)
│   │       ├── sync/       # Op builders and the submit path
│   │       └── workspace/  # The workspace React context
│   └── worker/             # Cloudflare Worker: API + static assets
│       ├── migrations/     # Forward-only D1 SQL migrations (source of truth)
│       ├── wrangler.jsonc  # Bindings, assets, cron, vars
│       └── src/
│           ├── auth/       # Middleware, resolveAccess, capabilities
│           ├── db/         # D1 client, Drizzle schema, batch helper
│           ├── lib/        # ids, fractional sort keys
│           ├── repo/       # Repository layer — the only place SQL is built
│           ├── routes/     # Hono routers
│           ├── seed/       # The workspace seed template and applier
│           └── sync/       # Op schema and the applier
├── e2e/                    # Playwright specs, config, fixtures
├── docs/
│   ├── architecture/       # The fixed decisions, one file per area
│   ├── onboarding/         # You are here
│   ├── RUNNING.md          # Mandatory operational reading
│   └── AUTH_FLOW.md        # Sign-in flow, keys and secrets
├── screenshots/            # Evidence captures
├── DEFECTS.md              # The defect ledger
└── ADVERSARIAL_REVIEW.md   # Adversarial findings ledger
```

It is an npm workspace with two packages. All commands run from the repo root.

## Vocabulary

You will not get far in this codebase without these terms.

- **Workspace** — the tenant. One row in `workspaces`, one membership, all content scoped to it.
  Every content row carries a non-null `workspace_id`. See [13](./13-tenancy-and-multi-user.md).
- **Page** — the universal content node. A page's `kind` is `'page'`, `'database'` or `'row'`.
  A database is a page; a database row is also a page (so a row can have its own block content).
  The sidebar tree, breadcrumbs, and cascade delete all operate on this one table.
- **Block** — a unit of page content. Thirteen types (paragraph, headings, todo, code, image,
  toggle, …). Blocks belong to a page and are ordered by `sort_key`.
- **Property** — a database column. Stored as a _row_ in `properties`, not as a SQL column.
  Seven types: text, number, select, multiSelect, date, checkbox, url.
- **Property value** — a cell. A row in `property_values`, keyed `(row_page_id, property_id)`.
- **View** — a saved presentation of a database: `table`, `board` or `list`, with filters and a
  sort. Filtering and sorting are computed client-side; the server only stores and validates
  the settings.
- **Op** — an intent-based mutation. _Every_ write in the product is an op posted to
  `POST /api/workspaces/:workspaceId/sync`. There are no REST write endpoints. See
  [08](./08-writes-updates-and-sync.md).
- **Snapshot** — the whole workspace in one GET. The only read the app makes.
- **`sort_key`** — a fractional index string (via `fractional-indexing`), not an integer position,
  so a drag-reorder is one write on one row. See [10](./10-data-layer-and-database.md).
- **`ctx`** — `{ userId, workspaceId, role }`. Every repository function takes it; it is the only
  way a workspace id reaches a query.

## Shape of the whole system in one paragraph

The browser loads the PWA from the Worker, calls `GET /api/me` to learn its user and workspace,
then calls `GET /api/workspaces/:id/snapshot` once to pull the entire workspace into TanStack
Query's cache. Every render is derived from that one cached object. Every user action builds an op,
POSTs it to `/sync`, and then invalidates the snapshot query so the UI re-reads server truth. The
Worker authenticates the session cookie against the `sessions` table, resolves a `ctx`, validates
the op batch with Zod, applies the whole batch as one atomic `db.batch()` against D1, and records
each op's outcome in `applied_ops` so a retry is never applied twice.

## What is built vs. what is designed but not built

This matters more than usual here, because the architecture documents describe the end state and
several pieces are deliberately staged for later phases.

**Built and working:**

- Pages, nested tree, create/rename/delete with cascade, emoji icons
- The block editor with thirteen block types, slash menu, drag reorder, autosave
- Databases: properties, cells, rows-as-pages, table/board/list views, filters and sorts
- Client-side quick find (Cmd+K), light/dark theme, mobile drawer layout
- Google OAuth sign-in, D1-backed sessions, allow-list of one email, the dev bypass
- The op write path, `applied_ops` idempotency, version tracking, batch atomicity
- The snapshot read with ETag/304 and 30-second background polling
- PWA manifest and a Workbox service worker precaching the app shell

**Designed, documented, and deliberately not built yet (Phase 6 territory):**

- **Offline _editing_.** There is no IndexedDB store and no durable op queue. `submitOps` posts
  immediately and awaits the result. The only durability today is a synchronous `localStorage`
  stash written at page unload and replayed on next start — see
  [08](./08-writes-updates-and-sync.md).
- **A sync status indicator** (synced / N pending / offline / failed).
- **TanStack Query persistence to IndexedDB** (`main.tsx` carries the `// Future:` marker).
- **Runtime caching of API responses** in the service worker; only the app shell is precached.

**Specified in `docs/architecture/production-readiness.md` but not present in the code:**

- Hono `secureHeaders` middleware (HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`)
- A Cloudflare rate-limiting rule in front of the sign-in and callback routes
- The health endpoint is `GET /api/health`, not `/healthz`, and it does not check D1 connectivity

Those three are tracked in [12](./12-security.md) as known gaps, so you do not go looking for code
that is not there.

**Also note:** the root [README.md](../../README.md) still says "implementation has not started".
That line is stale — the app is built through the database and views phases.

## Non-obvious design choices you should know before reading code

1. **Ops are the only write path, from the first line of code.** Not REST-now-ops-later. Converting
   later would mean rewriting every mutation in the product. Do not add a REST write endpoint.
2. **Pages, databases and rows are one table.** Adding a fourth kind is a `kind` value, not a table.
3. **Properties are rows, not columns.** Required for user-defined properties, and it keeps D1's
   100-column ceiling irrelevant.
4. **Search is client-side.** There is no search endpoint and no FTS5 index. The client already
   holds the whole workspace.
5. **Concurrency is last-write-wins, but _reported_.** Every row has a `version`, every op a
   `baseVersion`; the server applies regardless and returns the mismatches.
6. **Multi-user is a seam, not a feature.** The API is workspace-scoped today with one workspace.
   Breaking that scoping is treated as a defect, not a simplification.

## Next

- Joining the frontend: [03 — Frontend architecture](./03-frontend-architecture.md)
- Joining the backend: [09 — Backend architecture](./09-backend-architecture.md)
- Either way, first: [02 — Local development](./02-local-development.md)
