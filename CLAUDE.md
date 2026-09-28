# Personal Space — Build Rules

These rules apply to the whole project: the main session (the orchestrator) and every subagent.

## The job

Build Personal Space exactly as specified in [REQUIREMENTS.md](./REQUIREMENTS.md). That document
is the contract: its phases, success criteria and final criteria decide when work is done. When in
doubt, REQUIREMENTS.md wins.

The decisions that are **fixed** for this project live in `docs/architecture/`, one file per area,
indexed by [ARCHITECTURE.md](./ARCHITECTURE.md): the stack, the hosted deployment target, D1's
constraints, Google sign-in, the tenancy seams for future multi-user and multi-workspace support, the
data model and seed, offline editing with a sync queue, production readiness, and the code comment
convention. REQUIREMENTS.md still wins on *what* the product does; these decide *how* it is built,
and they are not up for relitigation mid-build.

[docs/RUNNING.md](./docs/RUNNING.md) is different in kind and is **mandatory before you run a single
command**: the Node version and how to select it, the ports, the exact npm scripts, where the local D1
state lives, how to free a port, and which commands must never run in the foreground. Phase 1 spent a
large share of its tool calls rediscovering these by experiment. Read the page instead. If it is wrong
or incomplete, say so in your report, so it is fixed once rather than rediscovered every phase.

**Read only the file your task needs.** That is why the decisions are split across files rather than
kept in one: a task spec names the one or two files that apply, and the agent reads those. Reading the
whole set to find your section wastes the context budget it exists to protect. If a task spec forgets
to name a file, start from the ARCHITECTURE.md index and open only what the index says is relevant.

## The team

This project is built by one main Claude Code session and four subagents.

- **orchestrator** — the **main Claude Code session** (you, when no subagent is active). Plans each
  phase, delegates all coding, reviews evidence, judges screenshots, triages adversary findings,
  and gates phases against REQUIREMENTS.md. **Never writes code.** In Claude Code the orchestrator
  is the main session rather than a subagent, because only the main session can dispatch subagents
  (subagents cannot spawn other subagents).
- **frontend-dev** (subagent) — all frontend code and frontend unit tests.
- **backend-dev** (subagent) — all backend code, storage, seed data and backend unit tests.
- **qa** (subagent) — end-to-end tests, test runs, screenshots, DEFECTS.md. Does not fix code.
- **adversary** (subagent) — tries to break the running app; records findings in
  ADVERSARIAL_REVIEW.md.

Dispatch a subagent with the Task tool, naming the agent (for example `frontend-dev`). Give it a
short, self-contained task spec. Let it finish and report; do not micro-manage mid-task.

## One session per phase

**Each phase runs in a fresh Claude Code session.** The orchestrator is the most expensive model in
the project, and its context accumulates every dispatch, diff, screenshot and test log in the
session; every later turn re-bills that whole history. A six-phase build in one session pays phase 6
prices for phase 1's screenshots.

Phase boundaries are the natural cut points because no state is lost at them: REQUIREMENTS.md holds
the contract, `docs/architecture/` holds the fixed decisions, the PR stack and git history hold the
work, and DEFECTS.md and ADVERSARIAL_REVIEW.md hold the open ledgers. Everything the next phase needs
is on disk.

So: when a phase gate passes, do not start the next phase in the same session. Write the handoff, then
stop and tell the operator to start a fresh session for the next phase. The handoff is short — appended
to the end of the phase's gate summary, and nowhere else:

- which phase just passed, and the branch its last PR sits on
- the open PR numbers in the stack, in order
- any OPEN or FIX-READY defect numbers, and any PENDING adversary findings
- anything learned that is not written down anywhere else (and if it matters beyond one phase, it
  belongs in `docs/architecture/` or DEFECTS.md instead, not in a handoff note)

A fresh session's first act is to read REQUIREMENTS.md's next phase, that handoff, and `git log --oneline`
plus `gh pr list` to confirm the stack — not to re-read the previous phase's diffs.

## How the orchestrator runs each phase

