# 07 — The API

The API is small on purpose: **two reads and one write**. Everything else the product does is
expressed through those three endpoints, plus three auth endpoints and a health check.

Authoritative decision record: [`docs/architecture/tenancy.md`](../architecture/tenancy.md#api-contract-fixed).

## Every endpoint

| Method | Path                                      | Auth    | Purpose                                              |
| ------ | ----------------------------------------- | ------- | ---------------------------------------------------- |
| GET    | `/api/health`                             | none    | Liveness for deploys and uptime checks               |
| GET    | `/api/auth/google`                        | none    | Starts the Google OAuth redirect flow                |
| GET    | `/api/auth/callback`                      | none    | Google's redirect target; issues a session           |
| POST   | `/api/auth/signout`                       | session | Deletes the session row server-side                  |
| GET    | `/api/me`                                 | session | The user and their workspace memberships             |
| GET    | `/api/workspaces/:workspaceId/snapshot`   | member  | The **entire** workspace in one response             |
| POST   | `/api/workspaces/:workspaceId/sync`       | member  | The **only** write path — a batch of ops             |
| POST   | `/api/workspaces/:workspaceId/test/reset` | bypass  | E2E reset; registered only when `AUTH_DISABLED=true` |
| *      | `/api/*` (anything else)                  | —       | JSON `404`, never the SPA shell                      |
| *      | everything else                           | none    | The PWA static assets                                |

The unauthenticated surfaces are exactly: the sign-in screen, the OAuth endpoints, the health
endpoint, and the static assets. Everything else requires a session. Registration order in
`packages/worker/src/index.ts` is what enforces that — the auth routes and health are mounted
_before_ `app.use('/api/*', requireAccess)`.

## Every data route is workspace-scoped, today, with one workspace

`/api/workspaces/:workspaceId/...` is not "flat now, scoped later". A route reshape is exactly the
breaking change the design exists to avoid. `:workspaceId` is validated against the session's
memberships on **every** request, and a workspace the caller is not a member of returns **`404`, not
`403`** — so workspace ids cannot be probed. See [13](./13-tenancy-and-multi-user.md).

There is deliberately **no search endpoint** (search is client-side) and **no REST write
endpoints** (all writes are ops).

## `GET /api/me`

```jsonc
{
  "user": { "id": "…", "email": "…", "name": "…" },
  "memberships": [{ "workspaceId": "…", "name": "My Space", "role": "owner" }],
}
```

`memberships` is an **array** today with one element. The client picks its workspace from the list;
it never hardcodes an id and never treats `memberships[0]` as an invariant. A client that does is a
defect under the tenancy rules.

This endpoint is also **the one place a workspace is created and seeded**. A resolved user with no
workspace yet gets one created, its membership row written, and the seed template applied in the
same request — so first launch is populated with no extra start step
(`packages/worker/src/routes/me.ts`).

## `GET /api/workspaces/:workspaceId/snapshot`

The whole workspace: the page tree, every block, properties, values and views, each with its
`version`. This is the only read the app needs on cold start, and what it would store locally to
work offline.

```jsonc
{
  "pages":      [{ "id", "parentId", "title", "icon", "sortKey", "kind", "version", "updatedAt" }],
  "blocks":     [{ "id", "pageId", "type", "text", "checked", "props", "sortKey", "version", … }],
  "properties": [{ "id", "databasePageId", "name", "type", "options", "sortKey", "version", … }],
  "values":     [{ "rowPageId", "propertyId", "value", "version", … }],
  "views":      [{ "id", "databasePageId", "name", "kind", "groupPropertyId",
                   "filters", "sort", "sortKey", "version", … }]
}
```

Response headers: `ETag` and `Cache-Control: no-store`.

Things worth knowing about the shape:

- **Flat arrays, already in sort order.** The client builds the tree from `parentId` and groups
  blocks by `pageId`; the server never nests. One query per entity type.
- **The server parses the JSON columns for you.** `properties.options`, `views.filters` and
  `views.sort` are stored as JSON strings in D1 but arrive as real arrays and objects, so the client
  never deserialises a nested JSON string. A corrupted row parses to `[]`/`null` rather than
  breaking the whole snapshot.
- **`checked` is a real boolean** on the wire, though SQLite stores 0/1.
- **`updatedAt` is typed `number | string`** on the client, because the server sends epoch
  milliseconds but D1 has historically stored timestamps both ways and both are accepted by
  `new Date(...)`.

### The ETag, and why it is computed first

```ts
const etag = await computeSnapshotEtag(db, ctx);
if (c.req.header('If-None-Match') === etag) return c.body(null, 304, { ETag: etag });
```

This handler is the one most likely to hit Workers' **10 ms CPU per invocation** on the free plan,
so an unchanged workspace must answer `304` **without building the payload at all**.

The ETag is not a hash of the payload. It is computed from cheap SQL aggregates — for each entity,
the row count, the sum of every row's `version`, and the newest `updated_at`. Any insert, update or
delete moves at least one of the three, so a view-filter change changes the ETag as surely as a page
rename does, at one query per entity.

The value carries a **format prefix** (`p4-`). When a new sibling entity lands, aggregate it and
**bump the prefix**, so a client holding an older ETag cannot match one of the new ones and gets a
full snapshot rather than a `304` with stale content.

## `POST /api/workspaces/:workspaceId/sync`

The only write path. Request:

```jsonc
{ "ops": [ { "opId", "workspaceId", "entity", "entityId", "type", "payload",
             "baseVersion", "clientSeq", "createdAt" } ] }
```

Response:

```jsonc
{
  "results": [ { "opId", "status": "applied" | "rejected" | "replayed", "reason", "entityId", … } ],
  "versionMismatches": [ … ],
  "etag": "p4-…"
}
```

The full op catalogue, payload shapes, validation limits and rejection semantics are in
[08 — Writes, updates and sync](./08-writes-updates-and-sync.md). What belongs on this page is the
endpoint's contract:

| Condition                                          | Status | Body `error`         |
| -------------------------------------------------- | ------ | -------------------- |
| Body fails the Zod schema                          | `400`  | `invalid_request`    |
| More than **25** ops in one chunk                  | `413`  | `batch_too_large`    |
| Any op's `workspaceId` differs from the path       | `400`  | `workspace_mismatch` |
| Valid batch (individual ops may still be rejected) | `200`  | —                    |

Note the asymmetry, and it is deliberate: a **malformed batch** fails the whole request, while a
**bad field in one op** costs the client only that op, reported per-op in `results`. That is why
things like block-type membership and length limits are checked in `payloadRejection()` rather than
expressed as Zod constraints.

An oversized chunk is **refused, never truncated** — silently dropping ops would lose the user's
work. 25 is the limit because D1 allows 50 queries per Worker invocation on the free plan.

## Error shapes

Every error response is JSON with `error` and `message`. Nothing leaks a stack trace or an internal
message; detail goes to the log, not the caller.

| Status | `error`               | Means                                                                                |
| ------ | --------------------- | ------------------------------------------------------------------------------------ |
| `401`  | `unauthorized`        | No usable session. The frontend renders `SignInScreen`.                              |
| `403`  | `account_not_allowed` | Authenticated, but not the allow-listed account                                      |
| `403`  | `forbidden`           | Known caller whose role lacks the needed capability                                  |
| `404`  | `not_found`           | Unknown endpoint, **or** a workspace the caller cannot see                           |
| `413`  | `batch_too_large`     | More than 25 ops                                                                     |
| `503`  | `misconfigured`       | Fail-closed config check refused to serve — see [11](./11-auth-and-authorization.md) |
| `500`  | `internal_error`      | Unhandled throw; logged with method, path, message and stack                         |

`app.onError` in `index.ts` guarantees the `500` shape, so no route can answer with Hono's default
plain-text "Internal Server Error" — clients parse JSON, and a bare 500 tells nobody anything.

Unknown `/api/*` paths return a JSON `404` rather than falling through to the SPA shell, so a
mistyped fetch fails loudly instead of receiving HTML.

## The client side

### `src/api/client.ts` — the only place `fetch` happens

```ts
export class ApiError extends Error {
  readonly status: number;
}
export async function apiGet<T>(path: string): Promise<T>;
export async function apiPost<T>(path: string, body: unknown): Promise<T>;
```

- `credentials: 'same-origin'` so the session cookie rides along. The API and the app share one
  origin, so there is no CORS and no cross-site cookie problem.
- Any non-2xx throws an `ApiError` carrying the status, so callers branch on `error.status` rather
  than on message text. `StatusScreens.AppError` uses exactly that to turn a `401` into the sign-in
  screen.
- **`keepalive` is conditional**, and this is the subtle part:

  ```ts
  export const KEEPALIVE_MAX_BODY_BYTES = 60_000;
  const useKeepalive = json.length < KEEPALIVE_MAX_BODY_BYTES;
  ```

  The Fetch spec caps the total body size of all in-flight `keepalive` requests at 64 KiB. A larger
  body makes `fetch()` reject **immediately** with a `TypeError` ("Failed to fetch") before any
  bytes go on the wire. Base64 image blocks are 200–600 KB, so they always hit the cap. Keepalive is
  kept on small writes (where it buys unload survival) and omitted on large ones (where it would
  cause a false "you are offline" failure). `lib/errors.ts` knows about this too — it only reports
  "offline" when `navigator.onLine` confirms it.

### `src/api/types.ts` — the wire contract

The types mirror the server responses exactly, so nothing reshapes data at the boundary. They also
re-export the shared enumerations (`PageKind`, `PropertyType`, `OPTION_COLORS`, `FilterOperator`,
`ViewKind`, op payload types) that the worker declares in `src/sync/ops.ts`.

**These two files are hand-kept in sync.** There is no code generation and no shared package. If you
change an op payload or a snapshot field on the server, you must change
`packages/frontend/src/api/types.ts` too — `npm run typecheck` will not catch a mismatch across the
HTTP boundary.

### `src/api/queries.ts` — query options

Covered in [04 — State management](./04-state-management.md).

## Adding an endpoint

Think twice — the small surface is a feature. But when it is genuinely needed:

1. Put it under `/api/workspaces/:workspaceId/` and mount it behind `requireWorkspace`.
2. Take `ctx` from `c.var.ctx` and pass it to a repository function. Never build a query in a route.
3. Validate the body with Zod and bound every field. Reject, never truncate.
4. Doc-comment the handler with what it does and why ([16](./16-conventions-and-workflow.md)).
5. If it is a **write**, stop: it should almost certainly be an op type instead. See
   [08](./08-writes-updates-and-sync.md).
6. Mirror the types in `packages/frontend/src/api/types.ts`.
7. Add a worker unit test hitting it through the real router.

## Next

- [08 — Writes, updates and sync](./08-writes-updates-and-sync.md)
- [09 — Backend architecture](./09-backend-architecture.md)
