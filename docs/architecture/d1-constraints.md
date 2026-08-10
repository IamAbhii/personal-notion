# D1 constraints (fixed, and they shape the design)

These are not footnotes. Each one has a design consequence, and ignoring it produces code that works
locally and fails in production.

- **No interactive transactions.** D1 has no `BEGIN`/`COMMIT` spanning multiple round trips. Atomicity
  comes from `db.batch([...])`, which applies an array of statements as a unit. Every multi-statement
  write — creating a page with its first block, applying a sync chunk — must be expressed as one
  `batch()` call, not as a sequence of awaits. Code that assumes an open transaction is a defect.
- **50 queries per Worker invocation on the free plan** (1000 on paid). This is the binding limit on
  `/api/.../sync`: the client chunks the queue into batches of **at most 25 ops**, and the server
  rejects a larger batch with `413` rather than silently truncating. Chunking is safe because
  `applied_ops` makes replay idempotent, so a chunk that succeeds after a timeout is never applied twice.
- **10 ms CPU per invocation on the free plan.** Keep handlers free of heavy loops; do not build search
  indexes or reconcile whole workspaces inside a request.
- **500 MB per database, 5 GB per account on free.** Ample for text. If uploads are ever added they go
  to R2, never into D1 as blobs.
- **2 MB maximum row size and 100 columns per table.** Database properties are modelled as **rows, not
  columns** — a property is a row in a properties table, a cell is a row in a values table. This is
  required anyway for user-defined properties, and it keeps the 100-column ceiling irrelevant.
- **Single-threaded per database, queries queue.** Fine for one user; another reason sync arrives in
  bounded chunks rather than one enormous batch.
- **No server-side search index, and no FTS5.** The contract asks for quick-find over page, database
  and row _titles_ only. The client already holds the whole workspace locally for offline use, so search
  is client-side filtering over that copy: instant, works offline, and no virtual table to keep in sync
  or rebuild on export. D1 does support FTS5 if searching inside block content is ever added — that is
  the trigger for revisiting this, and nothing else.
- **Migrations** are `wrangler d1 migrations` files, forward-only, applied in deploy. The same files run
  against local D1 in development and in tests, so a migration is exercised before it ships.
- **Durable Objects require the paid plan.** They are the natural vehicle for future realtime
  collaboration, so that future carries a USD 5/mo floor. Noted now so it is not a surprise later.
