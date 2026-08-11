// Applies a batch of ops in client_seq order as a single D1 batch: either the whole chunk lands or
// none of it does, which is what lets the client retry a chunk safely.
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { appliedOps } from '../db/schema';
import { lastInOrder, nextKeyAfter, type Ordered } from '../lib/sortKey';
import { findAppliedOps, recordAppliedOpStatement, type AppliedOpRecord } from '../repo/appliedOps';
import {
  buildBlockRow,
  deleteBlocksForPagesStatements,
  deleteBlocksStatements,
  insertBlockStatement,
  listBlockStates,
  updateBlockStatement,
  type BlockPatch,
} from '../repo/blocks';
import type { Ctx } from '../repo/context';
import {
  buildPageRow,
  deletePagesStatements,
  insertPageStatement,
  listPageStates,
  updatePageStatement,
  type PagePatch,
} from '../repo/pages';
import {
  payloadRejection,
  type BlockType,
  type Op,
  type OpResult,
  type VersionMismatch,
} from './ops';

// applied_ops binds 10 parameters per row, and D1 allows 100 per query, so the outcome log is
// written as multi-row inserts of at most 10 rows. Without this a 25-op chunk would need 25 extra
// statements and blow the 50-queries-per-invocation limit.
const OP_RECORDS_PER_INSERT = 10;

export type SyncOutcome = {
  results: OpResult[];
  versionMismatches: VersionMismatch[];
};

// The subset of each page the applier needs in memory: enough to check existence, compare versions,
// walk the tree for cascade deletes and detect a parent cycle.
type PageState = { version: number; parentId: string | null; sortKey: string };

// The same for blocks: existence, version, which page it sits on and where in that page.
type BlockState = { version: number; pageId: string; sortKey: string };

