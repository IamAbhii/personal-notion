// Property data access. Properties define the columns of a database page. Every read and write
// filters on ctx.workspaceId, following the same tenancy pattern as pages.ts and blocks.ts.
// Statement builders exist so the sync applier can collect a whole chunk into one db.batch().
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { Statement } from '../db/batch';
import { properties, type PropertyRow } from '../db/schema';
import { newId } from '../lib/ids';
import type { PropertyType, SelectOption } from '../sync/ops';
import type { Ctx } from './context';

export type PropertyInput = {
  id?: string;
  databasePageId: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
};

export type PropertyPatch = {
  name?: string;
  options?: SelectOption[];
  sortKey?: string;
};

// Every property in the workspace ordered by (database_page_id, sort_key, id). The id tiebreak
// matches the block convention: two concurrent creates under one database can mint the same sort_key.
// Future: if a workspace ever outgrows one response, page this per database_page_id.
export function listProperties(db: Db, ctx: Ctx): Promise<PropertyRow[]> {
  return db
    .select()
    .from(properties)
    .where(eq(properties.workspaceId, ctx.workspaceId))
    .orderBy(properties.databasePageId, properties.sortKey, properties.id);
}

// The skeleton the sync applier needs to decide every property op in memory: existence, version,
// which database the property belongs to, its type (for value validation) and its options.
export function listPropertyStates(db: Db, ctx: Ctx) {
  return db
    .select({
      id: properties.id,
      version: properties.version,
      databasePageId: properties.databasePageId,
      type: properties.type,
      options: properties.options,
      sortKey: properties.sortKey,
    })
    .from(properties)
    .where(eq(properties.workspaceId, ctx.workspaceId));
}

// Builds the row a property.create op or the seed inserts. Kept separate from the insert statement
// so the sync applier can project the new row into its in-memory state.
export function buildPropertyRow(
  ctx: Ctx,
  input: PropertyInput,
  sortKey: string,
  now: number,
): PropertyRow {
  return {
    id: input.id ?? newId(),
    workspaceId: ctx.workspaceId,
    databasePageId: input.databasePageId,
    name: input.name,
    type: input.type,
    // Encode options as JSON for storage; NULL for non-select types.
    options: input.options && input.options.length > 0 ? JSON.stringify(input.options) : null,
    sortKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// Insert statement for a fully built property row.
export function insertPropertyStatement(db: Db, row: PropertyRow): Statement {
  return db.insert(properties).values(row);
}

// Update statement for a patch, bumping version and updated_at. options is re-encoded as JSON when
// present. The workspace filter is part of the statement, so an op cannot touch another workspace.
export function updatePropertyStatement(
  db: Db,
  ctx: Ctx,
  id: string,
  patch: PropertyPatch,
  now: number,
): Statement {
  const { options, ...rest } = patch;
  return db
    .update(properties)
    .set({
      ...rest,
      ...(options !== undefined
        ? { options: options.length > 0 ? JSON.stringify(options) : null }
        : {}),
      updatedAt: now,
      version: sql`${properties.version} + 1`,
    })
    .where(and(eq(properties.workspaceId, ctx.workspaceId), eq(properties.id, id)));
}

// D1 allows 100 bound parameters per query; a delete binds workspace_id plus one per id.
const DELETE_IDS_PER_STATEMENT = 90;

// Delete statement for a single property by id. Used for property.delete ops.
export function deletePropertyStatement(db: Db, ctx: Ctx, id: string): Statement {
  return db
    .delete(properties)
    .where(and(eq(properties.workspaceId, ctx.workspaceId), eq(properties.id, id)));
}

// Delete statements for all properties belonging to the given database pages. Used when a database
// page is deleted, so its property definitions are removed in the same batch.
// Future: if a database could have thousands of properties, the recursive CTE approach used in
// pages.ts would be more efficient; 50 properties per database makes that irrelevant today.
export function deletePropertiesForDatabasesStatements(
  db: Db,
  ctx: Ctx,
  databasePageIds: string[],
): Statement[] {
  const statements: Statement[] = [];
  for (let i = 0; i < databasePageIds.length; i += DELETE_IDS_PER_STATEMENT) {
    const chunk = databasePageIds.slice(i, i + DELETE_IDS_PER_STATEMENT);
    statements.push(
      db
        .delete(properties)
        .where(
          and(
            eq(properties.workspaceId, ctx.workspaceId),
            inArray(properties.databasePageId, chunk),
          ),
        ),
    );
  }
  return statements;
}

// Parses the stored JSON options string into a typed array, or returns [] for null/non-select types.
// The snapshot calls this so the client always receives an array rather than a raw JSON string.
export function parseOptions(raw: string | null): SelectOption[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SelectOption[];
  } catch {
    return [];
  }
}
