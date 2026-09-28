-- Migration 0005: views for Phase 4.
--
-- A view belongs to one database page and stores its layout kind (table, board, list), an optional
-- group property (board only), a JSON array of ViewFilter, and an optional JSON ViewSort. Filtering,
-- sorting and grouping are computed client-side; the server persists and validates the settings only.
--
-- No REFERENCES pages(id) ON DELETE CASCADE: D1's trigger-recursion behaviour makes ON DELETE CASCADE
-- dangerous (see migrations 0002, 0003 and 0004). The sync applier deletes a database's views
-- explicitly when its page is deleted, exactly as it already does for properties and values.
CREATE TABLE views (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  database_page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- 'table' | 'board' | 'list'
  group_property_id TEXT,              -- board only; NULL otherwise
  filters TEXT NOT NULL DEFAULT '[]',  -- JSON array of ViewFilter
  sort TEXT,                           -- JSON ViewSort, or NULL for unsorted
  sort_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Serves loading all views for a workspace in one read (for the snapshot and the applier) and listing
-- a database's views in sort_key order for the view switcher.
CREATE INDEX views_workspace_db_sort_idx ON views (workspace_id, database_page_id, sort_key);
