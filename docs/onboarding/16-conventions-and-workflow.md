# 16 — Conventions and workflow

The rules in this project are unusually explicit because it is built by a team of Claude Code
agents ([CLAUDE.md](../../CLAUDE.md) is the build contract). They apply to human contributors the
same way, and a few of them will send a PR back if ignored.

## The three gates, in this order, before every commit

```bash
npm run typecheck && npm run lint && npm run format:check
```

- A type error, a lint error or an unformatted file is fixed **before** the commit is made — never
  after, and never in a follow-up commit. **Every commit on every branch is green.**
- Use `npm run lint:fix` and `npm run format` for the mechanical fixes.
- Fix real type errors **by hand**. Widening a type to `any` or reaching for `@ts-expect-error` is
  not a fix here.
- Remember `npx tsc --noEmit` alone checks only the root project and misses the worker, the
  frontend and the e2e suite. Use the npm script.

## Formatting and linting

**Prettier owns all formatting.** `.prettierrc.json` at the root — 100 columns, single quotes,
semicolons, trailing commas everywhere, LF endings — plus `prettier-plugin-tailwindcss` pointed at
`packages/frontend/src/styles/app.css`, which means **class order is Prettier's job, not yours**.

**ESLint 9 flat config** (`eslint.config.js`), and its composition order is deliberate:

1. `@eslint/js` recommended, then `typescript-eslint` recommended
2. Node globals for root-level config files
3. React hooks + react-refresh rules **scoped to `packages/frontend/**` only** — Worker code is
   plain TypeScript and must never be judged against hook or fast-refresh rules
4. Worker files get `globals.serviceworker` — the Workers runtime is neither Node nor a browser
5. **`eslint-config-prettier` last**, so ESLint catches bugs and never fights Prettier over
   formatting

## Comment convention — this is a review criterion

From [`docs/architecture/comments.md`](../architecture/comments.md). It applies to frontend, backend
and tests, and the orchestrator sends work back without it.

1. **Every exported function, component, hook, route handler and module gets a short comment**
   saying what it does _and why it exists_ — one or two lines, above the declaration. Not a
   restatement of the signature:

   ```ts
   // Applies a queued op batch in client_seq order, skipping ops already in applied_ops.
   ```

   beats `// applies ops`.

2. **Comment the non-obvious inside functions too**, briefly: why a guard exists, why an order
   matters, **why the obvious simpler thing does not work**. That last one is the highest-value
   comment in this codebase — most of the surprising code here exists because the simple version was
   tried and failed, and the comment is the record of that.

3. **Mark every scalability seam with a `// Future:` comment naming what would change and where.**

   ```ts
   // Future: to support many users, drop the ALLOWED_EMAIL comparison and let membership in
   // workspace_members alone decide access; nothing outside this function changes.
   ```

   A `// Future:` states the intended change, not a vague aspiration. **If it cannot name the
   change, do not write it.**

4. **Keep it proportional.** No essays, no JSDoc tag blocks restating types TypeScript already
   declares, no commented-out code.

