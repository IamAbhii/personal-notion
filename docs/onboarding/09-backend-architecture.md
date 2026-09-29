# 09 — Backend architecture

`packages/worker` — TypeScript on Cloudflare Workers, Hono 4 as the router, Drizzle over D1.

There is **no Node server, no process to supervise and no OS to patch**. The same Worker serves the
API and the built PWA through the static-assets binding, so the whole app is one origin: no CORS,
one cookie domain.

## The layers, and the rule that matters most

```
src/index.ts          entry: config gate → routes → error handler → assets fallback
  ├── auth/           requireAccess, requireWorkspace, resolveAccess, capabilities
  ├── routes/         Hono routers — thin: parse, validate, delegate, shape a response
  ├── sync/           the op schema (Zod) and applyOps — the write engine
  ├── seed/           the workspace seed template (data) and its applier
  ├── repo/           the repository layer — the ONLY place SQL is built
  ├── db/             the D1 → Drizzle handle, the Drizzle schema, the batch helper
  └── lib/            ids, fractional sort keys — pure
```

**The rule: nothing above `repo/` and `db/` sees `env.DB` or any Workers global.** That containment
is what makes the Cloudflare dependency reversible — moving to Node + `better-sqlite3`, or to Turso,
is a rewrite of `db/client.ts` and the `repo/` modules and _nothing else_. Spread `env.DB` through
the codebase and that stops being true.

Two corollaries you will be held to in review:

- **No route builds a query.** Routes call repository functions and pass `ctx`.
- **No repository function takes a raw workspace id.** It takes `ctx: { userId, workspaceId, role }`,
  and every read and write filters on `ctx.workspaceId`. See [13](./13-tenancy-and-multi-user.md).

## `src/index.ts` — the request lifecycle

Read this file first; it is 107 lines and it tells you the whole shape.

```ts
function createApp(env: Env): Hono<AppEnv> { … }
```

It is a **function**, not a module-level constant, because which routes exist depends on the
environment (the test-reset route is registered only under the dev bypass) and bindings only exist
once a request arrives. The built app is then cached per isolate, keyed on the one setting that
changes its shape, so a request pays no route-registration cost:

```ts
let cached: { app: Hono<AppEnv>; testReset: boolean } | undefined;
```

Registration order, which _is_ the security model:

1. **The config gate.** `app.use('*', …)` runs `configErrors(c.env)` and returns `503` with the
   reasons logged if the configuration is unusable. Workers has no startup hook, so "refuses to
   start" means **every request is refused**, rather than the app running with the auth bypass on in
   production or with a missing session secret. Fail closed, never fail open.
2. **`GET /api/health`** — unauthenticated liveness, registered before the auth middleware
   precisely because it is one of the deliberately unauthenticated surfaces.
3. **`/api/auth/*`** — the OAuth endpoints, also before the middleware.
4. **`app.use('/api/*', requireAccess)`** — one middleware over every other `/api` route. There is
   no route-level opt-out; the unauthenticated surfaces are mounted _above_ it.
5. **`/api/workspaces/:workspaceId/test/reset`** — conditionally, only under the dev bypass.
6. **`/api/me` and the workspace routes.**
7. **`app.all('/api/*', …)`** — unknown API paths are JSON `404`s, **never** the SPA shell, so a
   mistyped fetch fails loudly instead of receiving HTML.
8. **`app.all('*', …)`** — the PWA. Static assets normally never reach the Worker (the assets
   binding serves them first, configured with `run_worker_first: ["/api/*"]`); this fallback exists
   for the case where they do and for `wrangler dev` running the Worker ahead of the asset router.
9. **`app.onError`** — one handler for every unexpected throw. Re-raises an `HTTPException`'s own
   response; otherwise logs `{ method, path, message, stack }` as JSON and returns a generic
   `{ error: 'internal_error' }`. No route can answer with Hono's default plain-text "Internal
   Server Error", because clients parse JSON and a bare 500 tells nobody anything. **The detail goes
   to the log, not to the caller.**

### The `scheduled` handler

```ts
async scheduled(_event, env) {
  const db = createDb(env.DB);
  await deleteExpiredSessions(db);
}
```

A Cron Trigger, `0 3 * * *` in `wrangler.jsonc`, sweeps expired sessions daily. Running it outside
request handling keeps the `sessions` table small without touching the hot path — and Cron Triggers
are free on Workers.

## Typed context: `src/types.ts`

```ts
export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db; // set by requireAccess
    identity: Identity; // set by requireAccess
    ctx: Ctx; // set by requireWorkspace
  };
};
```

Every router is `new Hono<AppEnv>()`, so `c.var.db`, `c.var.identity` and `c.var.ctx` are typed.
`identity` has `workspaceId: string | null` (a brand-new user has no workspace yet); `ctx` has a
non-null `workspaceId` and is what repository functions take. `contextFor()` narrows one to the
other.

Use the TypeScript language server for these types rather than reading files to infer them — `ctx`
and `resolveAccess` are exactly the seams where a rename must reach every caller.

## Configuration: `src/env.ts`

