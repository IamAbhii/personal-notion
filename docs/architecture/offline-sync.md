# Offline and sync (fixed)

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

## Concurrency: out of scope now, designed for later

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
- Every place these assumptions bite must carry a `// Future:` comment (see [Code comments](./comments.md)).

## The unload boundary, and why an op stash exists before Phase 6 (fixed, Phase 2)

Phase 2's autosave debounces text edits into one op per settled edit and flushes on blur. DEF-013 was
the gap that leaves: keystrokes inside the debounce window were lost when the tab reloaded. Closing it
turned out to need three separate discoveries, all of which will bite any later feature that tries to
write at unload, so they are recorded here rather than rediscovered.

- **`visibilitychange` is not a reliable unload signal in Chromium.** `pagehide` fires while
  `document.visibilityState` is still `visible`, so a handler that checks visibility never sees the
  unload at all. An explicit "am I leaving" flag, installed before anything mounts, is what works.
- **A flush must start its request in the caller's own synchronous step.** Going through the mutation
  layer starts the `fetch` a microtask later — after the navigation is committed — and the browser
  discards it. `keepalive` on the request is necessary but not sufficient.
- **A service worker voids all of the above.** When a service worker controls the page, Chromium drops
  a request routed through it once its client is gone. Proved by running the same steps with service
  workers blocked (the edit lands) and allowed (the edit is lost). Since this app is a PWA, no
  unload-time network write can be relied on at all.

So the flush **writes unsent ops to `localStorage` synchronously and replays them on first render
after the reload**, which is safe because the server recognises a replayed `opId` and returns the
original outcome. This is deliberately a step into Phase 6's territory, taken early because DEF-013
cannot otherwise be closed in a service-worker PWA, and it is deliberately the smallest possible
version: a synchronous stash and a replay, no queue, no flush loop, no ordering guarantees beyond the
`clientSeq` the ops already carry.

**Phase 6 replaces the stash rather than building on it.** The durable IndexedDB queue is the real
answer and subsumes this: append locally, apply optimistically, flush in chunks in `clientSeq` order.
The stash's job until then is to make the unload boundary lossless. Its call site carries a
`// Future:` comment naming the replacement.
