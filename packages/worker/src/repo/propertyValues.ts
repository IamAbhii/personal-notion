// Property value data access. A value row is one cell: the intersection of a row page and a
// property. The composite primary key (row_page_id, property_id) means value.set is an upsert -
// two devices editing the same cell converge under last-write-wins instead of creating duplicates.
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { Statement } from '../db/batch';
import { propertyValues, type PropertyValueRow } from '../db/schema';
import type { Ctx } from './context';

// Every value in the workspace ordered by (row_page_id, property_id). One flat read for the
// snapshot; the client groups by row_page_id and property_id locally.
// Future: if a workspace grows very large, page values per database_page_id on demand.
export function listValues(db: Db, ctx: Ctx): Promise<PropertyValueRow[]> {
  return db
    .select()
    .from(propertyValues)
    .where(eq(propertyValues.workspaceId, ctx.workspaceId))
    .orderBy(propertyValues.rowPageId, propertyValues.propertyId);
}

// The skeleton the sync applier needs to decide every value.set op in memory: the composite key and
// the current version, so append vs update can be projected without a per-op DB read.
export function listValueStates(db: Db, ctx: Ctx) {
  return db
    .select({
      rowPageId: propertyValues.rowPageId,
      propertyId: propertyValues.propertyId,
      version: propertyValues.version,
    })
    .from(propertyValues)
    .where(eq(propertyValues.workspaceId, ctx.workspaceId));
}

// Upsert statement for a value.set op. Inserts a new row or updates an existing one on conflict.
// The version is incremented on update so ETag and version-mismatch detection both work correctly.
// nextVersion is the caller's in-memory projection of the resulting version (1 for a fresh insert,
// current + 1 for an update), passed in so the statement and the applier's state agree.
export function upsertValueStatement(
  db: Db,
  ctx: Ctx,
  rowPageId: string,
  propertyId: string,
  value: string | null,
  nextVersion: number,
  now: number,
): Statement {
  return db
    .insert(propertyValues)
    .values({
      workspaceId: ctx.workspaceId,
      rowPageId,
      propertyId,
      value,
      version: nextVersion,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [propertyValues.rowPageId, propertyValues.propertyId],
      set: {
        value,
        version: sql`${propertyValues.version} + 1`,
        updatedAt: now,
      },
    });
}

// D1 allows 100 bound parameters per query; a delete binds workspace_id plus one per id.
const DELETE_IDS_PER_STATEMENT = 90;

// Delete statements for all values belonging to the given row pages. Used when a row page is
// deleted (directly or as part of a database cascade), so its cells are removed in the same batch.
export function deleteValuesForRowsStatements(db: Db, ctx: Ctx, rowPageIds: string[]): Statement[] {
  const statements: Statement[] = [];
  for (let i = 0; i < rowPageIds.length; i += DELETE_IDS_PER_STATEMENT) {
    const chunk = rowPageIds.slice(i, i + DELETE_IDS_PER_STATEMENT);
    statements.push(
      db
        .delete(propertyValues)
        .where(
          and(
            eq(propertyValues.workspaceId, ctx.workspaceId),
            inArray(propertyValues.rowPageId, chunk),
          ),
        ),
    );
  }
  return statements;
}

// Delete statements for all values belonging to the given property ids. Used when a property is
// deleted so its cells are removed in the same batch, and as part of a database page cascade.
export function deleteValuesForPropertiesStatements(
  db: Db,
  ctx: Ctx,
  propertyIds: string[],
): Statement[] {
  const statements: Statement[] = [];
  for (let i = 0; i < propertyIds.length; i += DELETE_IDS_PER_STATEMENT) {
    const chunk = propertyIds.slice(i, i + DELETE_IDS_PER_STATEMENT);
    statements.push(
      db
        .delete(propertyValues)
        .where(
          and(
            eq(propertyValues.workspaceId, ctx.workspaceId),
            inArray(propertyValues.propertyId, chunk),
          ),
        ),
    );
  }
  return statements;
}
