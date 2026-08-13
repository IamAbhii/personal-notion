// Page tree data access. Every read and write filters on ctx.workspaceId, and callers never build
// SQL themselves. Functions come in two flavours: awaited helpers for a single write, and
// *Statement builders that the sync applier collects into one db.batch().
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { pages, type PageRow } from '../db/schema';
import { newId } from '../lib/ids';
import type { Ctx } from './context';

export type PageInput = {
  id?: string;
  parentId?: string | null;
  title?: string;
  icon?: string | null;
  sortKey?: string;
};

export type PagePatch = {
  title?: string;
  icon?: string | null;
  parentId?: string | null;
  sortKey?: string;
};

// Every page in the workspace, in sort_key order. The client builds the tree from parent_id; one
// flat read keeps the snapshot to a single query.
// Future: if a workspace ever outgrows one response, page this by parent_id and stream it.
export function listPages(db: Db, ctx: Ctx): Promise<PageRow[]> {
  return db
    .select()
    .from(pages)
    .where(eq(pages.workspaceId, ctx.workspaceId))
    .orderBy(pages.sortKey);
}

// The tree skeleton: just what the sync applier needs to decide every op in memory (existence,
// version comparison, cascade over descendants, cycle detection) from one query instead of one
// lookup per op.
export function listPageStates(db: Db, ctx: Ctx) {
  return db
    .select({
      id: pages.id,
      version: pages.version,
      parentId: pages.parentId,
      sortKey: pages.sortKey,
    })
    .from(pages)
    .where(eq(pages.workspaceId, ctx.workspaceId));
}

// One page by id, or undefined when it does not exist in this workspace.
export async function getPage(db: Db, ctx: Ctx, id: string): Promise<PageRow | undefined> {
  const rows = await db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, ctx.workspaceId), eq(pages.id, id)))
    .limit(1);
  return rows[0];
}

// The sort_key of the last child of parentId, used to append a new page after its siblings.
export async function lastSiblingSortKey(
  db: Db,
  ctx: Ctx,
  parentId: string | null,
): Promise<string | null> {
  // parent_id IS NULL is not the same query as parent_id = ?, so the two cases are built apart.
  const parentFilter = parentId === null ? isNull(pages.parentId) : eq(pages.parentId, parentId);
  const rows = await db
    .select({ sortKey: pages.sortKey })
    .from(pages)
    .where(and(eq(pages.workspaceId, ctx.workspaceId), parentFilter))
    .orderBy(desc(pages.sortKey))
    .limit(1);
  return rows[0]?.sortKey ?? null;
}

// Builds the row a create op or the seed inserts, filling in defaults. Kept separate from the
// insert so the sync applier can project the new row into its in-memory state.
export function buildPageRow(ctx: Ctx, input: PageInput, sortKey: string, now: number): PageRow {
  return {
    id: input.id ?? newId(),
    workspaceId: ctx.workspaceId,
    parentId: input.parentId ?? null,
    title: input.title ?? 'Untitled',
    icon: input.icon ?? null,
    sortKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// Insert statement for a fully built page row.
export function insertPageStatement(db: Db, row: PageRow): Statement {
  return db.insert(pages).values(row);
}

// Update statement for a patch, bumping version and updated_at. The workspace filter is part of the
// statement, so an op cannot touch another workspace's row even if it knows the id.
export function updatePageStatement(db: Db, ctx: Ctx, id: string, patch: PagePatch, now: number) {
  return db
    .update(pages)
    .set({ ...patch, updatedAt: now, version: sql`${pages.version} + 1` })
    .where(and(eq(pages.workspaceId, ctx.workspaceId), eq(pages.id, id)));
}

// Delete statement for a set of page ids in this workspace (the page plus its descendants).
export function deletePagesStatement(db: Db, ctx: Ctx, ids: string[]): Statement {
  return db
    .delete(pages)
    .where(and(eq(pages.workspaceId, ctx.workspaceId), inArray(pages.id, ids)));
}

// The page plus every descendant, deepest last. Deleting a page removes its whole subtree, so the
// ids are resolved up front with one recursive query rather than N round trips per level.
export async function descendantIds(db: Db, ctx: Ctx, id: string): Promise<string[]> {
  const result = await db.all<{ id: string }>(sql`
    WITH RECURSIVE subtree(id) AS (
      SELECT id FROM pages WHERE workspace_id = ${ctx.workspaceId} AND id = ${id}
      UNION ALL
      SELECT p.id FROM pages p
        JOIN subtree s ON p.parent_id = s.id
       WHERE p.workspace_id = ${ctx.workspaceId}
    )
    SELECT id FROM subtree
  `);
  return result.map((row) => row.id);
}

// Creates a page, appending it after its siblings when no sort_key is supplied.
export async function createPage(db: Db, ctx: Ctx, input: PageInput = {}): Promise<PageRow> {
  const sortKey =
    input.sortKey ??
    generateKeyBetween(await lastSiblingSortKey(db, ctx, input.parentId ?? null), null);
  const row = buildPageRow(ctx, input, sortKey, Date.now());
  await runBatch(db, [insertPageStatement(db, row)]);
  return row;
}

// Applies a patch to a page and returns the stored row, or undefined when it does not exist here.
export async function updatePage(
  db: Db,
  ctx: Ctx,
  id: string,
  patch: PagePatch,
): Promise<PageRow | undefined> {
  const existing = await getPage(db, ctx, id);
  if (!existing) return undefined;
  await runBatch(db, [updatePageStatement(db, ctx, id, patch, Date.now())]);
  return getPage(db, ctx, id);
}

// Deletes a page and its whole subtree in one atomic batch. Deletion is permanent: there is no
// trash, per the product contract.
export async function deletePage(db: Db, ctx: Ctx, id: string): Promise<string[]> {
  const ids = await descendantIds(db, ctx, id);
  if (ids.length === 0) return [];
  await runBatch(db, [deletePagesStatement(db, ctx, ids)]);
  return ids;
}

// Number of pages in the workspace. Used by the seed's idempotency check.
export async function countPages(db: Db, ctx: Ctx): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(pages)
    .where(eq(pages.workspaceId, ctx.workspaceId));
  return rows[0]?.count ?? 0;
}