// Applies ops to a workspace and returns one result per op, in the order they were given.
// Ops are re-ordered to client_seq before applying, because a later op may depend on an earlier one
// (a child created under a page created in the same chunk).
export async function applyOps(db: Db, ctx: Ctx, ops: Op[]): Promise<SyncOutcome> {
  const ordered = [...ops].sort((a, b) => a.clientSeq - b.clientSeq);
  const alreadyApplied = await findAppliedOps(
    db,
    ctx,
    ordered.map((op) => op.opId),
  );

  // Two reads - the page skeleton and the block skeleton - and then every decision is made in
  // memory. Doing it per op would spend the whole D1 query budget on lookups.
  const [rows, blockRows] = await Promise.all([listPageStates(db, ctx), listBlockStates(db, ctx)]);
  const state = new Map<string, PageState>(
    rows.map((row) => [
      row.id,
      { version: row.version, parentId: row.parentId, sortKey: row.sortKey },
    ]),
  );
  const blockState = new Map<string, BlockState>(
    blockRows.map((row) => [
      row.id,
      { version: row.version, pageId: row.pageId, sortKey: row.sortKey },
    ]),
  );

  const now = Date.now();
  const dataStatements: Statement[] = [];
  const records: AppliedOpRecord[] = [];
  // Results are keyed by op object, not by opId, because one batch may legally contain the same
  // opId twice and each occurrence needs its own line in the response.
  const resultByOp = new Map<Op, OpResult>();
  const firstResultByOpId = new Map<string, OpResult>();
  const versionMismatches: VersionMismatch[] = [];

  // Stores an op's outcome, and remembers the first outcome seen for each opId so a duplicate of it
  // later in the same batch can report a replay instead of applying again.
  const record = (op: Op, result: OpResult) => {
    resultByOp.set(op, result);
    if (!firstResultByOpId.has(op.opId)) firstResultByOpId.set(op.opId, result);
  };

  const reject = (op: Op, reason: string) => {
    record(op, {
      opId: op.opId,
      status: 'rejected',
      reason,
      entityId: op.entityId,
    });
    records.push({
      opId: op.opId,
      entity: op.entity,
      entityId: op.entityId,
      type: op.type,
      status: 'rejected',
      reason,
      resultVersion: null,
      clientSeq: op.clientSeq,
    });
  };

  // version is null for a delete: the row is gone, so there is no version to report.
  const accept = (op: Op, version: number | null) => {
    record(op, {
      opId: op.opId,
      status: 'applied',
      entityId: op.entityId,
      ...(version !== null ? { version } : {}),
    });
    records.push({
      opId: op.opId,
      entity: op.entity,
      entityId: op.entityId,
      type: op.type,
      status: 'applied',
      reason: null,
      resultVersion: version,
      clientSeq: op.clientSeq,
    });
  };

  for (const op of ordered) {
    // A replayed op returns its original outcome rather than applying twice. This is what makes a
    // retry after a mobile timeout safe.
    const previous = alreadyApplied.get(op.opId);
    if (previous) {
      record(op, {
        opId: op.opId,
        status: 'replayed',
        entityId: previous.entityId,
        ...(previous.resultVersion !== null ? { version: previous.resultVersion } : {}),
        ...(previous.reason !== null ? { reason: previous.reason } : {}),
      });
      continue;
    }

    // The same opId twice inside one batch is the same idempotency case as a cross-request retry:
    // the first occurrence is applied and the rest report its outcome. Applying both would violate
    // the applied_ops primary key and take the whole batch down with it.
    const earlier = firstResultByOpId.get(op.opId);
    if (earlier) {
      resultByOp.set(op, { ...earlier, status: 'replayed' });
      continue;
    }

    // Field limits and sort-key validity are checked here rather than in the zod schema, so one bad
    // field costs the client that op and not the whole batch.
    const badPayload = payloadRejection(op);
    if (badPayload) {
      reject(op, badPayload);
      continue;
    }

    if (op.type === 'page.create') {
      if (state.has(op.entityId)) {
        reject(op, 'page already exists');
        continue;
      }
      const parentId = op.payload.parentId ?? null;
      // An op whose target no longer exists is dropped, not resurrected: recreating a deleted
      // ancestor to host an orphan would silently undo an explicit deletion.
      if (parentId !== null && !state.has(parentId)) {
        reject(op, 'parent page no longer exists');
        continue;
      }
      const sortKey = op.payload.sortKey ?? nextSiblingKey(state, parentId);
      const row = buildPageRow(
        ctx,
        {
          id: op.entityId,
          parentId,
          title: op.payload.title,
          icon: op.payload.icon,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertPageStatement(db, row));
      state.set(row.id, { version: row.version, parentId, sortKey });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'page.update') {
      const current = state.get(op.entityId);
      if (!current) {
        reject(op, 'page no longer exists');
        continue;
      }
      const patch: PagePatch = op.payload;
      if (patch.parentId !== undefined && patch.parentId !== null) {
        if (!state.has(patch.parentId)) {
          reject(op, 'parent page no longer exists');
          continue;
        }
        if (createsCycle(state, op.entityId, patch.parentId)) {
          reject(op, 'a page cannot be moved inside itself');
          continue;
        }
      }
      // Future: reject on mismatch to enable optimistic concurrency. Today the policy is last write
      // wins by server arrival order, and the mismatch is reported so the client can tell the user
      // "N changes overwrote newer edits" instead of losing them silently.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }
      dataStatements.push(updatePageStatement(db, ctx, op.entityId, patch, now));
      const nextVersion = current.version + 1;
      state.set(op.entityId, {
        version: nextVersion,
        parentId: patch.parentId !== undefined ? patch.parentId : current.parentId,
        sortKey: patch.sortKey ?? current.sortKey,
      });
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'block.create') {
      if (blockState.has(op.entityId)) {
        reject(op, 'block already exists');
        continue;
      }
      // A block on a page that is gone would be invisible and undeletable, so it is dropped rather
      // than resurrecting the page.
      if (!state.has(op.payload.pageId)) {
        reject(op, 'page no longer exists');
        continue;
      }
      const sortKey = op.payload.sortKey ?? nextBlockKey(blockState, op.payload.pageId);
      const row = buildBlockRow(
        ctx,
        {
          id: op.entityId,
          pageId: op.payload.pageId,
          // Checked by payloadRejection above, so the cast narrows rather than assumes.
          type: op.payload.type as BlockType,
          text: op.payload.text,
          checked: op.payload.checked,
          props: op.payload.props,
        },
        sortKey,
        now,
      );
      dataStatements.push(insertBlockStatement(db, row));
      blockState.set(row.id, { version: row.version, pageId: row.pageId, sortKey });
      accept(op, row.version);
      continue;
    }

    if (op.type === 'block.update') {
      const current = blockState.get(op.entityId);
      if (!current) {
        reject(op, 'block no longer exists');
        continue;
      }
      // Built field by field rather than spread, because the payload also carries pageId, which
      // payloadRejection has already refused and which must never reach the update statement.
      const patch: BlockPatch = {
        ...(op.payload.type !== undefined ? { type: op.payload.type } : {}),
        ...(op.payload.text !== undefined ? { text: op.payload.text } : {}),
        ...(op.payload.checked !== undefined ? { checked: op.payload.checked } : {}),
        ...(op.payload.props !== undefined ? { props: op.payload.props } : {}),
        ...(op.payload.sortKey !== undefined ? { sortKey: op.payload.sortKey } : {}),
      };
      // Future: reject on mismatch to enable optimistic concurrency. Today the policy is last write
      // wins by server arrival order, and the mismatch is reported so the client can tell the user.
      if (typeof op.baseVersion === 'number' && op.baseVersion !== current.version) {
        versionMismatches.push({
          opId: op.opId,
          entityId: op.entityId,
          baseVersion: op.baseVersion,
          serverVersion: current.version,
        });
      }
      dataStatements.push(updateBlockStatement(db, ctx, op.entityId, patch, now));
      const nextVersion = current.version + 1;
      blockState.set(op.entityId, {
        version: nextVersion,
        pageId: current.pageId,
        sortKey: patch.sortKey ?? current.sortKey,
      });
      accept(op, nextVersion);
      continue;
    }

    if (op.type === 'block.delete') {
      if (!blockState.has(op.entityId)) {
        reject(op, 'block no longer exists');
        continue;
      }
      dataStatements.push(...deleteBlocksStatements(db, ctx, [op.entityId]));
      blockState.delete(op.entityId);
      accept(op, null);
      continue;
    }

    // page.delete
    if (!state.has(op.entityId)) {
      reject(op, 'page no longer exists');
      continue;
    }
    const ids = subtreeIds(state, op.entityId);
    dataStatements.push(...deletePagesStatements(db, ctx, ids));
    // The blocks of every deleted page go in the same batch: a page delete that left its blocks
    // behind would leak rows nothing can ever reach. Only emitted when the subtree actually has
    // blocks, so a delete of an empty page still costs one statement.
    const deletedPageIds = new Set(ids);
    const pagesWithBlocks = new Set<string>();
    for (const [blockId, block] of blockState) {
      if (!deletedPageIds.has(block.pageId)) continue;
      pagesWithBlocks.add(block.pageId);
      blockState.delete(blockId);
    }
    if (pagesWithBlocks.size > 0) {
      dataStatements.push(...deleteBlocksForPagesStatements(db, ctx, [...pagesWithBlocks]));
    }
    for (const id of ids) state.delete(id);
    accept(op, null);
  }

  // The data writes and the idempotency log go into one batch, so the log can never disagree with
  // the data D1 actually holds.
  const recordStatements: Statement[] = [];
  for (let i = 0; i < records.length; i += OP_RECORDS_PER_INSERT) {
    const chunk = records.slice(i, i + OP_RECORDS_PER_INSERT);
    recordStatements.push(recordAppliedOpsStatement(db, ctx, chunk));
  }
  await runBatch(db, [...dataStatements, ...recordStatements]);

  return {
    results: ops.map(
      (op) => resultByOp.get(op) ?? { opId: op.opId, status: 'rejected', reason: 'unknown' },
    ),
    versionMismatches,
  };
}

// Multi-row insert of op outcomes. Falls back to the single-row builder for a chunk of one so there
// is one code path for the common case of a single op.
function recordAppliedOpsStatement(db: Db, ctx: Ctx, chunk: AppliedOpRecord[]): Statement {
  const [first] = chunk;
  if (chunk.length === 1 && first) return recordAppliedOpStatement(db, ctx, first);
  const appliedAt = Date.now();
  return db.insert(appliedOps).values(
    chunk.map((record) => ({
      opId: record.opId,
      workspaceId: ctx.workspaceId,
      entity: record.entity,
      entityId: record.entityId,
      type: record.type,
      status: record.status,
      reason: record.reason,
      resultVersion: record.resultVersion,
      clientSeq: record.clientSeq,
      appliedAt,
    })),
  );
}

// The next fractional sort_key after the last child of parentId, computed from projected state so a
// chunk that creates several siblings orders them correctly without re-reading the database. "Last"
// is decided by lastInOrder, the same (sort_key, id) order the reads use, so the key returned is a
// genuine upper bound on the siblings even when two of them share a key (DEF-016).
function nextSiblingKey(state: Map<string, PageState>, parentId: string | null): string {
  const siblings = ordered(state, (page) => page.parentId === parentId);
  return nextKeyAfter(lastInOrder(siblings)?.sortKey ?? null);
}

// The next fractional sort_key after the last block of pageId, computed from projected state so a
// chunk that appends several blocks to one page orders them correctly without re-reading the database.
// Same (sort_key, id) notion of "last" as nextSiblingKey.
function nextBlockKey(state: Map<string, BlockState>, pageId: string): string {
  const onPage = ordered(state, (block) => block.pageId === pageId);
  return nextKeyAfter(lastInOrder(onPage)?.sortKey ?? null);
}

// The matching entries of a projected state map as Ordered rows, pairing each row's sort_key with the
// id the map is keyed by so the tiebreak has something to compare.
function ordered<T extends { sortKey: string }>(
  state: Map<string, T>,
  matches: (row: T) => boolean,
): Ordered[] {
  const rows: Ordered[] = [];
  for (const [id, row] of state) {
    if (matches(row)) rows.push({ id, sortKey: row.sortKey });
  }
  return rows;
}

// The page plus every descendant, from projected state, so a delete cascades over children created
// earlier in the same chunk.
function subtreeIds(state: Map<string, PageState>, rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1) {
    const parentId = ids[i];
    for (const [id, page] of state) {
      if (page.parentId === parentId) ids.push(id);
    }
  }
  return ids;
}

// True when moving pageId under newParentId would make the tree cyclic.
function createsCycle(state: Map<string, PageState>, pageId: string, newParentId: string): boolean {
  let cursor: string | null = newParentId;
  while (cursor !== null) {
    if (cursor === pageId) return true;
    cursor = state.get(cursor)?.parentId ?? null;
  }
  return false;
}