```ts
export type Env = {
  DB: D1Database;
  ASSETS?: Fetcher;
  NODE_ENV?: string;
  AUTH_DISABLED?: string; // dev-only bypass
  ALLOWED_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
};
```

`configErrors(env)` returns the reasons the configuration is unusable, empty when fine. In
production:

- `AUTH_DISABLED` must **not** be set — the bypass cannot be switched on where it matters, by
  accident or otherwise.
- All five of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_ORIGIN`,
  `ALLOWED_EMAIL` must be present.

Outside production the function returns immediately, so local development needs none of them.

`isProduction(env)` is `env.NODE_ENV === 'production'`, and `wrangler.jsonc` sets
`vars.NODE_ENV = "production"` — so **deployed Workers are always in production mode**, and local
dev overrides it to `"development"` via `.dev.vars`. This is the opposite of the usual default, and
it is the safe direction.

## `wrangler.jsonc`

```jsonc
{
  "main": "src/index.ts",
  "observability": { "enabled": true },
  "assets": {
    "directory": "../frontend/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"],
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "personal-space", "migrations_dir": "migrations" },
  ],
  "vars": { "NODE_ENV": "production" },
  "triggers": { "crons": ["0 3 * * *"] },
}
```

- `not_found_handling: "single-page-application"` gives client-side routing its index.html fallback.
- `run_worker_first: ["/api/*"]` guarantees `/api/*` reaches the Worker even if a file of that name
  happens to exist in `dist`.
- It is **committed and holds no secrets.** Secrets live in `.dev.vars` locally and
  `wrangler secret put` in production. See [15](./15-deployment-and-operations.md).

## The routers

Three small files, all thin by design.

### `routes/auth.ts` — the only router with a factory

```ts
export function createAuthRoutes(exchangeCodeForProfile = defaultExchangeCodeForProfile);
export const authRoutes = createAuthRoutes();
```

The token exchange and ID-token verification are combined into **one injectable step**, so tests can
stub both and make no network calls. The default export uses the real Google verifier. This is the
pattern to copy whenever a handler needs an external service. Full flow in
[11](./11-auth-and-authorization.md).

### `routes/me.ts`

Returns `{ user, memberships }`, and is **the one place a workspace is created and seeded**:

```ts
if (identity.workspaceId === null) {
  const membership = await createWorkspaceForUser(db, identity.userId, 'My Space');
  await seedWorkspace(db, contextFor(identity, membership.workspaceId));
}
```

First launch is therefore populated with no extra start step, and the multi-account future gets a
populated first run for free.

### `routes/workspaces.ts`

`workspaceRoutes.use('/workspaces/:workspaceId/*', requireWorkspace)` — so `:workspaceId` is checked
against the caller's memberships before any query — then the snapshot GET and the sync POST. The
whole file is 68 lines; validation, limits and the workspace-mismatch check are all visible in one
screen. Contract in [07](./07-api-contract.md).

### `routes/testReset.ts`

The e2e workspace reset. The guard is at **registration** time, not inside the handler:

```ts
export function isTestResetEnabled(env: Env): boolean {
  return isAuthDisabled(env) && !isProduction(env);
}
```

So with the bypass off there is **no code path from a production request to the reset logic** — the
route simply does not exist and the API catch-all answers `404`. It carries a `// Future:` comment
saying it must never gain a production code path.

## The seed

`seed/template.ts` is **data, not SQL** — a TypeScript module of plain objects (~920 lines) so it is
readable and reviewable. `seed/seedWorkspace.ts` applies it.

Why it is built this way, from
[`docs/architecture/data-model.md`](../architecture/data-model.md):

- It is a **reusable template applied when a workspace is created**, not a one-off insert at deploy
  time. Deploy calls it once for your workspace; the multi-account future calls the same function on
  first sign-in.
- Therefore it is **parameterised by `workspace_id`** and mints every id per call — no literal ids
  anywhere in the template.
- It is **idempotent per workspace**: calling it twice does not duplicate content.
- Its shape is **append-only**: Phase 2 added `blocks` to its nodes, Phase 3 `databases`, Phase 4
  `views`. Keep extending, do not reshape.

## Writing a new handler

1. Mount under `/api/workspaces/:workspaceId/` behind `requireWorkspace`, unless it genuinely is an
   unauthenticated surface — and if it is, say why in the comment, because the list is short and
   closed.
2. Take `ctx` from `c.var.ctx` and `db` from `c.var.db`.
3. Validate the body with Zod. Bound every field. **Reject, never truncate.**
4. Delegate to a `repo/` function. If you need a new query, add it there.
5. Multi-statement writes go in **one `runBatch()`** — D1 has no interactive transactions.
6. Doc-comment the handler: what it does **and why**. Add a `// Future:` at any scalability seam.
7. Never return internal detail in an error. Log it; return a generic message.
8. If it is a write, it should almost certainly be an **op type**, not a route
   ([08](./08-writes-updates-and-sync.md)).

## Next

- [10 — Data layer and database](./10-data-layer-and-database.md)
- [11 — Auth and authorization](./11-auth-and-authorization.md)
- [12 — Security](./12-security.md)
