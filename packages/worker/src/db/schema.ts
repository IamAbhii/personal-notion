// Drizzle table definitions mirroring migrations/0001_initial_schema.sql through 0004_databases.sql.
// The SQL migrations are the source of truth (wrangler applies them in dev, tests and deploy); this
// file is how the repository layer talks about those tables in a typed way.
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleSub: text('google_sub'),
  email: text('email').notNull(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId] }),
    index('workspace_members_user_id_idx').on(table.userId),
  ],
);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const appliedOps = sqliteTable(
  'applied_ops',
  {
    opId: text('op_id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    resultVersion: integer('result_version'),
    clientSeq: integer('client_seq').notNull(),
    appliedAt: integer('applied_at').notNull(),
  },
  (table) => [index('applied_ops_workspace_id_idx').on(table.workspaceId)],
);

// kind is 'page' (default), 'database' or 'row'. Added in migration 0004; existing rows default
// to 'page'. Stored as TEXT rather than an enum because SQLite has no enum type.
export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    parentId: text('parent_id'),
    title: text('title').notNull(),
    icon: text('icon'),
    sortKey: text('sort_key').notNull(),
    kind: text('kind').notNull().default('page'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('pages_workspace_id_idx').on(table.workspaceId),
    index('pages_workspace_parent_sort_idx').on(table.workspaceId, table.parentId, table.sortKey),
  ],
);

export type PageRow = typeof pages.$inferSelect;

// Mirrors migrations/0004_databases.sql. options is stored as a JSON string and parsed server-side
// before the snapshot sends it to the client, because the client needs option metadata constantly.
// Future: a per-property view settings column lands here in Phase 4, when views are added.
export const properties = sqliteTable(
  'properties',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    databasePageId: text('database_page_id').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    options: text('options'),
    sortKey: text('sort_key').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('properties_workspace_db_sort_idx').on(
      table.workspaceId,
      table.databasePageId,
      table.sortKey,
    ),
  ],
);

export type PropertyRow = typeof properties.$inferSelect;

// Mirrors migrations/0004_databases.sql. The composite primary key (row_page_id, property_id)
// makes value.set an upsert, so two devices editing the same cell converge rather than duplicating.
export const propertyValues = sqliteTable(
  'property_values',
  {
    workspaceId: text('workspace_id').notNull(),
    rowPageId: text('row_page_id').notNull(),
    propertyId: text('property_id').notNull(),
    value: text('value'),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.rowPageId, table.propertyId] }),
    index('property_values_workspace_row_idx').on(table.workspaceId, table.rowPageId),
  ],
);

export type PropertyValueRow = typeof propertyValues.$inferSelect;

// Mirrors migrations/0003_blocks.sql. checked is stored as 0/1 because SQLite has no boolean type;
// the snapshot converts it to a boolean on the wire.
export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    pageId: text('page_id').notNull(),
    type: text('type').notNull(),
    text: text('text').notNull().default(''),
    checked: integer('checked').notNull().default(0),
    props: text('props'),
    sortKey: text('sort_key').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('blocks_workspace_page_sort_idx').on(table.workspaceId, table.pageId, table.sortKey),
  ],
);

export type BlockRow = typeof blocks.$inferSelect;

// Mirrors migrations/0005_views.sql. filters is stored as a JSON string (array of ViewFilter) and
// sort as a JSON string (ViewSort object) or null. Both are parsed server-side before the snapshot
// sends them to the client so the client never has to deserialise a nested JSON string.
// Future: per-view column visibility or width settings could be added here as another JSON column.
export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    databasePageId: text('database_page_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    groupPropertyId: text('group_property_id'),
    filters: text('filters').notNull().default('[]'),
    sort: text('sort'),
    sortKey: text('sort_key').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('views_workspace_db_sort_idx').on(table.workspaceId, table.databasePageId, table.sortKey),
  ],
);

export type ViewRow = typeof views.$inferSelect;
