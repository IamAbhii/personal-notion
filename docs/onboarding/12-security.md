# 12 — Security

Decision record:
[`docs/architecture/production-readiness.md`](../architecture/production-readiness.md).
Authentication and authorization have their own page: [11](./11-auth-and-authorization.md).

This app is exposed to the public internet on a free tier that is a **quota someone else can
burn**, so these are build requirements rather than polish.

## Trust boundaries

```
public internet
  │
  ├─ static PWA assets ................... public, cacheable, no data in them
  ├─ GET  /api/health ..................... public
  ├─ GET  /api/auth/google ................ public
  ├─ GET  /api/auth/callback .............. public, CSRF-protected by state cookie
  │
  ├──── requireAccess (session + capability) ─────────────────────────────
  │     ├─ POST /api/auth/signout
  │     ├─ GET  /api/me
  │     │
  │     └──── requireWorkspace (membership → 404 if not a member) ───────
  │           ├─ GET  /api/workspaces/:id/snapshot
  │           └─ POST /api/workspaces/:id/sync
  │
  └─ everything else → 404 JSON (never the SPA shell for /api/*)
```

The unauthenticated list is short and closed. Adding to it needs a reason written in the comment.

## What is enforced today

### Authentication and authorization

- One middleware over every `/api` route, with **no route-level opt-out**. `401` for no session,
  `403` for a role lacking the capability.
- Sessions are **server-side rows**, so sign-out revokes them. A stolen cookie dies with the row.
- Cookies are `httpOnly`, `Secure`, `SameSite=Lax`, `path=/`.
- Session tokens are 32 bytes of `crypto.getRandomValues`, hex-encoded — opaque and not derived
  from anything about the user.
- The OAuth callback is CSRF-protected by a double-submit `httpOnly` state cookie with a 300-second
  lifetime.
- A non-allow-listed account **completes the OAuth flow and is then refused**, receiving no
  workspace data at any point.

### Tenancy isolation

- Every content row carries `workspace_id NOT NULL`. Every repository read and write filters on
  `ctx.workspaceId`, and `ctx` is derived from the session — **there is no code path that can reach
  another workspace's data even by accident.**
- `update*Statement` builders put the workspace filter _inside the statement_, so knowing a row id
  is not enough to touch it.
- `/sync` refuses the whole chunk if any op's `workspaceId` disagrees with the path
  (`workspace_mismatch`) — that is either a client bug or an attempt to write across a tenancy
  boundary.
- A workspace the caller is not a member of returns **`404`, not `403`**, so ids cannot be probed.

See [13](./13-tenancy-and-multi-user.md).

### Input validation

- Every `/sync` body is parsed with a **Zod discriminated union**. A malformed batch is `400`.
- **Every text field is bounded**, and the bound is chosen against D1's 2 MB row ceiling
  (`SQLITE_TOOBIG`) — see the limits table in [08](./08-writes-updates-and-sync.md). `props` is
  capped explicitly so it cannot be used as a side channel for arbitrary state.
- **Reject, never truncate.** An oversized batch is `413`; a too-long title is a per-op rejection.
  Silently dropping data would lose the user's work.
- `sortKey` is validated as a parseable fractional index on the way in, because a poisoned key
  breaks every later key generation for that parent.
- `props` must be **valid JSON** within its size limit, and cell values must match the declared
  property type.
- View filters are validated against the property's type (a `before` operator on a checkbox is
  rejected) and against the property actually belonging to that database.

### Integrity and abuse containment

- **Idempotency**: `applied_ops` keyed by client-minted `op_id`, written in the _same batch_ as the
  data. A replay returns the original outcome. A retry after a timeout — the common case on mobile
  — is always safe.
- **Atomicity**: one `db.batch()` per chunk. Either the whole chunk lands or none of it does.
- **Batch size cap of 25** ops, bounded by D1's 50-queries-per-invocation limit, so one request
  cannot monopolise the database.
- **Cycle detection** on reparenting, so the page tree cannot be made cyclic.
- **Cascade deletes computed in code** with chunked id lists, staying inside D1's 100-bound-parameter
  limit.
- **No stack traces or internal messages in any client response.** `app.onError` logs
  `{ method, path, message, stack }` as JSON and returns a generic `internal_error`.
- **Fail-closed configuration**: production without any required secret, or with `AUTH_DISABLED`
  set, refuses **every request** with `503` and logs the reasons. Never fail open.
- **The test-reset route does not exist in production** — the guard is at route _registration_, so
  there is no code path to it at all.

### Client side

