# Onboarding — Personal Space

Everything a new developer needs to become productive on this codebase, one topic per file.
Written against the code as it exists today, not against the plan. Where the two differ, the
difference is called out explicitly in the relevant page.

Read the pages in order if you are new. Jump straight to a topic if you are here for one thing.

## Reading order

| #                                       | Topic                    | What you get from it                                                                          |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| [01](./01-project-overview.md)          | Project overview         | What the product is, the repo layout, the vocabulary, what is built vs. designed-not-built    |
| [02](./02-local-development.md)         | Local development        | Node version, ports, the one command that starts the app, the local database, the gates       |
| [03](./03-frontend-architecture.md)     | Frontend architecture    | How the app boots, routing, the layering rules, the PWA                                       |
| [04](./04-state-management.md)          | State management         | TanStack Query as server truth, Zustand for UI, React context for the workspace, localStorage |
| [05](./05-component-structure.md)       | Component structure      | Folder conventions, the `ui/` primitives, feature components, accessibility, co-located tests |
| [06](./06-styling-and-theming.md)       | Styling and theming      | Tailwind v4, the CSS custom-property token layer, light/dark, mobile-first rules              |
| [07](./07-api-contract.md)              | The API                  | Every endpoint, the wire types, the HTTP client, error shapes                                 |
| [08](./08-writes-updates-and-sync.md)   | Writes, updates and sync | The op-based write path, how a change reaches other tabs, why there are no webhooks           |
| [09](./09-backend-architecture.md)      | Backend architecture     | The Worker, Hono, request lifecycle, the strict layering, configuration                       |
| [10](./10-data-layer-and-database.md)   | Data layer and database  | D1, Drizzle, the schema, migrations, the repository pattern, fractional ordering              |
| [11](./11-auth-and-authorization.md)    | Auth and authorization   | Google OAuth, sessions, `resolveAccess`, capabilities, the dev bypass                         |
| [12](./12-security.md)                  | Security                 | Trust boundaries, input validation and limits, idempotency, the known gaps                    |
| [13](./13-tenancy-and-multi-user.md)    | Tenancy                  | Why every row carries `workspace_id` and what going multi-user actually costs                 |
| [14](./14-testing.md)                   | Testing                  | Unit tests both sides, the real `workerd` runtime, Playwright, coverage thresholds            |
| [15](./15-deployment-and-operations.md) | Deployment and ops       | CI/CD, Wrangler, secrets, the cron trigger, backups, quotas                                   |
| [16](./16-conventions-and-workflow.md)  | Conventions and workflow | Comment rules, `// Future:` markers, PR and branch rules, the defect ledger, the agent team   |

## First hour

1. `source ~/.nvm/nvm.sh && nvm use` — Node 22 is mandatory, see [02](./02-local-development.md).
2. `npm install && npm run kill-servers && npm start` — the app is on <http://localhost:8787>.
3. Read [01](./01-project-overview.md) and [03](./03-frontend-architecture.md) or
   [09](./09-backend-architecture.md) depending on which side you are joining.
4. Skim [16](./16-conventions-and-workflow.md) before your first commit — the three pre-commit
   gates are non-negotiable here.

## Where to look when…

| Question                                         | Page                                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| "The server will not start / port is stuck"      | [02](./02-local-development.md)                                                  |
| "How do I add a new field to a page?"            | [10](./10-data-layer-and-database.md) then [08](./08-writes-updates-and-sync.md) |
| "How do I add a new block type?"                 | [08](./08-writes-updates-and-sync.md) and [05](./05-component-structure.md)      |
| "Where does this colour come from?"              | [06](./06-styling-and-theming.md)                                                |
| "Why is my write rejected?"                      | [08](./08-writes-updates-and-sync.md)                                            |
| "Why can't I read `env.DB` here?"                | [09](./09-backend-architecture.md)                                               |
| "Why does sign-in redirect to `/?auth_error=…`?" | [11](./11-auth-and-authorization.md)                                             |
| "Is this app real-time?"                         | [08](./08-writes-updates-and-sync.md)                                            |

## Source-of-truth documents this guide summarises

This guide is an orientation layer. These remain authoritative and win on any disagreement:

- [REQUIREMENTS.md](../../REQUIREMENTS.md) — the product contract: what gets built, phase by phase.
- [ARCHITECTURE.md](../../ARCHITECTURE.md) — index of the fixed decisions in
  [`docs/architecture/`](../architecture/).
- [docs/RUNNING.md](../RUNNING.md) — mandatory operational reading before you run any command.
- [docs/AUTH_FLOW.md](../AUTH_FLOW.md) — the sign-in flow, keys and secrets, end to end.
- [CLAUDE.md](../../CLAUDE.md) — build rules, agent roles, ledger formats.
- `.claude/skills/react-standards/` and `.claude/skills/tailwind-standards/` — the enforced
  frontend code standards.
