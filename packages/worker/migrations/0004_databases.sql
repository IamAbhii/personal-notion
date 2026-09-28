-- Migration 0004: databases, properties and property values for Phase 3.
--
-- A database is a page with kind = 'database'. A row is a page with kind = 'row' whose parentId
-- points to its database page. Both live in the pages table so they inherit title, icon, sortKey,
-- version, cascade-on-delete and (in Phase 5) searchability from the existing page machinery.
--
-- pages gains a kind column with a DEFAULT so every existing row gets kind = 'page' without a
-- backfill. Forward-only: ALTER TABLE ADD COLUMN is the only DDL SQLite allows on an existing table.
ALTER TABLE pages ADD COLUMN kind TEXT NOT NULL DEFAULT 'page';

-- One row per user-defined property on a database page. type is one of:
-- text | number | select | multiSelect | date | checkbox | url
-- options is a JSON array of {id,name,color} for select/multiSelect only; NULL for other types.
-- No REFERENCES pages(id) ON DELETE CASCADE: see migration 0002 and 0003 for why D1 trigger
-- recursion makes ON DELETE CASCADE dangerous. The sync applier deletes properties explicitly.
CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  database_page_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  options TEXT,
  sort_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Serves both the applier (load all properties for a workspace in one read) and the snapshot query.
CREATE INDEX properties_workspace_db_sort_idx
  ON properties (workspace_id, database_page_id, sort_key);

-- One row per cell: a (row_page_id, property_id) pair. value is a JSON-encoded typed value; NULL
-- means the cell is empty. Two devices editing the same cell converge under last-write-wins because
-- the composite primary key makes value.set an upsert rather than an insert of a new row.
-- No REFERENCES: same trigger-recursion reason as above.
CREATE TABLE property_values (
  workspace_id TEXT NOT NULL,
  row_page_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  value TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (row_page_id, property_id)
);

-- Serves loading all values for a workspace in one read and the per-row reads the table view needs.
CREATE INDEX property_values_workspace_row_idx ON property_values (workspace_id, row_page_id);