- `credentials: 'same-origin'`. One origin means no CORS surface and one cookie domain.
- `localStorage` holds only a theme string, the client sequence counter, the persisted active-view
  map, and the transient unload op stash. **No tokens, no user data.**
- The `notify` channel reports a server rejection's reason verbatim but never internal detail,
  because the server never sends any.

## Known gaps

These are specified in
[`docs/architecture/production-readiness.md`](../architecture/production-readiness.md) but are
**not in the code**. Listed so you do not go looking for them, and so they are easy to pick up.

| Gap                                         | What is specified                                                                                                                                         | Status                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security headers**                        | HSTS, a strict `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, set explicitly via Hono's `secureHeaders` middleware               | Not present. No `secureHeaders` import in `src/`, no CSP anywhere. The CSP must be tight enough that the Google sign-in redirect still works — **verify, do not assume**. |
| **Rate limiting**                           | A Cloudflare rate-limiting rule in front of the sign-in and callback routes, plus application-level limits on `/sync`                                     | Not present. The per-request op cap is the only throttle.                                                                                                                 |
| **Health check depth**                      | An unauthenticated endpoint that checks **D1 connectivity**                                                                                               | `GET /api/health` returns `{ status: 'ok', time }` without touching the database. Note the path is `/api/health`, not `/healthz`.                                         |
| **Request id in responses**                 | A request id returned to the client so a user report correlates with a log line                                                                           | Not present. Errors are logged with method and path only.                                                                                                                 |
| **Client backoff**                          | Exponential backoff on repeated sync failure, because the free tier is a hard daily ceiling and a runaway loop takes the app down for the rest of the day | Not present — arrives with the Phase 6 flush loop.                                                                                                                        |
| **Sliding session expiry**                  | ~30 days of _inactivity_                                                                                                                                  | Fixed 30 days from sign-in.                                                                                                                                               |
| **Sign-out clearing service-worker caches** | Sign-out drops the SW caches so a shared or lost device cannot show the previous person's workspace                                                       | `handleSignOut` does a full page reload but does not clear caches. Only the app shell is precached today (no API responses), which limits the exposure.                   |

HTTPS itself is inherent on Workers, so transport security is not on this list.

## Threats the design deliberately accepts

Knowing what is _not_ defended is as useful as knowing what is:

- **Last-write-wins data loss between two of your own devices, both offline, same page.** This is
  the one real data-loss path in the design. It is made **visible** (`versionMismatches` in the
  sync response) rather than silent, and turning on true optimistic concurrency is a one-line change
  plus a resolution UI. See [08](./08-writes-updates-and-sync.md).
- **Permanent deletes with no trash.** Specified by the product contract. An op whose target no
  longer exists is dropped with a reason, never resurrected — recreating deleted ancestors to host
  an orphan would silently undo an explicit deletion.
- **Quota exhaustion as a denial of service.** The free tier is a hard daily ceiling, not a bill, so
  a runaway loop degrades to errors rather than a surprise invoice — but it does take the app down
  for the rest of the day. Client backoff is the mitigation, and it is a gap above.
- **Image blocks are base64 data URLs in `props`**, capped at 2 MB. Uploads to R2 would be the
  answer at scale; D1 must never hold blobs.

## Rules for writing secure code here

1. **Never build a query without `ctx`.** A missing `workspace_id` in a `WHERE` is a tenancy defect.
2. **Validate and bound every input.** Reject, never truncate. Put the limit in
   `src/sync/ops.ts` as a named exported constant with a comment saying why that number.
3. **Never return internal detail.** Log it; return a generic message.
4. **Never log secrets, tokens or page content.** Structured JSON logs only.
5. **Fail closed.** A missing configuration value refuses to serve; it does not fall back to an
   insecure default.
6. **Guard test-only code at registration, not inside the handler**, so no production request can
   reach it.
7. **Multi-statement writes go in one `runBatch()`.** A partially applied chunk is a correctness and
   an integrity problem.
8. **Keep the unauthenticated surface list closed.** Adding to it needs a written reason.
9. **Mirror server limits on the client** so a rejection is not how the user finds out — but never
   _rely_ on the client check.

## Running a security review

The `/security-review` skill reviews the pending changes on the current branch. The adversary
subagent's findings live in [ADVERSARIAL_REVIEW.md](../../ADVERSARIAL_REVIEW.md) and accepted ones
become entries in [DEFECTS.md](../../DEFECTS.md). Both ledgers have a strict format — see
[16](./16-conventions-and-workflow.md).

## Next

- [13 — Tenancy and multi-user](./13-tenancy-and-multi-user.md)
- [15 — Deployment and operations](./15-deployment-and-operations.md)
