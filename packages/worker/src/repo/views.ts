// Repository layer for views: load, insert, update, delete. Follows the same ctx-shaped tenancy
// pattern as the other repos so the tenancy seam is enforced at exactly one level.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { Statement } from '../db/batch';
import { views, type ViewRow } from '../db/schema';
import type { Ctx } from './context';

// Loads all view rows for the workspace in (database_page_id, sort_key) order, matching the index
// views_workspace_db_sort_idx so the applier and the snapshot both read in one query.
export async function listViewStates(
  db: Db,
  ctx: Ctx,
): Promise<Pick<ViewRow, 'id' | 'databasePageId' | 'sortKey' | 'version'>[]> {
  return db
    .select({
      id: views.id,
      databasePageId: views.databasePageId,
      sortKey: views.sortKey,
      version: views.version,
    })
    .from(views)
    .where(eq(views.workspaceId, ctx.workspaceId))
    .orderBy(asc(views.databasePageId), asc(views.sortKey));
}

// Loads all view rows for the workspace, including all fields, for the snapshot.
export async function listViews(db: Db, ctx: Ctx): Promise<ViewRow[]> {
  return db
    .select()
    .from(views)
    .where(eq(views.workspaceId, ctx.workspaceId))
    .orderBy(asc(views.databasePageId), asc(views.sortKey));
}

// Builds a complete view row from the applier's data, ready for insertion.
export function buildViewRow(
  ctx: Ctx,
  data: {
    id: string;
    databasePageId: string;
    name: string;
    kind: 'table' | 'board' | 'list';
    groupPropertyId: string | null;
    filters: string; // pre-serialised JSON string
    sort: string | null; // pre-serialised JSON string or null
  },
  sortKey: string,
  now: number,
): ViewRow {
  return {
    id: data.id,
    workspaceId: ctx.workspaceId,
    databasePageId: data.databasePageId,
    name: data.name,
    kind: data.kind,
    groupPropertyId: data.groupPropertyId ?? null,
    filters: data.filters,
    sort: data.sort ?? null,
    sortKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// Statement to insert a view row; used in the applier's dataStatements batch.
export function insertViewStatement(db: Db, row: ViewRow): Statement {
  return db.insert(views).values(row);
}

// Statement to update a subset of a view's fields and bump its version.
export function updateViewStatement(
  db: Db,
  ctx: Ctx,
  id: string,
  patch: {
    name?: string;
    groupPropertyId?: string | null;
    filters?: string; // pre-serialised JSON
    sort?: string | null; // pre-serialised JSON or null
    sortKey?: string;
    version: number;
  },
  now: number,
): Statement {
  const { name, groupPropertyId, filters, sort, sortKey, version } = patch;
  return db
    .update(views)
    .set({
      ...(name !== undefined ? { name } : {}),
      // groupPropertyId can be explicitly set to null (clearing the group), so distinguish
      // "field not present" from "field set to null" with a has-own-property check.
      ...(Object.prototype.hasOwnProperty.call(patch, 'groupPropertyId')
        ? { groupPropertyId: groupPropertyId ?? null }
        : {}),
      ...(filters !== undefined ? { filters } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'sort') ? { sort: sort ?? null } : {}),
      ...(sortKey !== undefined ? { sortKey } : {}),
      version,
      updatedAt: now,
    })
    .where(and(eq(views.id, id), eq(views.workspaceId, ctx.workspaceId)));
}

// Statement to delete a single view.
export function deleteViewStatement(db: Db, ctx: Ctx, id: string): Statement {
  return db.delete(views).where(and(eq(views.id, id), eq(views.workspaceId, ctx.workspaceId)));
}

// Statements to delete all views for a set of database page ids. Used when a database page (or a
// page tree containing databases) is deleted, keeping views in sync with the pages they belong to.
export function deleteViewsForDatabasesStatements(
  db: Db,
  ctx: Ctx,
  databasePageIds: string[],
): Statement[] {
  // One DELETE per database id; D1 has no IN-clause binding support via Drizzle for dynamic lists,
  // so iterating keeps the code simple and the parameter count well within D1's 100-per-query limit.
  // Future: if a single workspace ever has thousands of databases, batch these into larger INs.
  return databasePageIds.map((dbId) =>
    db
      .delete(views)
      .where(and(eq(views.databasePageId, dbId), eq(views.workspaceId, ctx.workspaceId))),
  );
}
