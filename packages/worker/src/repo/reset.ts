// Clearing a workspace back to its seeded state. This exists for the end-to-end suite, so each spec
// starts from a known tree instead of depending on the order the specs happen to run in.
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { appliedOps, blocks, pages, properties, propertyValues } from '../db/schema';
import { buildSeedStatements } from '../seed/seedWorkspace';
import type { Ctx } from './context';

// Deletes every content row in the workspace, clears its idempotency log, and reseeds it from the
// template - all in one D1 batch, because D1 has no interactive transactions and a half-applied
// reset would leave an empty workspace behind. Returns the number of pages seeded.
// The applied_ops rows go too: a fresh run replays op ids of its own, but leaving a previous run's
// log behind means an op id collision would be answered from the log instead of being applied.
// Future: Phase 4 adds views; delete them here alongside pages, blocks, properties and values, in
// the same batch, child rows first.
export async function resetWorkspace(db: Db, ctx: Ctx): Promise<number> {
  const { statements: seedStatements, pageCount } = buildSeedStatements(db, ctx, Date.now());
  const statements: Statement[] = [
    // Child rows first so foreign-key tools that inspect referential integrity see a clean state.
    db.delete(propertyValues).where(eq(propertyValues.workspaceId, ctx.workspaceId)),
    db.delete(properties).where(eq(properties.workspaceId, ctx.workspaceId)),
    db.delete(blocks).where(eq(blocks.workspaceId, ctx.workspaceId)),
    db.delete(pages).where(eq(pages.workspaceId, ctx.workspaceId)),
    db.delete(appliedOps).where(eq(appliedOps.workspaceId, ctx.workspaceId)),
    ...seedStatements,
  ];
  await runBatch(db, statements);
  return pageCount;
}
