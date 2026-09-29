# 10 — Data layer and database

Cloudflare D1 (managed SQLite), accessed through Drizzle ORM over the D1 binding, behind a
repository layer that is the only place SQL is built.

Authoritative decision records:
[`docs/architecture/d1-constraints.md`](../architecture/d1-constraints.md) and
[`docs/architecture/data-model.md`](../architecture/data-model.md).

## D1's constraints shape everything here

These are not footnotes. Each one has a design consequence, and ignoring it produces code that
works locally and fails in production.

| Constraint (free plan)                 | Consequence in this codebase                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No interactive transactions**        | Atomicity comes from `db.batch([...])`. Every multi-statement write goes through `runBatch()`. Code that assumes an open transaction is a defect.                           |
| **50 queries per invocation**          | `/sync` chunks at 25 ops and rejects more with `413`. `applyOps` does 5 reads then decides everything in memory. `applied_ops` rows are written as multi-row inserts of 10. |
| **10 ms CPU per invocation**           | No heavy loops in a handler. The snapshot ETag is SQL aggregates, not a payload hash.                                                                                       |
| **100 bound parameters per query**     | Id lists in `DELETE … WHERE id IN (…)` are chunked (`repo/pages.ts`).                                                                                                       |
| **2 MB max row size**                  | Every text field in the op schema has a length limit ([08](./08-writes-updates-and-sync.md)).                                                                               |
| **100 columns per table**              | Database properties are **rows, not columns**.                                                                                                                              |
| **500 MB per DB, 5 GB per account**    | Ample for text. Uploads would go to R2, never into D1 as blobs.                                                                                                             |
| **Single-threaded per database**       | Another reason sync arrives in bounded chunks rather than one enormous batch.                                                                                               |
| **No FTS5 index in use**               | Search is client-side over the local copy. D1 _does_ support FTS5 — the trigger for revisiting is searching _inside block content_, and nothing else.                       |
| **Durable Objects need the paid plan** | Realtime collaboration carries a USD 5/mo floor. Noted, not a surprise later.                                                                                               |

## The schema

Nine tables. `packages/worker/migrations/*.sql` is the **source of truth**;
`packages/worker/src/db/schema.ts` is the Drizzle mirror the repository layer talks through. They
are hand-kept in sync — Drizzle is not generating the migrations here.

### Identity and tenancy

```
users              id, google_sub (UNIQUE), email (UNIQUE), name, created_at
workspaces         id, name, created_at
workspace_members  (workspace_id, user_id) PK, role, created_at
sessions           id, user_id, created_at, expires_at
```

`google_sub` is the stable identity, not the email — people change emails. (Today
`findUserByEmail` is the lookup, with a `// Future:` comment saying to match on `google_sub`
instead.)

### Idempotency

```
applied_ops        op_id PK, workspace_id, entity, entity_id, type,
                   status, reason, result_version, client_seq, applied_at
```

### Content

```
pages              id, workspace_id, parent_id, title, icon, sort_key,
                   kind ('page'|'database'|'row'), version, created_at, updated_at
blocks             id, workspace_id, page_id, type, text, checked (0/1),
                   props (JSON string), sort_key, version, created_at, updated_at
properties         id, workspace_id, database_page_id, name, type,
                   options (JSON string), sort_key, version, created_at, updated_at
property_values    (row_page_id, property_id) PK, workspace_id, value,
                   version, created_at, updated_at
views              id, workspace_id, database_page_id, name, kind,
                   group_property_id, filters (JSON, default '[]'), sort (JSON|null),
                   sort_key, version, created_at, updated_at
```

### Conventions, all deliberate

- **Ids are UUID `TEXT` everywhere.** The client mints entity ids offline, so autoincrement is not
  an option; and globally unique ids mean nothing collides if workspaces are ever merged, exported
  or moved.
- **Timestamps are integer epoch milliseconds.** SQLite has no date type, and ms sorts and diffs
  directly.
- **Booleans are 0/1 integers** (`blocks.checked`), converted on the wire by the snapshot.
- **JSON lives in `TEXT` columns** (`blocks.props`, `properties.options`, `views.filters`,
  `views.sort`) and is **parsed server-side** before the snapshot goes out, so the client never
  deserialises a nested JSON string.
- **Every content row carries `workspace_id NOT NULL`, indexed, foreign-keyed.** This is the single
  most important seam in the schema. Adding a tenancy column to a populated table later means a
  migration, a backfill and an audit of every query. See [13](./13-tenancy-and-multi-user.md).
- **Every content row carries `version` (default 1) and `updated_at`.** Bumped on every write. This
  is what makes the ETag cheap and what a future optimistic-concurrency implementation needs.
