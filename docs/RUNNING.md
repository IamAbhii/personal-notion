# Running Personal Space

**Read this before running anything. Do not rediscover it by experiment.**

Phase 1's end-to-end work cost roughly 125 tool calls, a large share of them spent working out the
Node version, the ports, and where the database lives. Everything an agent needs to build, run, test
and reset this project is on this page.

## Node version: 22, and it is not optional

    source ~/.nvm/nvm.sh && nvm use     # reads .nvmrc, which pins 22

**Do this at the start of every shell.** Each Bash call is a fresh shell, so the selection does not
persist between calls — put it in the same command as the work.

The trap: `@cloudflare/vitest-pool-workers` needs **Node >= 20.12** (it imports `styleText` from
`node:util`). This machine's default `node` is **20.11.1**, on which the worker test suite fails while
_loading its config_ — an error that looks nothing like a version problem. In the devcontainer the
image supplies Node 24 and no nvm is involved.

## Ports

| Port     | What                                                                             | Notes                                                      |
| -------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **8787** | `wrangler dev` — the Worker, serving the API **and** the built PWA on one origin | This is the app. `baseURL` for the e2e suite.              |
| **5173** | Vite dev server, frontend only                                                   | Only used by `npm run dev`. Not what the e2e suite drives. |
| **9323** | Playwright HTML report                                                           | **Must never open.** It blocks forever; see below.         |

Two things must not run at once: `npm run dev` and the e2e suite both want 8787.

### Freeing and inspecting a port

    lsof -ti:8787 | xargs kill -9 2>/dev/null || true   # free it
    lsof -nP -iTCP:8787 -sTCP:LISTEN                    # see what holds it

**Free 8787 before starting the app.** An orphaned `wrangler` from an earlier run holding the port was
one of Phase 1's largest time sinks: the next run waited out a 120-second timeout instead of failing.

To check whether a process is running, use **`pgrep -af wrangler`**. Never `ps aux | grep <literal>` —
`ps` lists the grep itself, whose command line contains your search string, so it always matches. And
never `ps -eo command` filtered loosely on `node`: it dumps kilobytes of VS Code helper command lines.

## Commands

All from the repo root. It is an npm workspace (`packages/frontend`, `packages/worker`).

| Command                                         | Does                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `npm install`                                   | Install everything                                                          |
| `npm start`                                     | Build frontend, apply local migrations, serve on **8787**. This is the app. |
| `npm run dev`                                   | Worker on 8787 **and** Vite on 5173, concurrently. Development only.        |
| `npm run test`                                  | Worker unit tests, then frontend unit tests                                 |
| `npm run test:worker` / `npm run test:frontend` | One side only (`vitest run`)                                                |
| `npm run test:e2e`                              | Playwright, config at `e2e/playwright.config.ts`                            |
| `npm run migrate:local`                         | Apply D1 migrations to the local database                                   |
| `npm run typecheck` / `lint` / `format:check`   | The three pre-commit gates                                                  |
| `npm run lint:fix` / `format`                   | Mechanical fixes                                                            |

**Always `vitest run`, never bare `vitest`** — the bare form watches forever.

## The local database

- **State:** `packages/worker/.wrangler/state/v3/d1` — a Miniflare-created SQLite file. Note the path
  is under `packages/worker`, **not** the repo root and **not** `e2e/`. Phase 1 deleted the wrong
  relative path for an entire phase and silently reset nothing.
- **Migrations:** `packages/worker/migrations/*.sql`, forward-only, applied by `npm run migrate:local`.
- **Wipe it:** delete that directory, then re-run migrations. Resolve the path from the repo root or
  from the script's own location — never from the caller's working directory.
- **Reset it while the app is running:** `POST /api/workspaces/:workspaceId/test/reset`. It wipes the
  workspace, re-seeds from the template and clears `applied_ops`. It exists **only** when the auth
  bypass is on, and page ids are **fresh after every reset**, so never cache ids across one.

## Never run these in the foreground

They wait for a human, and an agent has no keyboard. Background them with output to a log file, then
poll the port; or avoid them entirely.

- `wrangler dev`, `vite` — servers, never exit
- bare `vitest` — watch mode
- `playwright show-report` — serves on 9323 and blocks
- Playwright's `html` reporter without `open: 'never'` — starts that server on failure by itself

**Everything that terminates runs in the foreground with an explicit timeout**: test runs, builds,
typechecks, migrations. Backgrounding those and polling for completion is how you invent a deadlock.
The timeout is what turns a hang into an error you can read and react to.

## Secrets and the auth bypass

- `.dev.vars` in `packages/worker` holds local secrets; it is gitignored. `.dev.vars.example` is
  committed.
- `AUTH_DISABLED=true` runs with no sign-in as a synthetic owner. It is how the suites run without
  Google credentials or internet. The Worker refuses to start with it set in production.