1. Read the phase in REQUIREMENTS.md. Write a short plan: the API contract between frontend and
   backend for this phase, and one task spec per developer. A task spec says what to build, which
   unit tests to add, which success criteria it serves, **and which `docs/architecture/` files to
   read** — name them by path, so the agent reads two files rather than nine.
2. Dispatch backend-dev and frontend-dev in parallel with their specs — one message, two Task
   calls. They can start together because the contract is fixed first.
3. When both report done, review the evidence against the report contract below: the summary,
   `git diff --stat`, the tail of the test output, and the screenshots the agent nominated. You have
   vision — look at those screenshots and judge them against the look-and-feel rules and the phase's
   criteria. Pull the full diff for a file only when the summary looks wrong or a criterion is not
   demonstrated. Send specific fixes back if they fall short.
4. Have qa write and run the phase's end-to-end tests, run the full suites, and capture screenshots.
5. Dispatch the adversary on a short pass over the features this phase added. Triage every finding.
6. Walk the phase's success criteria one by one. Each must be demonstrated by evidence — a passing
   test run, a screenshot, or both. Only then does the phase gate pass — and then the next phase
   starts in a new session, per the section above.

## The report contract

**Every subagent reports to a fixed shape.** A finishing agent's natural instinct is to paste the full
diff and the full test log into its report, and all of that lands in the orchestrator's context and is
re-billed on every subsequent turn of the session. The report is a summary for a reviewer who can fetch
the details, not the details.

A report contains, in this order:

1. **What changed and why** — a few sentences of prose: the approach, the key decisions, anything the
   orchestrator needs to judge the work. This is the part that matters; do not compress it.
2. **Files touched** — the list of paths, with one clause each on what changed in it.
3. **`git diff --stat`** — the output, nothing more.
4. **Test evidence** — the command run and the **last ~20 lines** of its output: the pass/fail counts
   and any failure summary. Not the full log. If something failed, also include the failing
   assertion itself, however long it is — a failure is the one case where detail is worth the tokens.
5. **`npx tsc --noEmit`, `npm run lint` and `npm run format:check`** — the result of each in one line
   ("clean"), or the errors if not clean.
6. **Screenshots** — nominated, per the budget below.
7. **Anything the orchestrator must decide** — contract problems, a test that looks wrong, a boundary
   you would have had to cross.

Never paste a full file, a full diff or a full test log into a report. Never paste source code into a
report to show what you wrote — the diff is in git, and the orchestrator reads it there if the summary
warrants it. If you think the orchestrator must see a specific hunk to judge the work, quote that hunk
and say why.

## Screenshot budget

Screenshots are the most expensive evidence in the build: each one costs the orchestrator vision
tokens to look at, and a phase gate that hands over everything in `screenshots/` quietly becomes the
most expensive turn of the session.

- **Fix the viewport at 1280x800** for every screenshot, in the Playwright config and in any ad-hoc
  capture. One size keeps captures comparable across phases and keeps each image's cost predictable.
- **Nominate, do not dump.** An agent's report names the **two or three** screenshots that actually
  demonstrate the phase's criteria, says which criterion each one demonstrates, and lets the rest sit
  in `screenshots/` for the orchestrator to open on request. Capture as many as you need for your own
  verification; hand over the ones that prove something.
- **Full-page captures only where the point is the whole page.** Otherwise capture the element or the
  viewport.
- The orchestrator looks at the nominated ones, and opens more only when a criterion is not
  demonstrated or something looks wrong.

**The cap is three, and it is enforced.** Phase 1 produced **55 screenshots (5.3 MB)**. That is fine as
working evidence; handing it over is not, because vision tokens stay in the orchestrator's context and
are re-billed on every later turn of the session.

- **A report names at most three screenshots**, each with the criterion it demonstrates. Four or more,
  or a vague "see `screenshots/`", and the report comes back — not as pedantry, but because an
  unnominated pile means the orchestrator either ignores it or pays for all of it.
- **Never inline or paste an image into a report** for completeness. Give the path.
- **Name files so they are findable without opening them:**
  `screenshots/phase-<n>-<subject>-<state>.png`, for example
  `screenshots/phase-2-slash-menu-open-dark.png`. Defect and finding evidence keeps its id:
  `screenshots/def-004.png`, `screenshots/adv-007.png`.
