// Applies a batch of ops in client_seq order as a single D1 batch: either the whole chunk lands or
// none of it does, which is what lets the client retry a chunk safely.
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { appliedOps } from '../db/schema';
import { findAppliedOps, recordAppliedOpStatement, type AppliedOpRecord } from '../repo/appliedOps';
import type { Ctx } from '../repo/context';
import {
  buildPageRow,
  deletePagesStatement,
  insertPageStatement,
  listPageStates,
  updatePageStatement,
  type PagePatch,
} from '../repo/pages';
import type { Op, OpResult, VersionMismatch } from './ops';

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

  // One read of the workspace's page skeleton, then every decision is made in memory. Doing it
  // per op would spend the whole D1 query budget on lookups.
  const rows = await listPageStates(db, ctx);
  const state = new Map<string, PageState>(
    rows.map((row) => [
      row.id,
      { version: row.version, parentId: row.parentId, sortKey: row.sortKey },
    ]),
  );

  const now = Date.now();
  const dataStatements: Statement[] = [];
  const records: AppliedOpRecord[] = [];
  const resultsByOpId = new Map<string, OpResult>();
  const versionMismatches: VersionMismatch[] = [];

  const reject = (op: Op, reason: string) => {
    resultsByOpId.set(op.opId, {
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
    resultsByOpId.set(op.opId, {
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
      resultsByOpId.set(op.opId, {
        opId: op.opId,
        status: 'replayed',
        entityId: previous.entityId,
        ...(previous.resultVersion !== null ? { version: previous.resultVersion } : {}),
        ...(previous.reason !== null ? { reason: previous.reason } : {}),
      });
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

    // page.delete
    if (!state.has(op.entityId)) {
      reject(op, 'page no longer exists');
      continue;
    }
    const ids = subtreeIds(state, op.entityId);
    dataStatements.push(deletePagesStatement(db, ctx, ids));
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
      (op) =>
        resultsByOpId.get(op.opId) ?? { opId: op.opId, status: 'rejected', reason: 'unknown' },
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
// chunk that creates several siblings orders them correctly without re-reading the database.
function nextSiblingKey(state: Map<string, PageState>, parentId: string | null): string {
  let last: string | null = null;
  for (const page of state.values()) {
    if (page.parentId !== parentId) continue;
    if (last === null || page.sortKey > last) last = page.sortKey;
  }
  return generateKeyBetween(last, null);
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
