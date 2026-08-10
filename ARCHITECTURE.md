# Personal Space — Architecture Decisions

REQUIREMENTS.md is the product contract and leaves most stack choices to the build. This file
records the choices that are now **fixed** for this project. Where REQUIREMENTS.md and this file
overlap, REQUIREMENTS.md still wins on _what_ the product does; this file decides _how_ it is built.

The decisions themselves now live in `docs/architecture/`, one file per area. Read only the file
relevant to your task, not the whole set.

- [Stack (fixed)](docs/architecture/stack.md) — the frontend, backend, storage, PWA and testing technologies.
- [Deployment target (fixed)](docs/architecture/deployment.md) — the hosted shape of the app, why Cloudflare and what it costs, and the deploy procedure.
- [D1 constraints (fixed)](docs/architecture/d1-constraints.md) — the D1 limits that shape the design and the consequence of each.
- [Authentication and access (fixed)](docs/architecture/auth.md) — Google sign-in, sessions, who is allowed in, and server-side enforcement.
- [Tenancy seams (fixed)](docs/architecture/tenancy.md) — the tables, ids and workspace-scoped API contract that keep multi-user additive.
- [Data model details (fixed)](docs/architecture/data-model.md) — ordering, properties-as-rows, theme storage, and the reusable workspace seed template.
- [Offline and sync (fixed)](docs/architecture/offline-sync.md) — the op-based write path, local store, chunked flush, idempotency, and the concurrency design for later.
- [Production readiness (fixed)](docs/architecture/production-readiness.md) — migrations, backups and restore, headers, abuse resistance, operability and quota.
- [Code comments (fixed)](docs/architecture/comments.md) — the comment convention every agent follows, including `// Future:` seam markers.
