# Personal Space

A personal knowledge manager inspired by Notion — pages, blocks, databases with table / board /
list views — built autonomously by a team of Claude Code agents.

Built with **React + TanStack** (a PWA) on the frontend and **Node + TypeScript + SQLite** on the
backend. Runs locally with one command, and can be self-hosted cheaply on AWS.

- [REQUIREMENTS.md](./REQUIREMENTS.md) — what gets built, phase by phase, with success criteria.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — the fixed stack decisions and the AWS hosting plan.
- [CLAUDE.md](./CLAUDE.md) — the build rules: team roles, defect workflow, file formats.
- `.claude/agents/` — the four worker subagents (frontend-dev, backend-dev, qa, adversary). The
  orchestrator is the main Claude Code session itself.

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
