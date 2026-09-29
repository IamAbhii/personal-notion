# 15 — Deployment and operations

Decision record: [`docs/architecture/deployment.md`](../architecture/deployment.md).

One Worker, one D1 database, one static-assets binding, one origin, over HTTPS. **Running cost is
USD 0** on a `*.workers.dev` subdomain.

A local run is a developer convenience and a test harness, not the product.

## The deployed shape

```
https://<worker>.workers.dev
  ├─ /api/*     → the Worker (run_worker_first guarantees this)
  └─ everything → static assets from packages/frontend/dist
                  (not_found_handling: single-page-application)
```

One origin means **no CORS and one cookie domain**, which is why the session cookie and the OAuth
redirect work without any cross-site machinery.

## CI/CD

### `.github/workflows/ci.yml` — every PR to `main`

```
checkout → setup-node 22 (npm cache) → npm ci
  → npm run typecheck
  → npm run lint
  → npm test -- --run
```

The Playwright suite is **not** in CI; it runs locally ([14](./14-testing.md)).

### `.github/workflows/deploy.yml` — every push to `main`

The same three gates, then:

```
npm run build:frontend
wrangler d1 migrations apply personal-space --remote    # migrations BEFORE the deploy
wrangler deploy
```

Both wrangler steps use `cloudflare/wrangler-action@v3` with
`workingDirectory: packages/worker`.

**Migrations are applied before the Worker is deployed**, so the new code never meets an old
schema. Since migrations are forward-only and additive, the previous Worker keeps working against
the new schema for the seconds between the two steps.

Required repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

Rollback is `wrangler rollback` — note it rolls back the **Worker**, not the database. A migration
is forward-only, so there is nothing to roll back there by design.

## Configuration: four places, do not mix them up

| Location                         | Holds                                                                                                              | Committed                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `packages/worker/wrangler.jsonc` | Bindings, assets, cron, and **non-secret** vars (`NODE_ENV`)                                                       | Yes                             |
| `packages/worker/.dev.vars`      | Local development secrets and `NODE_ENV=development`                                                               | **No** (`.dev.vars.example` is) |
| `wrangler secret put`            | Production secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_EMAIL`, `PUBLIC_ORIGIN` | n/a                             |
| repo-root `.env`                 | `ANTHROPIC_API_KEY` for the agent build, `CLOUDFLARE_API_TOKEN` for deploying — **not** application runtime config | **No** (`.env.example` is)      |

The root `.env.example` lists the five production values as _documentation_ in a comment; nothing
reads them from there at runtime.

`NODE_ENV` deserves its own note: `wrangler.jsonc` sets it to `"production"`, so **deployed Workers
are always in production mode**, and local development overrides it _downward_ via `.dev.vars`. That
is the opposite of the usual default and it is the safe direction — a forgotten override cannot turn
production into development mode.

## First-time setup from scratch

1. `wrangler d1 create personal-space`, and put the returned `database_id` in `wrangler.jsonc`'s
   `d1_databases` block (it carries a `// Future:` note saying exactly this).
2. `wrangler secret put` each production secret.
3. **Google OAuth client:** a Web application client in Google Cloud Console with redirect URI
   `https://<worker>.workers.dev/api/auth/callback`. Keep the consent screen in **Testing** mode
   with your own account as the only test user — no verification review needed. The app issues its
   own session and never stores a Google refresh token, so the 7-day refresh-token expiry for
   unverified apps is irrelevant.
4. `wrangler deploy`.
5. **Verify from another machine** — the deployed URL, signed in, installed as a PWA on a phone. Not
   localhost. This is a final success criterion, not a nicety.

Full key-by-key walkthrough: [docs/AUTH_FLOW.md](../AUTH_FLOW.md).

### Hostname

Ship on the free `*.workers.dev` subdomain, which comes with HTTPS. A custom domain is a later,
additive change (~USD 10/year at Cloudflare Registrar, sold at cost). Because moving hostnames means
re-registering the Google OAuth redirect URI and invalidating bookmarks, the public origin is read
from `PUBLIC_ORIGIN` and **never hardcoded**.

## Operations

### Logs

`observability: { enabled: true }` in `wrangler.jsonc` sends `console.log`/`error`/`warn` to
Workers Logs. The convention is **structured JSON with the fields you will filter on**:

```ts
console.error('Unhandled error', JSON.stringify({ method, path, message, stack }));
```

**Never log secrets, tokens or page content.** Several log lines exist specifically because a 302
redirect is invisible in Workers metrics — the OAuth state mismatch warning and the token-exchange
failure error are both there so a misconfiguration is diagnosable. Keep them.

### Health

`GET /api/health` returns `{ status: 'ok', time }`. Unauthenticated, registered before the auth
middleware. It does **not** currently check D1 connectivity, which the production-readiness doc
asks for — see [12](./12-security.md).

### The cron trigger

```jsonc
"triggers": { "crons": ["0 3 * * *"] }
```

Daily at 03:00 UTC, the `scheduled()` handler in `src/index.ts` calls `deleteExpiredSessions`,
keeping the `sessions` table small without touching the request path. Cron Triggers are free on
Workers.

### Crash recovery

There is none to write. Workers handles restarts, so there is no supervisor and no
graceful-shutdown path.

## Backups and restore

- **D1 Time Travel** — 30-day point-in-time restore, no cron and no object storage needed. This is
  the primary backup.
- **`wrangler d1 export`** to a local file, periodically, as the off-platform copy. There are no
  virtual tables in the schema, so nothing blocks the export.
- **The restore procedure must be executed once against a throwaway database** before the project
  is called done. An untested restore is not a backup.

## Quotas — a ceiling, not a bill

Free tier: Workers 100k requests/day; D1 5M row-reads and 100k row-writes per day, 500 MB per
database (5 GB per account); 50 queries and 10 ms CPU per invocation.

**The free tier is a hard daily ceiling, not a bill.** A runaway sync loop degrades to errors rather
than a surprise invoice — but it does take the app down for the rest of the day. Hence the client is
required to back off exponentially on repeated sync failure (a gap today,
[12](./12-security.md)).

The first thing that would push this to USD 5/mo is **not traffic** — it is wanting Durable Objects
for realtime collaboration, or exceeding 500 MB in one database.

## The exit path is deliberate

D1 is SQLite, so the schema and queries are portable; only the runtime bindings are
Cloudflare-specific, and they are confined to `db/client.ts` and the `repo/` modules. Moving to
Node + `better-sqlite3` on a VM, or to Turso for hosted libSQL, is a rewrite of that one layer and
nothing else.

**Do not spread `env.DB` or Workers globals through the codebase, or this stops being true.** Every
Cloudflare-specific boundary carries a `// Future:` comment naming this.

## Next

- [12 — Security](./12-security.md)
- [16 — Conventions and workflow](./16-conventions-and-workflow.md)
