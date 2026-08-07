# Personal Space — Build Rules

These rules apply to the whole project: the main session (the orchestrator) and every subagent.

## The job

Build Personal Space exactly as specified in [REQUIREMENTS.md](./REQUIREMENTS.md). That document
is the contract: its phases, success criteria and final criteria decide when work is done. When in
doubt, REQUIREMENTS.md wins.

[ARCHITECTURE.md](./ARCHITECTURE.md) records the decisions that are **fixed** for this project and is
mandatory reading before you write any code: the stack, the hosted deployment target, Google sign-in,
the tenancy seams for future multi-user and multi-workspace support, offline editing with a sync
queue, production readiness, and the code comment convention. REQUIREMENTS.md still wins on *what*
the product does; ARCHITECTURE.md decides *how* it is built, and its choices are not up for
relitigation mid-build. Read the sections relevant to your task, not the whole file.

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

## How the orchestrator runs each phase

1. Read the phase in REQUIREMENTS.md. Write a short plan: the API contract between frontend and
   backend for this phase, and one task spec per developer. A task spec says what to build, which
   unit tests to add, and which success criteria it serves.
2. Dispatch backend-dev and frontend-dev in parallel with their specs — one message, two Task
   calls. They can start together because the contract is fixed first.
3. When both report done, review the evidence: diffs, test output, and the frontend screenshots.
   You have vision — look at the screenshots and judge them against the look-and-feel rules and the
   phase's criteria. Send specific fixes back if they fall short.
4. Have qa write and run the phase's end-to-end tests, run the full suites, and capture screenshots.
5. Dispatch the adversary on a short pass over the features this phase added. Triage every finding.
6. Walk the phase's success criteria one by one. Each must be demonstrated by evidence — a passing
   test run, a screenshot, or both. Only then does the next phase start.

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
- **Never commit or push to `main` directly**, and never merge your own PR unless the operator has
  said to.
- **The orchestrator owns git.** Subagents write files; the orchestrator branches, commits, and opens
  the PR after it has reviewed the evidence for that task. This keeps one writer on the history and
  means nothing is committed that has not been judged against the phase's criteria.
- **Rebase rather than merge** when an upstream branch changes, so the stack stays linear and each
  PR keeps a clean, readable diff.

### What every PR description must contain

A reviewer should not have to read the diff to understand the change. Write, in this order:

1. **What this is for** — the task, the phase, and which REQUIREMENTS.md success criteria it serves.
2. **How the code works** — a short walkthrough of the approach: the modules added, the data flow
   through them, and the key decisions taken. Name the files a reviewer should start with.
3. **Why it was done this way** — any non-obvious choice, and what was rejected. Point at the
   relevant ARCHITECTURE.md section rather than restating it.
4. **Evidence** — test output, and screenshots for anything with a visible surface.
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
- Comment the code as ARCHITECTURE.md's "Code comments" section requires: a short comment on every
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

The main session is the most capable and most expensive model. Spend it on judgment, not typing:

- Never write or edit code. Delegate all code to the developer subagents.
- Read diffs, summaries, test output and screenshots — not whole source trees.
- Keep plans and task specs short. Let subagents finish and report before intervening.
