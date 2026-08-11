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

### Clearing stale servers: run this before anything, every time

**One command, copy it verbatim, do not improvise a shorter version:**

    npm run kill-servers

It kills every `wrangler dev` and every `workerd`, then asserts 8787 and 8788 are free and exits
non-zero naming what still holds a port if either is not. It is safe and silent when nothing is
running, and takes about a second. Run it before `npm start`, before `npm run dev`, before
`npm run test:e2e`, and again the moment anything takes longer than it should.

If you must do it by hand:

    pkill -9 -f "wrangler dev"; pkill -9 -f workerd; sleep 1
    lsof -nP -iTCP:8787,8788 -sTCP:LISTEN     # must print nothing

**Never wait on a slow start. Diagnose it.** A start that has not served a response within about
15 seconds is not slow, it is wedged, and waiting cannot fix it — an orphaned server never times out
and gives the port back. This failure mode has cost the project hours across two phases, including a
**ten-minute wait on a `wrangler` that had already been orphaned for 57 minutes.** The correct reaction
at 15 seconds is to interrupt, run `npm run kill-servers`, and start again.

#### Why the obvious attempts do not work

Every one of these was tried and failed. Do not retry them.

- **Killing the PID from `lsof -ti:8787` alone is useless.** That PID is `workerd`, the child; a
  supervising `node`/`wrangler` parent respawns it on the same port within a second.
- **The next start then silently binds 8788** instead of failing, so the app is up while your browser
  tab and the e2e `baseURL` both point at a dead port. Assert the port is _free_; never infer it from a
  start that seemed to work.
- **`workerd` orphans outlive their parent.** One was found reparented to PID 1, seventeen minutes old,
  holding three random high ports, and invisible to `pgrep -af wrangler`. Match `workerd` too.
- **A bare command-line match kills innocent processes.** `pkill -f 'wrangler dev'` matches any shell
  whose command line merely mentions wrangler — including the caller's own, and sibling agents'. One
  early version of the kill script reported killing ten processes with a single dev server running.
  `npm run kill-servers` filters matches by executable and protects the caller and its ancestors.
- **`setsid` does not exist on macOS.** Do not reach for it to detach a server.

#### A stale server is worse than a hang

If a stale server holds 8787, the e2e suite may not hang at all — it can **silently run every spec
against whatever build that old server is serving**, then pass or fail for reasons unrelated to your
code. A green suite that proves nothing is the most expensive outcome on this page, because nothing
looks wrong. The preflight in `e2e/start-server.sh` exists to make this impossible; do not disable it.

#### Inspecting processes

Use **`pgrep -af wrangler`** and **`pgrep -af workerd`** — both, not just the first. Never
`ps aux | grep <literal>`: `ps` lists the grep itself, whose command line contains your search string,
so it always matches. Never `ps -eo command` filtered loosely on `node`: it dumps kilobytes of VS Code
helper command lines. To see what holds a port:

    lsof -nP -iTCP:8787 -sTCP:LISTEN

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
| `npm run kill-servers`                          | Kill stale wrangler/workerd and assert 8787 and 8788 are free               |

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