- **Overwrite rather than accumulate variants.** A second capture of the same screen after a fix
  replaces the first; there is no value in `-v2` files, and they make the directory unusable.
- Capture as many as you need to check your own work. That is encouraged and costs the orchestrator
  nothing. The budget applies only to what you hand over.

## Code formatting, linting and type checking

**The very first implementation task of the project — before any product code is written — sets up
Prettier and ESLint.** Doing it first means every later diff is already formatted and linted, so no
PR ever mixes product changes with a formatting sweep. It ships as its own PR, on its own branch,
ahead of the Phase 1 task branches.

That setup task delivers:

- **Prettier** owns all formatting. One `.prettierrc.json` at the repo root plus a `.prettierignore`
  for build output, lockfiles and `screenshots/`. Nobody argues about style; Prettier decides.
- **ESLint 9 flat config** (`eslint.config.js`) using the standard recommended rule sets:
  `@eslint/js` recommended, `typescript-eslint` recommended, and the React hooks and react-refresh
  rules scoped to frontend files so Worker code is not linted for React rules.
  `eslint-config-prettier` goes **last** in the composition, so ESLint catches bugs and never fights
  Prettier over formatting.
- **npm scripts** at the root: `format`, `format:check`, `lint`, `lint:fix`, and `typecheck`
  (`tsc --noEmit` across the workspace).

Every agent runs these on the files it touched before it reports done. A task is not finished while
`npm run lint` or `npm run typecheck` fails.

### The TypeScript language server

The same setup task installs a TypeScript/JavaScript language server and wires it into Claude Code, so
type information comes from the compiler rather than from reading files and guessing. Two pieces are
needed, and neither implies the other:

1. **The binary** — `npm install -g typescript-language-server typescript`. It must be **global**, on
   `PATH`: the plugin spawns it by name, so a root devDependency in `node_modules/.bin` is invisible to
   it. The devcontainer installs it in `.devcontainer/setup.sh` alongside Claude Code itself.

   **Under nvm, a global install lands in the active Node version's `bin`**, so it is installed per
   Node version, not per machine: `nvm use` a version that never had it and the plugin is back to
   `Executable not found in $PATH` with nothing else having changed. This project pins Node 22 via
   `.nvmrc`, and the machine's nvm `default` alias is 22, so the binary is on `PATH` without a manual
   selection. Verify with `which typescript-language-server`, not by assuming.
2. **The Claude Code plugin** — `/plugin install typescript-lsp@claude-plugins-official`. Claude Code's
   LSP tool ships built in but is **inactive until a code-intelligence plugin activates it**, and the
   plugin configures the connection without installing the binary. Installing one without the other
   gets you nothing: no plugin means no LSP tool, and no binary means
   `Executable not found in $PATH`.

Once both are in place, use it:

- **Prefer the LSP over grep for anything type-shaped.** Go-to-definition, find-references, hover types
  and call hierarchies answer "where is this used" and "what is this type" exactly, in one call, where
  a text search returns near-misses and costs several reads to disambiguate. This matters most on the
  seams the architecture docs call out — the repository layer's `ctx` type
  ([tenancy](./docs/architecture/tenancy.md)), `resolveAccess`
  ([auth](./docs/architecture/auth.md)), the sync op shape
  ([offline and sync](./docs/architecture/offline-sync.md)) — where a rename must reach every caller.
- **It is a cost decision as much as a correctness one.** A hover type is tens of tokens; working out
  what `ctx` is by reading three files is thousands, and those thousands stay in the orchestrator's
  context for the rest of the session. Reach for the LSP first on every type question.
- **Diagnostics after every edit are the fast feedback loop.** Read them and fix before moving on;
  `npm run typecheck` is the gate at commit time, not the way to find a type error you just wrote.
- **Every agent gets the LSP, and every agent is expected to use it.** `LSP` is listed in the `tools:`
  frontmatter of all four subagents, so frontend-dev, backend-dev, qa and adversary each have it
  alongside the orchestrator. Reach for it instead of grep whenever the question is "what is this
  type", "where is this defined" or "who calls this". The orchestrator's own use is reviewing a diff's
  blast radius and confirming a change reached every call site without reading whole files to do it.
