-- Migration 0003: blocks, the content of a page.
--
-- One row per block, ordered inside its page by a fractional sort_key, so a drag-reorder is one op on
-- one row rather than a rewrite of every sibling.
--
-- No REFERENCES pages (id) ON DELETE CASCADE, for the same reason migration 0002 removed the
-- self-reference on pages: SQLite runs a cascade as an internal trigger and D1 caps trigger recursion
-- at nine levels, while a deleted page can sit at any depth. The sync applier deletes a page's blocks
-- explicitly, in the same batch as the page rows.
--
-- text is plain text: Phase 2 has no inline formatting. props is a JSON string carrying only
-- type-specific extras ({"language":"typescript"} for code, {"emoji":"..."} for callout) and is NULL
-- for the types that need none.

CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0,
  props TEXT,
  sort_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Serves both reads that matter: one page's blocks in order, and the whole workspace's blocks in the
-- snapshot.
CREATE INDEX blocks_workspace_page_sort_idx ON blocks (workspace_id, page_id, sort_key);
