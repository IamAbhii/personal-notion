// Drizzle table definitions mirroring migrations/0001_initial_schema.sql. The SQL migration is the
// source of truth (wrangler applies it in dev, tests and deploy); this file is how the repository
// layer talks about those tables in a typed way.
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

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    parentId: text('parent_id'),
    title: text('title').notNull(),
    icon: text('icon'),
    sortKey: text('sort_key').notNull(),
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