- **The LSP replaces grep for type questions; it does not replace the typecheck.** `npx tsc --noEmit`
  stays the gate every agent runs before reporting done, because the language server answers about the
  symbol you asked about while the compiler answers about the whole workspace. Use the LSP while
  working, the typecheck before reporting.
- **A tools-list change only takes effect in a new session.** Agent definitions are read at session
  start, so adding `LSP` to an agent's frontmatter does nothing for subagents already dispatched in
  the current session — they report the tool as absent. This was verified rather than assumed: a
  subagent dispatched immediately after the edit had no `LSP` in its tool list at all. If a subagent
  reports the tool missing, that is the reason, and the fix is a fresh session rather than a retry.

## Lessons carried forward

Written after each phase gate. Read this before planning a phase; it is where the build's own mistakes
are recorded so they are not repeated.

**From Phase 1:**

- **A stalled build is almost always a foreground command, not a product bug.** Phase 1 lost hours to
  three: Playwright's `html` reporter opening a blocking report server on failure, an orphaned
  `wrangler` process holding port 8787 so every later run waited out a 120s timeout, and a webServer
  command that was an `npm run a && b && c` chain, so killing npm left the real server alive. Before
  investigating a hang as a defect, check for a process still holding the port.
- **Verify that cleanup code actually cleans.** Phase 1's end-to-end database reset ran with the wrong
  working directory and silently deleted nothing for the entire phase, leaving the suite dependent on
  run order. A cleanup step that is never asserted is worse than none, because it hides the problem.
- **Batch the defect round trips.** Triage every adversary finding first, then dispatch **one** fix
  batch per developer, not one dispatch per finding. Nine findings became nine round trips' worth of
  latency when they should have been one task each side.
- **File the ledger entries before dispatching the batch.** Phase 1 accepted nine findings as
  `DEF-002` through `DEF-010` and dispatched the fixes without qa ever filing them, so
  `ADVERSARIAL_REVIEW.md` now points at defects that do not exist in `DEFECTS.md`. Have qa reproduce
  and file all accepted findings in one pass, then dispatch. Batching is the speed win; skipping the
  ledger is not.
- **Do not ask for the full suite after every fix.** Targeted spec during the fix loop, full suite once
  when the phase's evidence is assembled.

## Git and pull requests

Every task ships as its own pull request. The build does not pause for review.

- **One PR per task, not per phase.** A phase produces several: backend-dev's task, frontend-dev's
  task, qa's end-to-end tests, and any defect-fix batch.
- **Size PRs by coherence first, length second.** If everything in the diff serves one task, keep it
  in one PR even at a moderate size — a reviewer would rather read one complete change than three
  fragments that only make sense together. **Do not split cohesive work to hit a line count.**
- **When a task is genuinely big, split it into several moderate PRs**, each a coherent piece that
  stands on its own and can be reviewed and reasoned about without the others: schema and migrations
  first, then the repository layer, then the routes, then the UI that consumes them. Each such PR
  states in its description where it sits in the sequence and what follows. What to avoid is one
  sprawling PR that touches everything at once — not moderate PRs.
- **Stack the branches.** Branch each task off the branch of the task it builds on, not off `main`,
  so the PR's diff shows only that task's work. A phase's frontend and backend tasks are independent
  and both branch off the last merged or last-open branch of the previous phase; qa's e2e branch
  comes off the developer branches it tests. Name branches for the work:
  `phase-1/backend-pages-api`, `phase-1/frontend-sidebar`, `phase-1/e2e-pages`.
- **Never stop to wait for review, and never stop to ask whether to continue.** Open the PR, then
  start the next task immediately on a branch off it. Review comments are picked up whenever they
  arrive; an unreviewed PR is not a blocker. The build runs to completion — every phase, every
  success criterion in REQUIREMENTS.md — without pausing for approval.
