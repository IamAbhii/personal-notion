# 02 — Local development

> [docs/RUNNING.md](../RUNNING.md) is the authoritative operational page and contains the full
> incident history behind these rules. This page is the condensed version plus the reasoning a new
> developer needs. When they disagree, RUNNING.md wins.

## Node 22, and it is not optional

```bash
source ~/.nvm/nvm.sh && nvm use     # reads .nvmrc, which pins 22
```

Do this at the start of **every** shell. `@cloudflare/vitest-pool-workers` needs Node >= 20.12
(it imports `styleText` from `node:util`). On an older Node the worker test suite fails _while
loading its config_, with an error that looks nothing like a version problem.

## First run

```bash
source ~/.nvm/nvm.sh && nvm use
npm install
npm run kill-servers      # always, before starting anything
npm start                 # build frontend -> apply local migrations -> serve on 8787
```

The app is at <http://localhost:8787>. That single origin serves both the API and the PWA, exactly
as production does.

If you skip `npm run migrate:local` (which `npm start` runs for you, but `npm run dev` does not on
a fresh clone), every request that touches the database fails with a SQLite error, pages appear not
to exist, and creates return 500. It looks like a product bug. It is not.

## Ports

| Port     | What                                                   | Notes                                       |
| -------- | ------------------------------------------------------ | ------------------------------------------- |
| **8787** | `wrangler dev` — the Worker: API **and** the built PWA | This is the app. The e2e suite's `baseURL`. |
| **5173** | Vite dev server, frontend only, proxies `/api` to 8787 | Only used by `npm run dev`.                 |
| **9323** | Playwright HTML report                                 | **Must never open** — it blocks forever.    |

`npm run dev` and `npm run test:e2e` both want 8787. Never run them at once.

## The rule that will save you the most time

**A start that has not served a response within ~15 seconds is not slow, it is wedged.** Waiting
cannot fix it: an orphaned `wrangler`/`workerd` holds the port and never times out. Interrupt, run
`npm run kill-servers`, start again.

```bash
npm run kill-servers    # kills wrangler + workerd, asserts 8787 and 8788 are free
```

Diagnosing a hang: compare elapsed against CPU time with
`ps -o pid,etime,time,command -p <pid>`. Elapsed climbing while CPU is _frozen_ means blocked.
`curl -s -o /dev/null -w "%{http_code}\n" --max-time 5 http://localhost:8787/api/health` returns
`000` when the port is held but nothing is serving.

Do not bother killing the PID from `lsof -ti:8787` — that is the `workerd` child and its parent
respawns it. And a second `wrangler` silently binds **8788**, so the app looks up while your
browser and the e2e `baseURL` point at a dead port. Always assert the port is _free_.

## Two development modes

| Mode              | Command       | When                                                                |
| ----------------- | ------------- | ------------------------------------------------------------------- |
| Production-shaped | `npm start`   | Anything involving the Worker, auth, D1, the service worker, or e2e |
| Fast frontend HMR | `npm run dev` | Iterating on UI. Vite on 5173 proxies `/api` to the Worker on 8787. |

`npm run dev` runs both concurrently. `npm start` requires a frontend rebuild to see UI changes,
because the Worker serves `packages/frontend/dist`.

## Commands you will actually use

All from the repo root.

| Command                                         | Does                                               |
| ----------------------------------------------- | -------------------------------------------------- |
| `npm start`                                     | Build frontend, migrate local D1, serve on 8787    |
| `npm run dev`                                   | Worker on 8787 **and** Vite on 5173                |
| `npm run kill-servers`                          | Kill stale wrangler/workerd, assert 8787/8788 free |
| `npm run migrate:local`                         | Apply D1 migrations to the local database          |
| `npm test`                                      | Worker unit tests, then frontend unit tests        |
| `npm run test:worker` / `npm run test:frontend` | One side only                                      |
| `npm run test:coverage`                         | Both, with an 80% statement threshold              |
| `npm run test:e2e`                              | Playwright, config at `e2e/playwright.config.ts`   |
| `npm run typecheck`                             | Gate 1 — four `tsc --noEmit` projects              |
| `npm run lint` / `npm run lint:fix`             | Gate 2 — ESLint 9 flat config                      |
| `npm run format:check` / `npm run format`       | Gate 3 — Prettier                                  |

**Always `vitest run`, never bare `vitest`** — the bare form watches forever. The npm scripts
already use `run`.

### `npm run typecheck` is the only real type gate

```
tsc --noEmit -p tsconfig.json && tsc --noEmit -p packages/worker && \
tsc --noEmit -p packages/frontend && tsc --noEmit -p e2e
```

A bare `npx tsc --noEmit` in the repo root checks only the root project and **misses the worker,
the frontend and the e2e suite entirely**. Always use the npm script.

## Never run these in the foreground

They wait for a human and never exit:

- `wrangler dev`, `vite` — servers
- bare `vitest` — watch mode
- `playwright show-report` — serves on 9323 and blocks
- Playwright's `html` reporter without `open: 'never'` — starts that server on failure by itself

Everything that _terminates_ (test runs, builds, typechecks, migrations) runs in the foreground
with an explicit timeout. Backgrounding those and polling is how you invent a deadlock.

## The local database

- **State file:** `packages/worker/.wrangler/state/v3/d1` — a Miniflare SQLite file. Note the path
  is under `packages/worker`, **not** the repo root and **not** `e2e/`.
- **Migrations:** `packages/worker/migrations/*.sql`, forward-only,
  applied by `npm run migrate:local`.
- **Wipe it:** delete that directory, then re-run migrations. Resolve the path from the repo root
  or from the script's own location — never from the caller's working directory.
- **Reset it while running:** `POST /api/workspaces/:workspaceId/test/reset`. Wipes the workspace,
  re-seeds from the template, clears `applied_ops`. It exists **only** when the auth bypass is on
  (see `packages/worker/src/routes/testReset.ts`), and **page ids are fresh after every reset**, so
  never cache ids across one.

## Secrets and the auth bypass

- `packages/worker/.dev.vars` holds local secrets and is gitignored. `.dev.vars.example` is
  committed. The repo-root `.env` is for the agent build and `wrangler deploy`, **not** for
  application runtime config — see [15](./15-deployment-and-operations.md).
- `AUTH_DISABLED=true` runs with no sign-in as a fixed synthetic owner (`dev@personal.space`). This
  is how the suites run with no Google credentials and no internet. The Worker **refuses to serve
  any request** with it set while `NODE_ENV=production`. Details in
  [11](./11-auth-and-authorization.md).

## Before every commit

In this order, and fix what they report before committing — never in a follow-up commit:

```bash
npm run typecheck && npm run lint && npm run format:check
```

Fix real type errors by hand. Widening to `any` or reaching for `@ts-expect-error` is not a fix
here. See [16](./16-conventions-and-workflow.md).

## Failure shapes that look like product bugs

Both of these have cost this project real investigation cycles:

1. **Worker running before migrations applied** — every DB-touching request fails; pages seem not
   to exist. Run `npm run migrate:local`.
2. **Two wrangler instances alive** — the second binds 8788 silently; tests hit a different
   database than the one they reset, and fail with "page no longer exists" or shifting ids. Run
   `npm run kill-servers` and verify with `lsof -nP -iTCP:8787 -sTCP:LISTEN`.

## Next

- [03 — Frontend architecture](./03-frontend-architecture.md)
- [09 — Backend architecture](./09-backend-architecture.md)
- [14 — Testing](./14-testing.md)
