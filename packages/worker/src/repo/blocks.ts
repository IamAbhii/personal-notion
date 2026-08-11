// Block data access, the content of a page. Same shape as repo/pages: every read and write filters on
// ctx.workspaceId, and the *Statement builders exist so the sync applier can collect a whole chunk
// into one db.batch().
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { Statement } from '../db/batch';
import { blocks, type BlockRow } from '../db/schema';
import { newId } from '../lib/ids';
import type { BlockType } from '../sync/ops';
import type { Ctx } from './context';

export type BlockInput = {
  id?: string;
  pageId: string;
  type: BlockType;
  text?: string;
  checked?: boolean;
  props?: string | null;
};

export type BlockPatch = {
  type?: string;
  text?: string;
  checked?: boolean;
  props?: string | null;
  sortKey?: string;
};

// Every block in the workspace, in (sort_key, id) order, for the snapshot. One flat read: the client
// groups by page_id, which costs nothing there and saves a query per page here.
// The id is part of the ORDER BY, not decoration: two concurrent appends can mint the same sort_key
// (DEF-016), and without a tiebreak SQLite would return those rows in an arbitrary order that could
// differ between reads. id is a stable uuid, so every read and every client agrees.
// Future: if a workspace outgrows one response, read blocks per page on demand and keep only the open
// page's blocks in the snapshot.
export function listBlocks(db: Db, ctx: Ctx): Promise<BlockRow[]> {
  return db
    .select()
    .from(blocks)
    .where(eq(blocks.workspaceId, ctx.workspaceId))
    .orderBy(blocks.sortKey, blocks.id);
}

// The skeleton the sync applier needs to decide every block op in memory: existence, version
// comparison, and which page a block belongs to so an append key can be computed.
export function listBlockStates(db: Db, ctx: Ctx) {
  return db
    .select({
      id: blocks.id,
      version: blocks.version,
      pageId: blocks.pageId,
      sortKey: blocks.sortKey,
    })
    .from(blocks)
    .where(eq(blocks.workspaceId, ctx.workspaceId));
}

// One block by id, or undefined when it does not exist in this workspace.
export async function getBlock(db: Db, ctx: Ctx, id: string): Promise<BlockRow | undefined> {
  const rows = await db
    .select()
    .from(blocks)
    .where(and(eq(blocks.workspaceId, ctx.workspaceId), eq(blocks.id, id)))
    .limit(1);
  return rows[0];
}

// Builds the row a create op or the seed inserts, filling in defaults. Kept separate from the insert
// so the sync applier can project the new row into its in-memory state.
export function buildBlockRow(ctx: Ctx, input: BlockInput, sortKey: string, now: number): BlockRow {
  return {
    id: input.id ?? newId(),
    workspaceId: ctx.workspaceId,
    pageId: input.pageId,
    type: input.type,
    text: input.text ?? '',
    checked: input.checked ? 1 : 0,
    props: input.props ?? null,
    sortKey,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

// Insert statement for a fully built block row.
export function insertBlockStatement(db: Db, row: BlockRow): Statement {
  return db.insert(blocks).values(row);
}

// Update statement for a patch, bumping version and updated_at. checked is mapped to 0/1 here, so the
// rest of the code deals only in booleans. The workspace filter is part of the statement, so an op
// cannot touch another workspace's row even if it knows the id.
export function updateBlockStatement(
  db: Db,
  ctx: Ctx,
  id: string,
  patch: BlockPatch,
  now: number,
): Statement {
  const { checked, ...rest } = patch;
  return db
    .update(blocks)
    .set({
      ...rest,
      ...(checked !== undefined ? { checked: checked ? 1 : 0 } : {}),
      updatedAt: now,
      version: sql`${blocks.version} + 1`,
    })
    .where(and(eq(blocks.workspaceId, ctx.workspaceId), eq(blocks.id, id)));
}

// D1 allows 100 bound parameters per query, and a delete binds the workspace id plus one id per row,
// so id lists are cut into chunks of this size.
const DELETE_IDS_PER_STATEMENT = 90;

// Delete statements for a set of block ids in this workspace.
export function deleteBlocksStatements(db: Db, ctx: Ctx, ids: string[]): Statement[] {
  return chunked(ids, (chunk) =>
    db
      .delete(blocks)
      .where(and(eq(blocks.workspaceId, ctx.workspaceId), inArray(blocks.id, chunk))),
  );
}

// Delete statements for every block on the given pages: how a page delete cascades to its content.
// Deleting by page_id rather than by block id keeps a page with hundreds of blocks to one statement,
// which matters because D1 allows only 50 queries per invocation.
// Future: a delete of thousands of pages at once would need more statements than that budget allows;
// the change then is one DELETE whose page id list comes from the recursive CTE in descendantIds,
// which binds two parameters whatever the subtree's size.
export function deleteBlocksForPagesStatements(db: Db, ctx: Ctx, pageIds: string[]): Statement[] {
  return chunked(pageIds, (chunk) =>
    db
      .delete(blocks)
      .where(and(eq(blocks.workspaceId, ctx.workspaceId), inArray(blocks.pageId, chunk))),
  );
}

// Cuts an id list into parameter-safe chunks and builds one statement per chunk.
function chunked(ids: string[], build: (chunk: string[]) => Statement): Statement[] {
  const statements: Statement[] = [];
  for (let i = 0; i < ids.length; i += DELETE_IDS_PER_STATEMENT) {
    statements.push(build(ids.slice(i, i + DELETE_IDS_PER_STATEMENT)));
  }
  return statements;
}
