-- Migration 0002: drop the self-referencing foreign key on pages.parent_id.
--
-- SQLite implements ON DELETE CASCADE as an internal trigger, and D1 caps trigger recursion at nine
-- levels, so deleting a page with ten or more levels of descendants failed with
-- "too many levels of trigger recursion" and deleted nothing. Pages nest to any depth, so the
-- cascade cannot live in the database: the repository layer now computes the subtree from the page
-- skeleton it already reads once per request and deletes it with explicit DELETE ... WHERE id IN
-- (...) statements. Referential integrity for parent_id is enforced there too - the sync applier
-- rejects a create or a move under a parent that does not exist.
--
-- Forward-only table rebuild: SQLite cannot drop a foreign key in place.

CREATE TABLE pages_new (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- No REFERENCES pages (id): see above. NULL still means a top-level page.
  parent_id TEXT,
  title TEXT NOT NULL,
  icon TEXT,
  sort_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO pages_new (
  id, workspace_id, parent_id, title, icon, sort_key, version, created_at, updated_at
)
SELECT id, workspace_id, parent_id, title, icon, sort_key, version, created_at, updated_at
FROM pages;

DROP TABLE pages;

ALTER TABLE pages_new RENAME TO pages;

CREATE INDEX pages_workspace_id_idx ON pages (workspace_id);
-- Serves the sidebar read: children of a parent within a workspace, already in sort order.
CREATE INDEX pages_workspace_parent_sort_idx ON pages (workspace_id, parent_id, sort_key);