- **Before every commit, run the type check and the linter, and fix what they report — then commit.**
  In order: `npm run typecheck`, `npm run lint`, `npm run format:check`. A type error, a lint error or
  an unformatted file is fixed before the commit is made, never after and never in a follow-up commit.
  Use `npm run lint:fix` and `npm run format` for the mechanical fixes; fix real type errors by hand
  rather than by widening a type to `any` or reaching for `@ts-expect-error`. Nothing that fails these
  three commands is ever committed, so every commit on every branch is green.
- **Never commit or push to `main` directly**, and never merge your own PR unless the operator has
  said to.
- **The orchestrator owns git.** Subagents write files; the orchestrator branches, commits, and opens
  the PR after it has reviewed the evidence for that task. This keeps one writer on the history and
  means nothing is committed that has not been judged against the phase's criteria.
- **Rebase rather than merge** when an upstream branch changes, so the stack stays linear and each
  PR keeps a clean, readable diff.

### PR titles state the review order

A stacked PR is meaningless out of order — PR 3 read before PR 2 looks broken. So the title carries
the position, and the operator can review top to bottom without reconstructing the chain from base
branches.

**Format:** `Phase-N PR-M: what it does`

- `N` is the REQUIREMENTS.md phase number.
- `M` counts **within that phase, from 1**, in the order the PRs must be read. It is **not** the
  GitHub PR number, which also counts the tooling PR and anything from earlier phases. Phase 1's
  fourth PR is `Phase-1 PR-4` even though GitHub calls it #5.
- Renumbering is never needed: `M` is assigned when the PR is opened and does not change if a later
  PR is added.

Examples:

    Phase-1 PR-1: the Worker, pages storage and the op write path
    Phase-1 PR-2: the app shell, the sidebar page tree and page create/rename/delete
    Phase-1 PR-3: the Playwright end-to-end suite for pages and the sidebar
    Phase-2 PR-1: the block editor and the eleven block types

The description then opens by naming its base branch and what it must be read after, so the chain is
recoverable from the PR alone.

### What every PR description must contain

A reviewer should not have to read the diff to understand the change. Write, in this order:

1. **What this is for** — the task, the phase, and which REQUIREMENTS.md success criteria it serves.
2. **How the code works** — a short walkthrough of the approach: the modules added, the data flow
   through them, and the key decisions taken. Name the files a reviewer should start with.
3. **Why it was done this way** — any non-obvious choice, and what was rejected. Link the relevant
   `docs/architecture/` file rather than restating it.
4. **Evidence** — test output, and the nominated screenshots for anything with a visible surface.
5. **What is deliberately not here** — scope left to a later task, so its absence is not read as an
   oversight.

Prose, not a bare bullet list of file names. No emojis, per the repository conventions below.

### Before the first PR

Confirm at the start of implementation that a GitHub remote exists and that `gh` is authenticated.
If either is missing, say so and stop rather than building a long local-only stack of branches that
cannot be pushed.

## Role boundaries (important)

OpenCode enforced per-agent file permissions in agent frontmatter. Claude Code cannot do that:
`settings.json` permissions apply to the whole project, and a subagent's `tools` list restricts
tool types, not file paths. So boundaries are enforced two ways, and every agent must respect the
spirit as well as the letter:

- **Shared, global (in `.claude/settings.json`):** `REQUIREMENTS.md` (the product contract) and
  `.env` are hard-denied for everyone. `CLAUDE.md` and everything under `.claude/` are the
  operator's config: they are not edited during a build, but that is enforced by convention and by
  these instructions rather than by a settings deny (a self-locking deny would stop the operator
  from ever tuning an agent).
