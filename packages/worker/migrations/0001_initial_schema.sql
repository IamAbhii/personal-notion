-- Migration 0001: identity, tenancy and the page tree.
--
-- Ids are UUID text everywhere: the client mints entity ids offline, so autoincrement is not an
-- option. Every content row carries workspace_id NOT NULL, indexed and foreign-keyed, so no query
-- can reach another workspace's data and multi-workspace never needs a backfill.
-- Timestamps are integer epoch milliseconds (SQLite has no date type; ms sorts and diffs directly).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  -- google_sub is the stable identity; email can change under the same Google account.
  google_sub TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- One row today (the owner). Inviting people later is an insert, not a schema change.
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user_id_idx ON workspace_members (user_id);

-- Opaque server-side sessions: sign-out deletes the row, so a stolen cookie dies with it.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- The idempotency log for /sync. A replayed op_id returns its recorded outcome instead of applying
-- twice, which is what makes a retry after a mobile timeout safe.
CREATE TABLE applied_ops (
  op_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  result_version INTEGER,
  client_seq INTEGER NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE INDEX applied_ops_workspace_id_idx ON applied_ops (workspace_id);

-- The page tree. parent_id is a nullable self-reference: NULL means a top-level page.
-- sort_key is a fractional-index string, so moving one page is one write on one row.
-- version and updated_at exist on every content row: version backs the base_version comparison in
-- /sync and updated_at feeds the snapshot ETag.
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES pages (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  icon TEXT,
  sort_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX pages_workspace_id_idx ON pages (workspace_id);
-- Serves the sidebar read: children of a parent within a workspace, already in sort order.
CREATE INDEX pages_workspace_parent_sort_idx ON pages (workspace_id, parent_id, sort_key);
