# 14 — Testing

Three layers: worker unit tests in the **real `workerd` runtime against a real local D1**, frontend
unit tests in `happy-dom`, and Playwright end-to-end tests driving the actual app on port 8787.

```bash
npm test                  # worker unit tests, then frontend unit tests
npm run test:worker       # one side
npm run test:frontend
npm run test:coverage     # both, 80% statement threshold each
npm run test:e2e          # Playwright
```

**Always `vitest run`, never bare `vitest`** — the bare form watches forever. The npm scripts
already do this.

## Worker unit tests

`packages/worker/vitest.config.ts` uses `@cloudflare/vitest-pool-workers`, and the choice is the
point:

> Backend unit tests run in the real `workerd` runtime against a local D1 with the real migrations
> applied, so **a migration is exercised before it ships** and no D1 behaviour is mocked.

Configuration you should know about:

- `main: './src/index.ts'` — tests exercise the **real Hono app**, routes, middleware and all.
- `readD1Migrations('./migrations')` is read at config time and passed into the worker as a
  **binding** (`TEST_MIGRATIONS`), because the test worker runs in `workerd` and cannot read the
  filesystem. `test/setup.ts` applies them.
- Test bindings: `NODE_ENV: 'test'`, `AUTH_DISABLED: 'false'`, `ALLOWED_EMAIL: 'owner@example.com'`
  — so the tests go through the **real** auth path, not the bypass.
- `fileParallelism: false` — test files share one local D1, so they run one at a time.
- Coverage provider is **Istanbul, not V8**. V8 native coverage needs `node:inspector`, which is a
  non-functional stub in `workerd`; the pool explicitly rejects the V8 provider. Istanbul
  instruments at build time and works on any runtime.
- Coverage excludes `src/index.ts`, `src/env.ts`, `src/types.ts`, `src/db/schema.ts`.

**Node >= 20.12 is required** by the pool (it imports `styleText` from `node:util`). On an older
Node the suite fails _while loading its config_, with an error that looks nothing like a version
problem. Run `nvm use` first — see [02](./02-local-development.md).

### What to test on the backend

| Area                    | What matters                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `sync/apply.ts`         | Every op type: applied, rejected (each reason), replayed. Cascades, cycles, dangling option cleanup, chunk atomicity |
| `sync/ops.ts`           | `payloadRejection` for every limit and every rejected-field case                                                     |
| `auth/middleware.ts`    | `401` no session, `403` not allow-listed, `403` capability, `404` non-member workspace                               |
| `auth/resolveAccess.ts` | Allow-list match and mismatch, user creation on first sign-in, role from membership                                  |
| `auth/capabilities.ts`  | Including a `403` for a **synthetic viewer** role — that is the only thing exercising the 403 path today; keep it    |
| `routes/auth.ts`        | Every callback failure branch, with `exchangeCodeForProfile` stubbed                                                 |
| `repo/*`                | Workspace filtering, `(sort_key, id)` ordering, parameter chunking                                                   |
| `repo/snapshot.ts`      | Payload shape, JSON parsing, ETag changing on every kind of write                                                    |
| `seed/`                 | Idempotency per workspace                                                                                            |

Tests are co-located as `*.test.ts` next to the module.

## Frontend unit tests

Configured inside `packages/frontend/vite.config.ts` (`test:` block):

- `environment: 'happy-dom'`, `globals: true`, `css: false`
- `setupFiles: ['./vitest.setup.ts']` (`@testing-library/jest-dom` matchers)
- Coverage: V8 provider, **80% statement threshold**, excluding `src/main.tsx`,
  `src/routeTree.gen.ts`, `*.d.ts` and test files

