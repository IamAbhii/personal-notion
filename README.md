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

| Layer                   | Choice                                                                      | Why                                             |
| ----------------------- | --------------------------------------------------------------------------- | ----------------------------------------------- |
| Frontend                | **React + TypeScript**, built with **Vite**                                 | Fast builds, first-class TS                     |
| Routing / data / tables | **TanStack** Router, Query, Table, Form                                     | One coherent, well-supported family             |
| Offline                 | **IndexedDB** (`idb`/Dexie) + an op queue, `vite-plugin-pwa` service worker | Editing works with no network                   |
| Backend                 | **TypeScript on Cloudflare Workers** with **Hono**                          | No server to patch, no process to supervise     |
| Database                | **Cloudflare D1** (managed SQLite) via **Drizzle ORM**                      | SQLite semantics, zero ops, portable schema     |
| Search                  | Client-side over the local copy                                             | Instant, works offline, no server index         |
| Auth                    | **Google Sign-In (OAuth 2.0 / OIDC)**, implemented in-app                   | Portable and testable; no edge-provider lock-in |
| Unit tests              | **Vitest**, backend via `@cloudflare/vitest-pool-workers`                   | Handlers run in the real `workerd` runtime      |
| End-to-end tests        | **Playwright**                                                              | Drives the real app in a real browser           |
| Hosting                 | **Cloudflare Workers + D1 + static assets**, one origin                     | Free tier covers it; TLS, CDN and DDoS included |

**Running cost:** USD 0 on a `*.workers.dev` subdomain. Backups are D1 **Time Travel** (30-day
point-in-time restore) rather than a backup cron. See [docs/architecture/d1-constraints.md](./docs/architecture/d1-constraints.md) for the
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
  Ops are the write path from Phase 1, so the offline queue is added on top of an existing shape rather
  than replacing every mutation in the app.
- **Concurrent editing is out of scope, but designed for.** The policy is last-write-wins, and an
  overwrite of newer data is **reported to you rather than silent**. Every row carries a `version` and
  every op a `base_version`, compared but not enforced — turning on optimistic
  concurrency is a one-line change, and a future CRDT has an append-only ordered op log to build on.
- **Cloudflare lock-in is contained.** All data access goes through a repository layer; `env.DB` and
  Workers globals do not leak past it. Moving to Node + SQLite on a VM, or to Turso, rewrites that one
  layer.

## Documentation

- [REQUIREMENTS.md](./REQUIREMENTS.md) — the product contract: what gets built, phase by phase, with
  success criteria. This document wins on _what_ the product does.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — an index of the fixed decisions, which live one-per-area in
  `docs/architecture/`: stack, D1 constraints, tenancy seams and the API contract, offline sync,
  production readiness, the Cloudflare deploy, and the code comment convention. These decide _how_ it
  is built. Read only the file you need.
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

1. Create `.env` at the repo root (gitignored):

       ANTHROPIC_API_KEY=sk-ant-...
       CLOUDFLARE_API_TOKEN=...        # only needed to deploy

   Use a dedicated Anthropic key with a spend cap — the agents run unattended. The Cloudflare token
   is only needed for `wrangler deploy`; local development does not need it, and it exists because
   `wrangler login` opens a browser, which a container cannot do.

   **The file must exist**, even if empty: the container passes it to Docker with `--env-file`, and a
   missing file stops the container from starting. (If you use Claude Code with a Claude subscription
   instead of an API key, run `claude` and sign in when prompted; you can drop the `--env-file` line
   from `.devcontainer/devcontainer.json` if you would rather not keep a `.env` at all.)

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

You need [Node.js 22 or newer](https://nodejs.org) and nothing else: no Cloudflare account, no Google
credentials, no internet. **Node 22 is a hard requirement, not a preference** — Wrangler refuses to
run on Node 20 and the app will not start.

The required version is pinned in [`.nvmrc`](./.nvmrc), so if you use
[nvm](https://github.com/nvm-sh/nvm) the right version is one command:

    nvm use          # reads .nvmrc; run `nvm install` first if you do not have Node 22 yet

Check it before anything else — this is the most common reason the app fails to start:

    node --version   # must print v22 or higher

In a terminal, in this folder, run these two commands once:

    cp packages/worker/.dev.vars.example packages/worker/.dev.vars
    npm install

Then, every time you want to use the app, one command:

    npm start

Wait for the line `Ready on http://localhost:8787`, then open **http://localhost:8787** in your
browser. The sidebar comes up populated with a starter set of pages — around 25 of them, nested
several levels deep, each with an emoji icon. Sign-in is bypassed locally, so there is nothing to log
into. Press `Ctrl+C` in the terminal to stop it.

`npm start` builds the app, applies any new database migrations to the local database, and starts the
one server that serves both the app and its API. Your pages live in a local database file under
`.wrangler/`, so they are still there the next time you start it.

Two extra commands, for working on the code rather than using it:

    npm run dev    # Vite dev server on :5173 with hot reload, proxying /api to the Worker on :8787
    npm test       # the backend and frontend unit test suites

### If it will not start

**`Address already in use` on port 8787.** Something is still serving the app. Killing the process
that holds the port is not enough — `wrangler dev` supervises it and respawns it within a second, so
you have to kill the supervisor at the top of the tree:

    lsof -nP -iTCP:8787 -sTCP:LISTEN -t   # the workerd process holding the port
    ps -o ppid= -p <that pid>             # walk up the parents to the `npm start` at the top
    kill -9 <the npm start pid>
    lsof -nP -iTCP:8787 -sTCP:LISTEN -t   # confirm this prints nothing before starting again

Note that the supervising process can survive being reparented, so identify it by walking the parent
chain rather than by matching a command name.

**Migrations.** If you pulled changes and the app behaves oddly, apply any new migrations to your
local database with `npm run migrate:local`. `npm start` does this for you.

Deploying is one Worker, one D1 database and one static-assets binding. Secrets go in via
`wrangler secret put`, never into `wrangler.toml`:

    wrangler d1 create personal-space
    wrangler deploy

The exact steps, the Google OAuth client setup, the redirect URI to register, and the restore
procedure are in [docs/architecture/deployment.md](./docs/architecture/deployment.md).
