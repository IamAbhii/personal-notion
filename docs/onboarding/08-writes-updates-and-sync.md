# 08 — Writes, updates and sync

This is the most important page in the guide. Every mutation in the product goes through the path
described here, and it is the part of the design that is least like a conventional CRUD app.

Authoritative decision record: [`docs/architecture/offline-sync.md`](../architecture/offline-sync.md).

## First: there are no webhooks

Nothing in this system uses webhooks, WebSockets, Server-Sent Events, Durable Objects or any push
channel. There is no external service calling in, and there is no server-to-client push. If you
came looking for a webhook handler, there isn't one, and that is by design:

- The app is **single-user and offline-first**. The client is the source of intent; the server is a
  durable, idempotent sink.
- **Durable Objects require the paid plan**, and they are the natural vehicle for future realtime
  collaboration. That future therefore carries a USD 5/mo floor — noted in
  [`docs/architecture/d1-constraints.md`](../architecture/d1-constraints.md) so it is not a surprise.

How a change made elsewhere reaches a client is covered in
[Update propagation](#update-propagation-how-a-change-reaches-another-tab) below: it is polling and
refetching, not pushing.

## Ops: the only write path

Every mutation is an **intent-based operation**, not a replayed HTTP call. There are no REST write
endpoints — no `POST /pages`, no `PATCH /blocks/:id`. One endpoint takes them all:

```
POST /api/workspaces/:workspaceId/sync   { ops: [...] }
```

**This was true from the first line of product code, not retrofitted.** Phases 1–5 build an op and
post it immediately, awaiting the result; the durable queue is a Phase 6 addition _underneath_ the
same shape. Building on plain REST mutations and converting later would mean rewriting every write
path in the product — the editor's autosave, every drag-reorder, every cell and property edit. This
ordering is deliberate; do not "simplify" it away.

### The envelope

```ts
{
  opId: string,          // client-minted UUID — the idempotency key
  workspaceId: string,   // must match the path, or the whole chunk is refused
  entity: 'page' | 'block' | 'property' | 'value' | 'view',
  entityId: string,      // client-minted UUID (or `${rowPageId}:${propertyId}` for value.set)
  type: string,          // e.g. 'page.update'
  payload: object,        // field-level, not a whole document
  baseVersion: number,    // the version the client believed it was editing (0 for a create)
  clientSeq: number,      // monotonic per device — gives the queue a total order
  createdAt: number
}
```

Four properties of that envelope do real work:

- **`opId` is client-minted**, so the server can recognise a retry. This is what makes a timeout on
  mobile safe.
- **`entityId` is client-minted** too, so a page created offline is immediately linkable and
  nestable and sync never has to remap ids. This is why every id in the schema is a UUID rather
  than an autoincrement integer.
- **`clientSeq`** is persisted in `localStorage` (`personal-space:clientSeq`), so the device's total
  order survives a reload.
- **`baseVersion`** carries optimistic-concurrency information that is _reported but not enforced_
  — see [Concurrency](#concurrency-last-write-wins-but-reported).

### The thirteen op types

| Entity     | Types                                                   | Notes                                              |
| ---------- | ------------------------------------------------------- | -------------------------------------------------- |
| `page`     | `page.create`, `page.update`, `page.delete`             | Covers pages, databases and rows. Delete cascades. |
| `block`    | `block.create`, `block.update`, `block.delete`          |                                                    |
| `property` | `property.create`, `property.update`, `property.delete` | A database column                                  |
| `value`    | `value.set`                                             | Upsert of one cell; there is no `value.delete`     |
| `view`     | `view.create`, `view.update`, `view.delete`             |                                                    |

Declared as a Zod **discriminated union on `type`** in
`packages/worker/src/sync/ops.ts` (`opSchema`), so each type gets its own payload schema.

### Payloads are field-level

A `page.update` payload is a _subset_ of the editable fields. A drag-reorder is one `block.update`
carrying only `sortKey`. A rename carries only `title`. This is not cosmetic: fine-grained ops mean
two edits to different parts of one page can be merged by a future implementation instead of
clobbering, and a whole-document PUT would foreclose that.

Some fields are declared in the payload schema **specifically so their presence can be rejected**
rather than silently stripped:

| Rejected                          | Reason                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `page.update` carrying `kind`     | A page cannot change kind                                       |
| `block.update` carrying `pageId`  | Moving a block between pages is not in scope                    |
| `property.update` carrying `type` | A property's type is fixed; changing it needs a value migration |
| `view.update` carrying `kind`     | Kind changes would require migrating dependent UI state         |

Silently ignoring a field leaves the client believing the change happened. Rejecting tells it.

## The client side

```
component
  └── hooks/use*Mutations.ts       one React Query mutation per op, then invalidate
        └── sync/*Ops.ts           named builder → buildOp() → the envelope
              └── sync/ops.ts      submitOps()
                    └── api/client.ts  apiPost('/api/workspaces/:id/sync', { ops })
```

`sync/` has one builder module per entity: `pageOps.ts`, `blockOps.ts`, `propertyOps.ts`,
`viewOps.ts`. Each function is a thin named wrapper over `buildOp`, so **no caller ever assembles
an op literal by hand** and every op in the app has the same shape.

```ts
export function buildPageUpdateOp(args: {
  workspaceId: string;
  pageId: string;
  baseVersion: number;
  changes: PageUpdatePayload;
}): Op<PageUpdatePayload>;
```

`submitOps` asserts the 25-op limit client-side ("it is the server's contract, not a suggestion")
and throws `OpRejectedError` if the server rejected any op in the batch — carrying all the results,
so `lib/errors.ts` can build a message from the server's own reasons.

### Autosave

`hooks/useAutosavedText.ts`: there is no save button anywhere in the app. A settled edit is written
once after `delayMs` rather than once per keystroke, and any pending write is flushed on **blur and
on unmount**, which is what makes navigating away mid-sentence safe.

## The unload boundary — read this before touching the editor

Closing the gap between "user typed" and "op reached the server" at page unload took three separate
discoveries, all of which will bite any later feature that tries to write at unload. They are
recorded here and in [`docs/architecture/offline-sync.md`](../architecture/offline-sync.md) so they
are not rediscovered.

1. **`visibilitychange` is not a reliable unload signal in Chromium.** `pagehide` fires while
   `document.visibilityState` is still `visible`, so a handler that checks visibility never sees the
   unload at all. An explicit "am I leaving" flag, installed before anything mounts, is what works —
   that is `watchForUnload()` in `sync/ops.ts`, called from `main.tsx` before React mounts. Listener
   order for one event on one target is registration order, so it runs ahead of every editor's own
   flush listener. Both `pagehide` **and** `visibilitychange` are needed: on a phone an app switch is
   often all the warning there is, with no `pagehide` at all. `pageshow` clears the flag, because a
   back/forward-cache restore means the page is alive again.

2. **A flush must start its request in the caller's own synchronous step.** Going through the
   mutation layer starts the `fetch` a microtask later — after the navigation is committed — and the
   browser discards it. `keepalive` is necessary but not sufficient. Measured, not assumed.

3. **A service worker voids both of the above.** When a service worker controls the page, Chromium
   drops a request routed through it once its client is gone. Proved by running the same steps with
   service workers blocked (the edit lands) and allowed (the edit is lost). Since this app is a PWA,
   **no unload-time network write can be relied on at all.**

So the unload flush **writes unsent ops to `localStorage` synchronously and replays them on first
render after the reload**:

```ts
submitOnUnload(workspaceId, ops); // stash synchronously, then fire-and-forget the POST
flushStashedOps(workspaceId); // called from a WorkspaceShell effect on first render
```

- `stashOps` swallows `QuotaExceededError` rather than throwing at unload — one large image op can
  hit the 5 MB origin cap, and an unhandled throw at unload is unrecoverable.
- `flushStashedOps` clears the stash **before** the attempt: a replayed op is safe (the server's
  `applied_ops` table makes it a no-op) but an op the server refuses must not be retried on every
  start for ever.
- If the fire-and-forget POST _did_ land (a backgrounded tab is still alive), its ops are removed
  from the stash, so the stash does not grow across a day of tab switching.

This is deliberately a step into Phase 6's territory, taken early because the defect it closes
cannot otherwise be fixed in a service-worker PWA, and it is deliberately the smallest possible
version: a synchronous stash and a replay. No queue, no flush loop, no ordering guarantees beyond
the `clientSeq` the ops already carry. **Phase 6 replaces it rather than building on it.**

## The server side: `applyOps`

`packages/worker/src/sync/apply.ts` (~1100 lines) is the heart of the backend. Read its header
comment first; the shape is:

1. **Sort the chunk by `clientSeq`.** A later op may depend on an earlier one — a child created
   under a page created in the same chunk — so order matters.
2. **One lookup of `applied_ops`** for all the op ids in the chunk.
3. **Five reads** — pages, blocks, properties, values, views — in parallel, into in-memory `Map`s.
   **Then every decision is made in memory.** Doing it per op would spend the whole D1 query budget
   on lookups.
4. **Project as you go.** Each op's effect is applied to the in-memory state _and_ appended as a
   statement, so a later op in the same chunk sees the earlier one's result — that is how creating a
   page and its first block in one chunk works, and how three appended siblings get correctly
   increasing sort keys.
5. **One `db.batch()`** for every data statement plus the `applied_ops` rows. Either the whole chunk
   lands or none of it does, which is what lets the client retry a chunk safely.
6. **Return one result per op**, in the order they were given, plus `versionMismatches` and a fresh
   `etag`.

### Statuses

```ts
type OpStatus = 'applied' | 'replayed' | 'rejected';
```

- **`applied`** — it happened; `version` is the resulting row version.
- **`replayed`** — this `opId` was already applied; the **original outcome** is returned rather than
  applying it twice. A duplicate `opId` appearing twice in the _same_ batch also reports a replay for
  the second occurrence — results are keyed by op object, not by op id, so each occurrence gets its
  own line.
- **`rejected`** — with a `reason`. The write did not happen.

### Why rejection is per-op and not per-batch

A malformed _batch_ fails with `400`. A bad _field_ in one op costs the client only that op. That is
why `payloadRejection()` in `sync/ops.ts` does membership and length checks imperatively rather than
as Zod constraints — an unknown block type from a client that is newer than the server should cost
that one op, not the user's other 24 edits.

Rejection reasons you will meet:

| Reason                                    | Cause                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| target does not exist                     | The page/block/row was deleted (possibly by a cascade)                                                                          |
| `unknown block type`                      | `type` not in `BLOCK_TYPES`                                                                                                     |
| `sortKey is not a valid fractional index` | A key the library cannot extend — refused at the door, because a poisoned key breaks every later key generation for that parent |
| `a page cannot change kind`               | See the rejected-fields table above                                                                                             |
| `a block cannot be moved between pages`   | Same                                                                                                                            |
| `a property's type cannot be changed`     | Same                                                                                                                            |
| length limits                             | See below                                                                                                                       |
| filter/sort validation                    | A filter's property is not in that database, or its operator is illegal for the property's type                                 |

**An op whose target no longer exists is dropped, not resurrected.** Delete a parent page on one
device and add a child under it on another: on sync the child's op refers to a missing parent, the
server rejects it with a reason, the client drops it and tells the user what was lost. Recreating
deleted ancestors to host an orphan would silently undo an explicit deletion, which is worse.

### Every limit, and why

All in `packages/worker/src/sync/ops.ts`. Each is bounded so a request cannot hit D1's 2 MB row
ceiling (`SQLITE_TOOBIG`) or be used as a side channel.

| Constant                      | Value     | Applies to                                          |
| ----------------------------- | --------- | --------------------------------------------------- |
| `MAX_OPS_PER_BATCH`           | 25        | Ops per `/sync` request (D1: 50 queries/invocation) |
| `MAX_TITLE_LENGTH`            | 500       | Page titles                                         |
| `MAX_ICON_LENGTH`             | 32        | Page icons (room for ZWJ/skin-tone sequences)       |
| `MAX_BLOCK_TEXT_LENGTH`       | 10,000    | Block text                                          |
| `MAX_BLOCK_PROPS_LENGTH`      | 1,000     | Block `props` JSON                                  |
| `MAX_IMAGE_PROPS_LENGTH`      | 2,000,000 | Image block `props` (base64 data URL)               |
| `MAX_PROPERTY_NAME_LENGTH`    | 100       | Property names                                      |
| `MAX_PROPERTIES_PER_DATABASE` | 50        | Properties per database                             |
| `MAX_OPTIONS_PER_PROPERTY`    | 50        | Select/multiSelect options                          |
| `MAX_OPTION_NAME_LENGTH`      | 100       | Option names                                        |
| `MAX_VALUE_LENGTH`            | 2,000     | A cell's JSON-encoded value                         |
| `MAX_VIEW_NAME_LENGTH`        | 200       | View names                                          |

Note the `block.update` subtlety: a props-only update may omit `type`, so the applier passes the
**stored** block type into `payloadRejection` as `storedBlockType`, and the props ceiling is chosen
from the effective type. Without that, updating an image block's props would be capped at 1,000
characters.

`lib/blocks.ts` mirrors some of these limits client-side, clamping on code-point boundaries, so a
rejection is not how the user finds out.

### Cascades and integrity handled in the applier

- **Delete cascades over the subtree** — `subtreeIds()` walks projected state, so a delete also
  removes children created earlier in the _same_ chunk. The cascade is expressed in code rather
  than as `ON DELETE CASCADE`, because SQLite runs that as a trigger and D1 caps trigger recursion
  at nine levels while pages nest to any depth (migration `0002`).
- **Cycle detection** — `createsCycle()` refuses a reparent that would make the tree cyclic.
- **Dangling option cleanup** — removing a select option emits upserts in the _same batch_ that
  clear or filter every value referencing it (select → `null`; multiSelect → the id is dropped, an
  emptied array becomes `null`).
- **Deleting a database** cascades to its properties, values and views.

## Idempotency

`applied_ops` records every op id with its entity, type, status, reason, result version and
`client_seq`. Its insert goes into the **same batch** as the op's own writes, so the log and the
data can never disagree.

Because `applied_ops` binds 10 parameters per row and D1 allows 100 per query, outcomes are written
as multi-row inserts of at most 10 rows (`OP_RECORDS_PER_INSERT`). Without that, a 25-op chunk would
need 25 extra statements and blow the 50-query limit.

**Deletes are ops too**, and permanent (there is no trash), but the `opId` lives on in `applied_ops`
so a replayed delete is a no-op rather than an error.

## Concurrency: last write wins, but reported

Concurrent editing is **not** built. The policy is last-write-wins by server arrival order. What the
design carries for later:

- Every content row has a `version` integer, bumped on every write, and `updated_at`.
- Every op carries `baseVersion`. The server **applies the op regardless** but **reports every
  mismatch** in `versionMismatches`, so the client can surface "3 changes overwrote newer edits".
- This is the one real data-loss path in the design — two of your own devices, both offline, same
  page — and it costs almost nothing to make visible rather than silent.
- Turning on true optimistic concurrency later means **refusing** on mismatch instead of reporting
  it: one line, plus a resolution UI.
- The op log is append-only and ordered, which is the substrate any future CRDT or
  operational-transform layer would need.

## Update propagation: how a change reaches another tab

There is no push. Three mechanisms, in order of how often they fire:

1. **After your own write** — the mutation hook calls
   `invalidateQueries({ queryKey: queryKeys.snapshot(userId, workspaceId) })`, forcing an immediate
   refetch. This is why your edit appears and why it survives a refresh.
2. **`refetchInterval: 30_000`** on the snapshot query — background polling, so a change made in
   another tab (a deleted row, a cell edited in another session) appears within 30 seconds with no
   interaction at all.
3. **`refetchOnWindowFocus`** (TanStack Query's default for that query) — switching back to the tab
   refetches.

The ETag makes all three cheap: an unchanged workspace answers `304` from SQL aggregates without
building the payload. See [07](./07-api-contract.md).

## What Phase 6 will add

Named here so you can recognise the `// Future:` markers when you meet them:

- **IndexedDB** (via `idb` or Dexie, not hand-rolled) holding a copy of the workspace _and_ the
  pending write queue, namespaced by `(userId, workspaceId)`; sign-out clears that namespace.
- **TanStack Query backed by that store** as its persister.
- **Optimistic + durable**: an op is applied to local state and persisted to IndexedDB in the same
  step, _before_ any network attempt.
- **A bounded flush loop**: on the `online` event, on app start and on window focus, POST the queue
  in `clientSeq` order, **at most 25 ops per request, one chunk at a time, strictly in order** —
  never in parallel, or ops would land out of sequence. Chunk N+1 only after N is acknowledged; a
  failed chunk stops the flush and leaves the rest queued.
- **Coalescing**: an unsent op targeting the same `(entity, entityId, field)` **replaces** the
  pending one rather than appending. Without this, an hour offline on one page yields thousands of
  queued ops describing a paragraph, and the 25-op chunk limit turns it into dozens of sequential
  round trips. Only ops already in flight are immutable.
- **Exponential backoff** on repeated sync failure. The free tier is a hard daily ceiling, not a
  bill, so a runaway retry loop takes the app down for the rest of the day.
- **A visible sync status**: synced / N pending / offline / failed, with rejected ops surfaced to
  the user, removed from the queue, and local state reconciled from the server.
- **Background Sync** as a progressive enhancement where supported, never the only trigger.

## How to add a new op type

1. Add the payload schema and a `z.literal` arm to `opSchema` in `packages/worker/src/sync/ops.ts`.
2. Add any limits as exported constants, and the imperative checks to `payloadRejection()` —
   remember: per-op rejection, not a Zod constraint, for anything a newer client might legitimately
   send.
3. Handle it in `applyOps`: read the projected state, validate against it, push the data statement,
   record the `AppliedOpRecord`, update the in-memory map so later ops in the chunk see it.
4. Add the `*Statement` builder to the relevant `repo/` module if the write shape is new. Never
   build SQL in the applier.
5. Mirror the payload type in `packages/frontend/src/api/types.ts`.
6. Add a named builder in `packages/frontend/src/sync/*Ops.ts`.
7. Wire it into the matching `hooks/use*Mutations.ts`, following the five rules in
   [04](./04-state-management.md).
8. Tests: worker unit test for apply + rejection paths, frontend unit test for the builder and the
   hook, and an e2e spec if there is a visible surface.

## Next

- [09 — Backend architecture](./09-backend-architecture.md)
- [10 — Data layer and database](./10-data-layer-and-database.md)