Libraries: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/dom`.

`src/test/fixtures.ts` holds shared record builders — **use it** rather than hand-rolling a
`PageRecord` or a `BlockRecord` in every spec.

### What to test on the frontend

- **`lib/` helpers directly** — this is where the real logic lives and where tests are cheapest.
  Ordering, fractional keys, tree derivation, filter evaluation, search ranking, error message
  construction, text clamping on code-point boundaries, drag announcements, board keyboard
  navigation. Nearly every `lib/` module has a test, and that is not an accident.
- **Op builders** — that `buildPageUpdateOp` produces the right envelope and payload.
- **Mutation hooks** — that a failure calls `notify` and invalidates rather than rejecting.
- **Components** — behaviour and accessibility: query by role and accessible name, not by class.
  Use the existing `data-testid` only where one already exists for e2e purposes.
- **Stores** — `uiStore` immutability, `themeStore`'s raw-string persistence and cross-tab `storage`
  event.

## End-to-end tests

`e2e/` — **only qa writes here** under the build rules ([16](./16-conventions-and-workflow.md)).

`e2e/playwright.config.ts`:

```ts
testDir: './specs',
fullyParallel: false,
workers: 1,
retries: process.env['CI'] ? 2 : 0,
reporter: [['list'], ['html', { open: 'never' }]],
use: { baseURL: 'http://localhost:8787', trace: 'on-first-retry' },
```

Two projects:

| Project         | Device         | Viewport | Specs                                          |
| --------------- | -------------- | -------- | ---------------------------------------------- |
| `chromium`      | Desktop Chrome | 1280x800 | everything except the three `*-mobile.spec.ts` |
| `mobile-chrome` | Pixel 5        | device   | only the three mobile specs                    |

**The viewport is fixed at 1280x800** for every desktop screenshot, in the config and in any ad-hoc
capture. One size keeps captures comparable across phases and each image's cost predictable.

`workers: 1` and `fullyParallel: false` because every spec resets the same shared local D1.

### `reuseExistingServer: false`, and do not turn it back on

Until Phase 2 the suite reused an existing server outside CI, so a stale server on 8787 made it
**silently run every spec against whatever build that old server was serving** — a green suite
proving nothing about the code. That is the most expensive failure mode in this project, because
nothing looks wrong. The cost of the current setting is a ~5 second cold start per run.

`webServer.timeout` is 45s: a healthy `wrangler dev` start serves in a few seconds, so 45s is enough
to distinguish a slow start from a wedged one. Anything longer is likely an orphan.

Note: Playwright checks the port **before** it launches `start-server.sh`, so the script's own
preflight cannot rescue you from a stale server. **Run `npm run kill-servers` before a run.** The
config only guarantees you can never get a false pass.

### `e2e/start-server.sh`

The webServer command is a script rather than an `npm run a && b && c` chain, because killing npm
in a chain leaves the real server alive. In order it:

1. `npm run kill-servers` — first, inside the webServer command itself
2. `nvm use` — Playwright runs this in a fresh shell with no nvm
3. **deletes** `packages/worker/.wrangler/state/v3/d1` — resolved from the script's own location,
   never from the caller's working directory (a Phase 1 bug deleted the wrong relative path for a
   whole phase and silently reset nothing)
4. builds the frontend, applies migrations
5. `exec npm run start:worker` — **`exec`** so wrangler replaces the shell and Playwright's kill
   reaches wrangler directly rather than orphaning it

### `e2e/fixtures/reset-workspace.ts`

Every spec starts from the known seeded tree via `resetWorkspace(page)`. It:

- `goto('/')` and **`waitForURL(/\/w\/[^/]+/)`** — not `networkidle`, which is not sufficient
  because the app may still be redirecting when activity drops to zero
- extracts the workspace id from the URL and **asserts** it was found — a silent skip is worse than
  a failure, because it lets stale state bleed between tests
- POSTs `/api/workspaces/:id/test/reset` and asserts a 200
- reloads so the page sees the freshly seeded state

**Page ids are fresh after every reset**, so never cache an id across one.

### Never run these in the foreground

- `playwright show-report` — serves on 9323 and blocks forever
- the `html` reporter without `open: 'never'` — starts that server on failure by itself

Both have cost this project hours. See [02](./02-local-development.md).

## Screenshots

`screenshots/` at the repo root. The build rules cap what may be _handed over_ at **three per
report**, each named with the criterion it demonstrates — capture as many as you need for your own
verification, hand over the ones that prove something.

Naming: `screenshots/phase-<n>-<subject>-<state>.png`, e.g.
`screenshots/phase-2-slash-menu-open-dark.png`. Defect and finding evidence keeps its id:
`screenshots/def-004.png`, `screenshots/adv-007.png`. **Overwrite rather than accumulate variants**
— a second capture after a fix replaces the first; `-v2` files make the directory unusable.

## CI

`.github/workflows/ci.yml` on every PR to `main`:

```
npm ci → npm run typecheck → npm run lint → npm test -- --run
```

The e2e suite is **not** in CI — it runs locally. `.github/workflows/deploy.yml` repeats the same
three gates on merge to `main` before deploying. See [15](./15-deployment-and-operations.md).

## Verify that cleanup actually cleans

A lesson recorded in [CLAUDE.md](../../CLAUDE.md) and worth repeating: Phase 1's end-to-end database
reset ran with the wrong working directory and **silently deleted nothing for an entire phase**,
leaving the suite dependent on run order. A cleanup step that is never asserted is worse than none,
because it hides the problem. `resetWorkspace` asserts its response; `start-server.sh` resolves its
path from `BASH_SOURCE`. Copy both habits.

## Next

- [15 — Deployment and operations](./15-deployment-and-operations.md)
- [16 — Conventions and workflow](./16-conventions-and-workflow.md)
