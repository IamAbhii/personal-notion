# Deployment target (fixed)

Personal Space is a **hosted, production-grade web app**, reachable from any machine over the public
internet and installable as a PWA on desktop and mobile. A local run is a developer convenience and
a test harness, not the product.

- One origin over HTTPS serves both the API and the built PWA.
- **One user, one workspace — for now.** Exactly one Google account is allowed in, and it owns one
  workspace. This is the shipped scope, and it keeps the build small.
- **The intended future shape is many accounts, each with its own private workspace** — isolated
  tenants, not a shared space. The seams for it are built in from day one (see [Tenancy seams](./tenancy.md) and
  [API contract](./tenancy.md#api-contract-fixed)). Getting there must be an additive change — new rows, a membership lookup, a
  workspace switcher — with **no change to the database structure and no change to the API contract**,
  and no data backfill.
- **Hostname:** ship on the free `*.workers.dev` subdomain, which comes with HTTPS. A custom domain is
  a later, additive change. Because moving hostnames means re-registering the Google OAuth redirect URI
  and invalidating bookmarks, the public origin is read from `PUBLIC_ORIGIN` and never hardcoded.
- The local developer run still works with one documented command — `wrangler dev` with a local D1
  database and the [auth bypass](./auth.md) — so contributors and the test suites need no Cloudflare account,
  no Google credentials and no internet.

## Why Cloudflare, and what it costs

Free tier covers this app comfortably: Workers 100k requests/day, D1 5M row-reads and 100k row-writes
per day, 500 MB per database on free. TLS, CDN and DDoS protection are included, and D1 **Time Travel**
gives 30-day point-in-time restore without a backup cron. Expected running cost is **the domain only**
(and nothing at all while on `workers.dev`). The alternative considered was a small always-on VM
(Fly.io, Oracle free tier, Lightsail at ~USD 60/yr); Cloudflare wins on cost and on ops burden, and the
[offline op-queue design](./offline-sync.md) is what makes a stateless edge backend safe — the client tolerates
latency and retries idempotently.

**The exit path is deliberate.** D1 is SQLite, so the schema and queries are portable; only the runtime
bindings are Cloudflare-specific, and they are confined to the repository layer. Moving to Node +
SQLite on a VM, or to Turso, is a rewrite of that layer and nothing else. Every Cloudflare-specific
boundary carries a `// Future:` comment naming this.

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
