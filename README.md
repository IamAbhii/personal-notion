# Personal Space

A personal knowledge manager inspired by Notion — nested pages, a block editor, and databases with
table, board and list views — built autonomously by a team of Claude Code agents.

It runs as a hosted, installable **PWA**: reachable from any machine on the web, installable on phone
and desktop, and **fully usable offline**, with edits queued locally and synced automatically when the
network returns. Access is gated by **Google sign-in**. Hosting cost is effectively zero.

> **Status:** specification and architecture are complete and fixed. Implementation has not started —
> there is no application code in this repository yet. The stack below is the decided target, not a
> description of shipped code.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + TypeScript**, built with **Vite** | Fast builds, first-class TS |
| Routing / data / tables | **TanStack** Router, Query, Table, Form | One coherent, well-supported family |
| Offline | **IndexedDB** (`idb`/Dexie) + an op queue, `vite-plugin-pwa` service worker | Editing works with no network |
| Backend | **TypeScript on Cloudflare Workers** with **Hono** | No server to patch, no process to supervise |
| Database | **Cloudflare D1** (managed SQLite) via **Drizzle ORM** | SQLite semantics, zero ops, portable schema |
| Search | **SQLite FTS5** | A real full-text index, not `LIKE` |
| Auth | **Google Sign-In (OAuth 2.0 / OIDC)**, implemented in-app | Portable and testable; no edge-provider lock-in |
| Unit tests | **Vitest**, backend via `@cloudflare/vitest-pool-workers` | Handlers run in the real `workerd` runtime |
| End-to-end tests | **Playwright** | Drives the real app in a real browser |
| Hosting | **Cloudflare Workers + D1 + static assets**, one origin | Free tier covers it; TLS, CDN and DDoS included |

**Running cost:** USD 0 on a `*.workers.dev` subdomain. Backups are D1 **Time Travel** (30-day
point-in-time restore) rather than a backup cron. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the
free-tier limits that shape the design — chiefly no interactive transactions, and 50 D1 queries per
Worker invocation, which is why offline sync flushes in ordered chunks.

## Design decisions worth knowing

- **Single user today, multi-account by design.** One Google account and one workspace ship. But
  `users`, `workspaces` and `workspace_members` tables exist from day one, every content row carries a
  non-null `workspace_id`, and **the API is workspace-scoped** (`/api/workspaces/:workspaceId/...`).
  Going multi-account later adds rows and a workspace switcher — no schema migration, no endpoint
  reshaped, no data backfill.
- **Offline-first, and that is what makes edge hosting safe.** Mutations are intent-based ops with
  client-minted UUIDs, persisted to IndexedDB before any network attempt, replayed in order against an
  idempotent `/sync` endpoint backed by an `applied_ops` table. A retried request is never applied twice.
- **Concurrent editing is out of scope, but designed for.** The policy is last-write-wins. Every row
  carries a `version` and every op a `base_version`, recorded but not enforced — turning on optimistic
  concurrency is a one-line change, and a future CRDT has an append-only ordered op log to build on.
- **Cloudflare lock-in is contained.** All data access goes through a repository layer; `env.DB` and
  Workers globals do not leak past it. Moving to Node + SQLite on a VM, or to Turso, rewrites that one
  layer.

## Documentation

- [REQUIREMENTS.md](./REQUIREMENTS.md) — the product contract: what gets built, phase by phase, with
  success criteria. This document wins on *what* the product does.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the fixed decisions: stack, D1 constraints, tenancy seams, API
  contract, offline sync, production readiness, the Cloudflare deploy, and the code comment convention.
  This document decides *how* it is built.
- [CLAUDE.md](./CLAUDE.md) — the build rules: team roles, defect workflow, file formats.
- `.claude/agents/` — the four worker subagents. The orchestrator is the main Claude Code session.

## The agent team

Claude Code drives this build as one main session plus four subagents:

- **orchestrator** — the main session. Plans, delegates, reviews and gates phases. Writes no code.
- **frontend-dev**, **backend-dev** — the developers (Sonnet).
- **qa** — end-to-end tests, screenshots, DEFECTS.md (Haiku).
- **adversary** — tries to break the running app; records findings in ADVERSARIAL_REVIEW.md (Sonnet).

Only the main session can dispatch subagents, so the orchestrator lives there rather than in
`.claude/agents/`. Change any subagent's model by editing the `model:` line in its file.

## Running the build

Prerequisites: Docker, and VS Code with the Dev Containers extension.

1. Put your Anthropic API key in `.env` at the repo root (gitignored):

       ANTHROPIC_API_KEY=sk-ant-...

   Use a dedicated key with a spend cap — the agents run unattended. (If you use Claude Code with a
   Claude subscription instead of an API key, you can skip this and run `claude` and sign in when
   prompted; remove the `--env-file` line from `.devcontainer/devcontainer.json` if you do.)

2. Open this folder in VS Code and reopen it in the container: **Reopen in Container** on the
   notification, or the Command Palette (Cmd+Shift+P) → **Dev Containers: Reopen in Container**.
   First build takes a few minutes: setup installs Claude Code and Playwright with a browser. The
   key is injected when the container is created, so after changing `.env`, run
   **Dev Containers: Rebuild Container** to pick it up.

3. In the container terminal, start Claude Code:

       claude

   You are now the orchestrator. Kick it off with:

   > Complete the entire project as specified in REQUIREMENTS.md and don't stop until all success
   > criteria are met and the product is running. Delegate all code to the subagents.

While it runs: defects appear in `DEFECTS.md`, adversarial findings in `ADVERSARIAL_REVIEW.md`,
evidence in `screenshots/`, end-to-end tests in `e2e/`. When the app starts, VS Code forwards its
port — open it in your own browser to watch and use the product.

## Running the app (once built)

Local development needs no Cloudflare account, no Google credentials and no internet — `wrangler dev`
runs the Worker against a local D1 database, with sign-in bypassed:

    npm install
    npm run dev

Deploying is one Worker, one D1 database and one static-assets binding. Secrets go in via
`wrangler secret put`, never into `wrangler.toml`:

    wrangler d1 create personal-space
    wrangler deploy

The exact steps, the Google OAuth client setup, the redirect URI to register, and the restore
procedure are in [ARCHITECTURE.md](./ARCHITECTURE.md) under "Deploying to Cloudflare".
