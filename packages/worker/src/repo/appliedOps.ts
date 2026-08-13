// The idempotency log. Every op that reaches /sync gets a row here keyed by its client-minted op_id,
// so a retry after a timeout returns the original outcome instead of applying the op twice.
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import type { Statement } from '../db/batch';
import { appliedOps } from '../db/schema';
import type { Ctx } from './context';

export type AppliedOpRecord = {
  opId: string;
  entity: string;
  entityId: string;
  type: string;
  status: 'applied' | 'rejected';
  reason: string | null;
  resultVersion: number | null;
  clientSeq: number;
};

// Looks up which of these op ids this workspace has already seen, keyed by op id.
export async function findAppliedOps(
  db: Db,
  ctx: Ctx,
  opIds: string[],
): Promise<Map<string, AppliedOpRecord>> {
  if (opIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(appliedOps)
    .where(and(eq(appliedOps.workspaceId, ctx.workspaceId), inArray(appliedOps.opId, opIds)));
  return new Map(
    rows.map((row) => [
      row.opId,
      {
        opId: row.opId,
        entity: row.entity,
        entityId: row.entityId,
        type: row.type,
        status: row.status as 'applied' | 'rejected',
        reason: row.reason,
        resultVersion: row.resultVersion,
        clientSeq: row.clientSeq,
      },
    ]),
  );
}

// Insert statement for one op's outcome. It goes into the same batch as the op's own writes, so the
// log and the data can never disagree.
export function recordAppliedOpStatement(db: Db, ctx: Ctx, record: AppliedOpRecord): Statement {
  return db.insert(appliedOps).values({
    opId: record.opId,
    workspaceId: ctx.workspaceId,
    entity: record.entity,
    entityId: record.entityId,
    type: record.type,
    status: record.status,
    reason: record.reason,
    resultVersion: record.resultVersion,
    clientSeq: record.clientSeq,
    appliedAt: Date.now(),
  });
}