- **Indexes are composite and match the read order**, e.g.
  `pages_workspace_parent_sort_idx (workspace_id, parent_id, sort_key)`,
  `blocks_workspace_page_sort_idx (workspace_id, page_id, sort_key)`.
- **`property_values` has a composite PK `(row_page_id, property_id)`**, which makes `value.set` an
  upsert — so two devices editing the same cell converge rather than duplicating.

### The one place there is no foreign key, and why

`pages.parent_id` has **no** foreign key. Migration `0002` dropped it, and the header comment
explains:

> SQLite implements `ON DELETE CASCADE` as an internal trigger, and D1 caps trigger recursion at
> nine levels, so deleting a page with ten or more levels of descendants failed with "too many
> levels of trigger recursion" and deleted nothing.

Pages nest to any depth, so the cascade **cannot live in the database**. The repository layer
computes the subtree from the page skeleton it already reads once per request and deletes it with
explicit chunked `DELETE … WHERE id IN (…)` statements. Referential integrity for `parent_id` is
enforced in the sync applier instead: it rejects a create or a move under a parent that does not
exist, and refuses a reparent that would create a cycle.

SQLite cannot drop a foreign key in place, so `0002` is a forward-only table rebuild. That is the
pattern for any future constraint change.

## Migrations

```bash
npm run migrate:local    # wrangler d1 migrations apply personal-space --local
```

- Files: `packages/worker/migrations/NNNN_name.sql`, **forward-only**. There are no down
  migrations, and there is no hand-edited production schema.
- The **same files** run against local D1 in development, in the worker test suite, and in deploy —
  so a migration is exercised before it ships.
- Applied in CI on merge to `main` via `wrangler d1 migrations apply personal-space --remote` before
  the Worker is deployed. See [15](./15-deployment-and-operations.md).

Existing files:

| File                               | Adds                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| `0001_initial_schema.sql`          | users, workspaces, workspace_members, sessions, applied_ops, pages |
| `0002_pages_parent_no_cascade.sql` | Rebuilds `pages` without the self-referencing FK                   |
| `0003_blocks.sql`                  | blocks                                                             |
| `0004_databases.sql`               | `pages.kind`, properties, property_values                          |
| `0005_views.sql`                   | views                                                              |

**When you add one:** write the SQL file, then update `src/db/schema.ts` to match, then run
`npm run migrate:local`. If you change a column the snapshot returns, update
`repo/snapshot.ts`, **bump the ETag format prefix** there, and mirror the type in
`packages/frontend/src/api/types.ts`.

## `db/` — the containment boundary

### `db/client.ts` — twelve lines that matter

```ts
export type Db = ReturnType<typeof createDb>;
export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}
```

> "Nothing above the repository layer sees `env.DB` or any other Workers global, so moving off
> Cloudflare (to Node + SQLite, or Turso) means replacing this file and the repository modules, and
> nothing else."

Called once per request by `requireAccess`, which puts the handle in `c.var.db`.

### `db/batch.ts` — atomicity

```ts
export type Statement = BatchItem<'sqlite'>;
export async function runBatch(db: Db, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements as [Statement, ...Statement[]]);
}
```

Every multi-statement write in the product goes through this. Empty batches are skipped because D1
rejects them, which keeps callers free of "did I build any statements" guards.

## `repo/` — the repository layer

One module per entity: `accounts`, `sessions`, `appliedOps`, `pages`, `blocks`, `properties`,
`propertyValues`, `views`, plus `snapshot`, `reset` and `context`.

### Every function takes `ctx`

```ts
export type Ctx = { userId: string; workspaceId: string; role: Role };
```

`repo/context.ts` defines it, and its comment states the rule:

> It is derived from the session by `resolveAccess` and is the only way a workspace id reaches a
> query, so there is no code path that can read or write another workspace's rows even by accident.

A query without `workspace_id` in its `WHERE` is a defect, not a shortcut.

### The two-flavour convention

This is the pattern to learn, because every repo module follows it:

```ts
// Awaited helpers — for a single write or a read.
export function listPages(db, ctx): Promise<PageRow[]>;
export async function getPage(db, ctx, id): Promise<PageRow | undefined>;

// Row builders — separate from the insert, so the applier can project the new row
// into its in-memory state before the batch runs.
export function buildPageRow(ctx, input, sortKey, now): PageRow;

// *Statement builders — collected by the sync applier into ONE db.batch().
export function insertPageStatement(db, row): Statement;
export function updatePageStatement(db, ctx, id, patch, now): Statement;
export function deletePagesStatements(db, ctx, ids): Statement[]; // chunked

// *States readers — the minimal skeleton the applier needs to decide every op in memory.
export function listPageStates(db, ctx);
```

