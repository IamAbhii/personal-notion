# Code comments (fixed)

Every agent writing code follows this. It applies to frontend, backend, and tests.

- **Every exported function, component, hook, route handler and module gets a short comment** saying
  what it does and why it exists — one or two lines, above the declaration. Not a restatement of the
  signature: `// Applies a queued op batch in client_seq order, skipping ops already in applied_ops.`
  beats `// applies ops`.
- **Comment the non-obvious inside functions too**, briefly: why a guard exists, why an order matters,
  why the obvious simpler thing does not work. Skip commentary on code that already reads plainly.
- **Mark every scalability seam with a `// Future:` comment** naming what would change and where.
  Examples of places that must carry one:
  - `resolveAccess` — "Future: read workspace_members instead of ALLOWED_EMAIL to support many users."
  - the workspace resolver — "Future: take workspaceId from the route for multi-workspace."
  - the `base_version` handling in the sync endpoint — "Future: reject on mismatch to enable optimistic
    concurrency; recorded but unused today."
  - the last-write-wins merge point — "Future: field-level merge or CRDT goes here."
    A `// Future:` comment states the intended change, not a vague aspiration. If it cannot name the
    change, it should not be written.
- **Keep it proportional.** Small modules with clear names plus these comments; no essays, no
  redundant JSDoc tag blocks restating types TypeScript already declares, no commented-out code.
- **No emojis anywhere in code or comments**, per CLAUDE.md.