5. **No emojis anywhere in code, comments, print statements or logging.** (Emoji page icons in the
   product's data and UI are a feature, not a violation.)

If you read one thing before writing code here, make it a few of the existing `// Future:` and
"why the simpler thing does not work" comments — `packages/frontend/src/sync/ops.ts` and
`packages/worker/migrations/0002_pages_parent_no_cascade.sql` are the best examples.

## Code style

From [CLAUDE.md](../../CLAUDE.md): **keep it simple.** Small modules, clear names, **no defensive
programming, no overengineering.** Prefer popular, well-supported libraries over custom code —
which is why `fractional-indexing`, Radix, sonner, dnd-kit, `jose` and Zod are all dependencies
rather than hand-rolled.

"No defensive programming" has a specific meaning here: do not add a guard for a state that cannot
occur. `useWorkspace()` **throws** outside the shell rather than returning a default, because that
is a programming error and silence would hide it. The `?? []` defaults in `WorkspaceShell` are the
exception, and they exist for a stated reason: a frontend deploy may briefly meet an older Worker.

## Git and pull requests

- **One PR per task, not per phase.** A phase produces several.
- **Size PRs by coherence first, length second.** If everything in the diff serves one task, keep it
  in one PR even at a moderate size. **Do not split cohesive work to hit a line count.** When a task
  is genuinely big, split it into several moderate PRs each of which stands on its own — schema and
  migrations, then the repository layer, then the routes, then the UI.
- **Stack the branches.** Branch each task off the branch it builds on, not off `main`, so the
  diff shows only that task's work. Name branches for the work:
  `phase-1/backend-pages-api`, `phase-1/frontend-sidebar`, `phase-1/e2e-pages`.
- **Rebase rather than merge** when an upstream branch changes, so the stack stays linear.
- **Never commit or push to `main` directly**, and never merge your own PR unless told to.
- **Never stop to wait for review.** Open the PR and start the next task on a branch off it.

### PR titles carry the review order

A stacked PR is meaningless out of order — PR 3 read before PR 2 looks broken.

```
Phase-N PR-M: what it does
```

`N` is the REQUIREMENTS.md phase number. `M` counts **within that phase, from 1**, in the order the
PRs must be read — it is **not** the GitHub PR number. Phase 1's fourth PR is `Phase-1 PR-4` even
if GitHub calls it #5. `M` is assigned when the PR is opened and never renumbered.

### What every PR description must contain

Prose, not a bare bullet list of file names. No emojis. In this order:

1. **What this is for** — the task, the phase, and which REQUIREMENTS.md success criteria it serves.
2. **How the code works** — a short walkthrough: the modules added, the data flow through them, the
   key decisions. Name the files a reviewer should start with, and the base branch this must be read
   after.
3. **Why it was done this way** — any non-obvious choice, and what was rejected. Link the relevant
   `docs/architecture/` file rather than restating it.
4. **Evidence** — test output, and nominated screenshots for anything with a visible surface.
5. **What is deliberately not here** — scope left to a later task, so its absence is not read as an
   oversight.

## Repository conventions

- End-to-end tests and their configuration live under `e2e/`.
- Screenshots live under `screenshots/`, named `phase-<n>-<subject>-<state>.png`, or `def-NNN.png` /
  `adv-NNN.png` for ledger evidence. **Overwrite rather than accumulate variants.**
- `REQUIREMENTS.md` and `.env` are hard-denied to the agents in `.claude/settings.json`.
  `CLAUDE.md` and everything under `.claude/` are operator config and are not edited during a build.

## The ledgers

Two files at the repo root, both with a **strict format** — copy the shape exactly.

### `DEFECTS.md`

One entry per defect, newest first. Writers are **qa** (create, close, reopen) and the
**orchestrator** (record developer responses, reject). Nobody else edits it.

| Status    | Meaning                                               | Set by                          |
| --------- | ----------------------------------------------------- | ------------------------------- |
| OPEN      | Filed, or reopened after a failed retest              | qa                              |
| FIX-READY | A developer reports a fix is in                       | orchestrator, relaying          |
| DISPUTED  | CANNOT REPRODUCE / WORKING AS INTENDED, with a reason | orchestrator, relaying verbatim |
| CLOSED    | qa retested and confirmed, or accepted the dispute    | **qa only**                     |
| REJECTED  | Will not fix, with a written reason                   | **orchestrator only**           |

Every status change appends a History line saying who, what and why. **A defect is never done
because a developer says so — it is done when qa closes it.**

### `ADVERSARIAL_REVIEW.md`

The adversary creates entries; the orchestrator fills `Disposition` with either
`ACCEPTED -> DEF-NNN` or `REJECTED - reason`. Accepted findings are reproduced and filed in
`DEFECTS.md` by qa. **No entry may remain PENDING when the final phase completes.**

## The agent team (context for why the rules read as they do)

- **orchestrator** — the main Claude Code session. Plans, delegates, reviews evidence, gates
  phases. **Writes no code.**
- **frontend-dev**, **backend-dev** — product code and their own unit tests. Never touch `e2e/`,
  `DEFECTS.md` or `ADVERSARIAL_REVIEW.md`.
- **qa** — `e2e/`, `screenshots/`, `DEFECTS.md`. Never edits product code or unit tests. Only qa may
  close a defect.
- **adversary** — `ADVERSARIAL_REVIEW.md` and `screenshots/` only.

Boundaries are enforced by convention and by each agent's instructions, not by file permissions. If
a boundary would be crossed, **stop and report** rather than working around it with shell commands.

**One phase per session**, because the orchestrator's context accumulates every dispatch, diff,
screenshot and test log, and every later turn re-bills the whole history. Phase boundaries are the
cut points because nothing is lost at them: REQUIREMENTS.md holds the contract,
`docs/architecture/` the fixed decisions, git the work, and the two ledgers the open items.

## Tooling that is expected to be in place

- **TypeScript language server**, globally installed (`npm i -g typescript-language-server
typescript`) plus the `typescript-lsp` Claude Code plugin. Under nvm a global install lands in the
  active Node version's `bin`, so it is per-Node-version, not per-machine. Verify with
  `which typescript-language-server`.
- **Prefer the LSP over grep for anything type-shaped** — go-to-definition, find-references, hover
  types. It matters most on the seams: `ctx`, `resolveAccess`, the op shape. It is a cost decision
  as much as a correctness one: a hover type is tens of tokens, working it out by reading three
  files is thousands.
- **The LSP does not replace the typecheck.** The language server answers about the symbol you
  asked about; the compiler answers about the whole workspace. Use the LSP while working,
  `npm run typecheck` before committing.
- A tools-list change in an agent definition only takes effect in a **new session**.

## Lessons carried forward

Recorded in [CLAUDE.md](../../CLAUDE.md) after each phase gate. The ones that generalise beyond the
agent build:

- **A stalled build is almost always a foreground command, not a product bug.** Before
  investigating a hang as a defect, check for a process still holding the port.
- **Verify that cleanup code actually cleans.** A cleanup step that is never asserted is worse than
  none, because it hides the problem.
- **Batch the round trips.** Triage everything first, then dispatch one fix batch — not one per
  finding.
- **File the ledger entry before dispatching the fix**, or the ledgers end up pointing at defects
  that do not exist.
- **Do not run the full suite after every fix.** Targeted spec during the fix loop, full suite once
  when the evidence is assembled.

## Next

Back to the [index](./README.md).
