# Data model details (fixed)

Small decisions with schema consequences, settled now because each is painful to change later.

- **Ordering is fractional, not integer positions.** Blocks in a page, rows in a database and pages in
  the sidebar each carry a `sort_key` string, and an item is moved by computing a key between its new
  neighbours. With integer positions, dragging one block rewrites every sibling — turning one gesture
  into N ops, N row-writes and N chances for last-write-wins to clobber. Fractional keys make a move
  exactly one op on one row. Use a maintained library (`fractional-indexing` or equivalent).
- **Pages have a `sort_key` even though the sidebar has no drag-reorder.** REQUIREMENTS.md specifies
  dragging for blocks and board cards, not for the page tree, so the tree renders in `sort_key` order
  seeded to creation order and there is no reorder UI. The column exists so adding one later is a
  feature, not a migration. `// Future:` comment required at the render site.
- **Database properties are rows, not columns** — a property is a row in `properties`, a cell is a row
  in `property_values`. Required for user-defined properties anyway, and it keeps D1's 100-column
  ceiling irrelevant.
- **Theme is per device, not per account.** Light/dark lives in `localStorage`, so it works offline,
  applies before first paint with no flash, and needs no round trip. It deliberately does not follow you
  between devices — a phone in bed and a laptop at a desk reasonably want different answers.

## Seed data (fixed)

The seed is a **reusable template applied when a workspace is created**, not a one-off insert at deploy
time. One function, `seedWorkspace(ctx)`, takes a workspace id and populates it; deploy calls it once for
your workspace, and the multi-account future calls the same function on first sign-in so every new account
gets a populated first run. This is why it must be parameterised by `workspace_id` and callable on demand
rather than being a hand-written SQL migration full of literal ids.

- The template is data (a TypeScript module of plain objects), not SQL, so it is readable and reviewable.
- It is idempotent per workspace: calling it twice does not duplicate content.
- It grows with the phases, per REQUIREMENTS.md, so no feature ever ships empty.
- Because ids are client- or server-minted UUIDs rather than fixed literals, the same template can be
  applied to any number of workspaces without collision.