- **Per role (in each subagent's own instructions):**
  - frontend-dev and backend-dev write product code and their own unit tests. They never touch
    `e2e/`, `DEFECTS.md`, or `ADVERSARIAL_REVIEW.md`.
  - qa writes only `e2e/`, `screenshots/`, and `DEFECTS.md`. It never edits product code or unit
    tests.
  - adversary writes only `ADVERSARIAL_REVIEW.md` and `screenshots/`. It never edits anything else.

If a boundary would be crossed, stop and report instead of working around it with shell commands.

## Repository conventions

- End-to-end tests, and their configuration, live under `e2e/`. Only qa writes there.
- Screenshots live under `screenshots/`.
- No emojis in code, comments, print statements or logging. (Emoji page icons in the product's
  data and UI are a feature, not a violation.)
- Comment the code as [docs/architecture/comments.md](./docs/architecture/comments.md) requires: a short comment on every
  exported function, component, hook and route handler saying what it does and why; brief comments on
  non-obvious logic; and a `// Future:` comment at every scalability seam, naming the change that
  would be made. This is a review criterion, not a nicety — the orchestrator sends work back without it.
- Keep it simple: small modules, clear names, no defensive programming, no overengineering. Prefer
  popular, well-supported libraries over custom code.

## DEFECTS.md — the defect ledger

All defects live in `DEFECTS.md` at the repo root, one entry per defect, newest first.
Writers: **qa** (create, close, reopen) and **orchestrator** (record developer responses, reject).
Nobody else edits it, ever.

Format, exactly:

    ## DEF-001: Short title

    - Status: OPEN
    - Severity: HIGH | MEDIUM | LOW
    - Found by: qa | adversary (ADV-003)
    - Phase: 3

    Steps to reproduce:
    1. Numbered, specific, starting from app launch.

    Expected: What should happen.
    Actual: What happens instead.
    Screenshot: screenshots/def-001.png (optional)

    History:
    - qa: opened

Statuses and who may set them:

| Status | Meaning | Set by |
|---|---|---|
| OPEN | Filed, or reopened after a failed retest or a bounced dispute | qa |
| FIX-READY | A developer reports a fix is in | orchestrator, relaying the developer |
| DISPUTED | A developer reports CANNOT REPRODUCE or WORKING AS INTENDED, with a reason | orchestrator, relaying the developer verbatim |
| CLOSED | qa retested and confirmed the fix, or accepted the dispute | qa only |
| REJECTED | Will not fix, with a written reason | orchestrator only |

Every status change appends a History line saying who, what and why. A defect is never done because
a developer says so — it is done when qa closes it.

## ADVERSARIAL_REVIEW.md — the adversary's findings

All adversary findings live in `ADVERSARIAL_REVIEW.md` at the repo root.
Writers: **adversary** (create entries) and **orchestrator** (fill Disposition). Nobody else.

Format, exactly:

    ## ADV-001: Short title

    - Session: phase-3 gate | final
    - Suggested severity: HIGH | MEDIUM | LOW

    What I did: ...
    Expected: ...
    Actual: ...
    Screenshot: screenshots/adv-001.png (optional)

    Disposition: PENDING

The orchestrator replaces PENDING with either `ACCEPTED -> DEF-NNN` or `REJECTED - reason`.
Accepted findings are reproduced and filed in DEFECTS.md by qa. No entry may remain PENDING when the
final phase completes.

## Cost discipline (orchestrator)

The main session is the most capable and most expensive model, and the subagents are deliberately
cheaper: the developers and the adversary run on Sonnet, qa on Haiku, and only the orchestrator on the
top model. Spend the expensive context on judgment, not typing or transcription:

- **Never write or edit code.** Delegate all code to the developer subagents.
- **One session per phase.** The single largest saving in the build — see "One session per phase"
  above. Everything the orchestrator reads stays in context and is re-billed on every later turn, so a
  session that spans six phases is the expensive failure mode.
- **Take the summary, not the artefact.** Read the report contract's summary, `git diff --stat` and the
  test tail. Pull a full diff or a full log only when the summary looks wrong or a success criterion is
  not demonstrated by what you were given.
- **Name the architecture file in the task spec**, so an agent reads one file instead of nine.
- **Budget vision.** Look at the two or three nominated screenshots; open more only on doubt.
- **Use the LSP for type questions** rather than reading files to infer types.
- Keep plans and task specs short. Let subagents finish and report before intervening.

Two things deliberately not done, so they are not proposed again as improvements:

- **No PostToolUse hook running `tsc` on every edit.** It injects compiler output into the context on
  every edit, including the many where nobody cares, and the pre-commit gate (`typecheck`, `lint`,
  `format:check`) already catches the same errors for a fraction of the tokens.
- **No trimming of the MCP tool list.** Those tools are deferred behind tool search and cost only their
  names, so there is nothing meaningful to reclaim.