Three things follow from it:

- **`build*Row` is separate from `insert*Statement`** so `applyOps` can put the new row into its
  projected state map and let later ops in the same chunk see it.
- **`update*Statement` includes the workspace filter in the statement itself**, so an op cannot
  touch another workspace's row even if it knows the id.
- **`list*States` returns a skeleton, not full rows** — just existence, version, parent/page,
  sort key and type. That is what turns "one lookup per op" into "one query per entity".

`deletePagesStatements` chunks its id list (`D1` allows 100 bound parameters per query) and carries
a `// Future:` note: a subtree of more than a few thousand pages would need more statements than the
50-query budget allows, and the change then is one `DELETE` whose id list comes from a recursive CTE
subquery, binding two parameters whatever the subtree's size.

### `repo/snapshot.ts`

`getSnapshot(db, ctx)` — one query per entity type, all in sort order, so the client can group
without sorting. It also parses the JSON columns and converts `checked` to a boolean.

`computeSnapshotEtag(db, ctx)` — a strong ETag from cheap aggregates rather than by hashing the
payload: for each entity the row count, the sum of every row's `version`, and the newest
`updated_at`. Any insert, update or delete moves at least one of the three. The `p4-` prefix
versions the format — **bump it when a new entity joins the snapshot**, so a client holding an older
ETag cannot match and gets a full snapshot rather than a `304` with stale content.

## Fractional ordering — `lib/sortKey.ts`

**Ordering is fractional, not integer positions.** Blocks in a page, rows in a database and pages in
the sidebar each carry a `sort_key` string, and an item is moved by computing a key _between_ its
new neighbours, via the `fractional-indexing` library.

With integer positions, dragging one block rewrites every sibling — one gesture becomes N ops, N
row-writes and N chances for last-write-wins to clobber. Fractional keys make a move **exactly one
op on one row**.

Three helpers, each existing because of a real defect:

```ts
isValidSortKey(key); // "can a key be generated after it" — there is no exported validator
nextKeyAfter(last); // treats an unparseable value as no key at all rather than throwing
compareOrder(a, b); // sort_key first, then id as the tiebreak
lastInOrder(rows); // greatest under compareOrder, skipping unusable keys
```

- **Keys are validated on the way in** (`payloadRejection` refuses an invalid `sortKey`) because an
  unparseable key stored in a row makes every later key generation for that parent throw.
- **And tolerated defensively on the way out** — a row with a bad key predates that validation and
  must not block creation under the same parent.
- **`id` is the tiebreak, and that is what makes duplicate keys harmless rather than impossible.**
  Two concurrent appends each compute their key from the state they read, so they can legitimately
  mint the same one; serialising every write to prevent that would cost throughput on all of them.
  Since `id` is a stable UUID, every reader — the SQL `ORDER BY`, the applier's notion of "last", and
  the client — resolves the collision to the same order. **Any new ordered read must use the same
  `(sort_key, id)` order**, or the order becomes dependent on which read happened to run.

Pages have a `sort_key` even though the sidebar has no drag-reorder: the tree renders in `sort_key`
order seeded to creation order, and the column exists so adding reorder later is a feature rather
than a migration. A `// Future:` comment marks the render site.

## Backups

D1 **Time Travel** gives 30-day point-in-time restore with no cron and no object storage. A
periodic `wrangler d1 export` to a local file is the off-platform copy; there are no virtual tables
in the schema, so nothing blocks the export. The restore procedure **must be executed once against
a throwaway database** — an untested restore is not a backup. See
[15](./15-deployment-and-operations.md).

## Checklist for a schema change

1. Write the forward-only migration SQL. If you must change a constraint, rebuild the table (see
   `0002`).
2. Mirror it in `src/db/schema.ts`, with a comment naming the migration it mirrors.
3. `workspace_id NOT NULL` + index, `version` default 1, `created_at`/`updated_at` ms integers, UUID
   text id.
4. Add or extend the `repo/` module, following the two-flavour convention. Filter on
   `ctx.workspaceId` in **every** read and write.
5. If it enters the snapshot: update `getSnapshot`, fold it into `computeSnapshotEtag`, **bump the
   ETag prefix**, and mirror the type in `packages/frontend/src/api/types.ts`.
6. If it is writable: add op types ([08](./08-writes-updates-and-sync.md)).
7. `npm run migrate:local`, then the worker unit tests — they run against a real local D1, so a
   broken migration fails them.

## Next

- [08 — Writes, updates and sync](./08-writes-updates-and-sync.md)
- [13 — Tenancy and multi-user](./13-tenancy-and-multi-user.md)
