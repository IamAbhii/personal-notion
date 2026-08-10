# Production readiness (fixed)

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
