// Workspace-scoped routes: the cold-start snapshot read and the sync write path. Both sit behind
// requireWorkspace, so :workspaceId is checked against the caller's memberships before any query.
import { Hono } from 'hono';
import { requireWorkspace } from '../auth/middleware';
import { computeSnapshotEtag, getSnapshot } from '../repo/snapshot';
import { applyOps } from '../sync/apply';
import { MAX_OPS_PER_BATCH, syncRequestSchema } from '../sync/ops';
import type { AppEnv } from '../types';

export const workspaceRoutes = new Hono<AppEnv>();

workspaceRoutes.use('/workspaces/:workspaceId/*', requireWorkspace);

// GET /api/workspaces/:workspaceId/snapshot - the whole workspace in one response, which is what the
// client stores locally to work offline and the only read it needs on cold start.
// The ETag is computed first: an unchanged workspace answers 304 without building the payload at all,
// which matters because this is the handler most likely to hit the 10 ms CPU ceiling.
workspaceRoutes.get('/workspaces/:workspaceId/snapshot', async (c) => {
  const ctx = c.var.ctx;
  const etag = await computeSnapshotEtag(c.var.db, ctx);

  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304, { ETag: etag });
  }

  const snapshot = await getSnapshot(c.var.db, ctx);
  return c.json(snapshot, 200, { ETag: etag, 'Cache-Control': 'no-store' });
});

// POST /api/workspaces/:workspaceId/sync - the only write path in the product. Applies a chunk of
// ops in client_seq order as one atomic D1 batch and reports the outcome of every op.
workspaceRoutes.post('/workspaces/:workspaceId/sync', async (c) => {
  const ctx = c.var.ctx;

  const body = await c.req.json().catch(() => null);
  const parsed = syncRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_request', message: 'Malformed op batch.' }, 400);
  }

  const { ops } = parsed.data;
  // Reject an oversized chunk rather than truncating it: silently dropping ops would lose the user's
  // work. The client chunks at MAX_OPS_PER_BATCH because D1 allows 50 queries per invocation.
  if (ops.length > MAX_OPS_PER_BATCH) {
    return c.json(
      {
        error: 'batch_too_large',
        message: `Send at most ${MAX_OPS_PER_BATCH} ops per request.`,
        maxOps: MAX_OPS_PER_BATCH,
      },
      413,
    );
  }

  // An op carries its own workspace_id; one that disagrees with the path is a client bug or an
  // attempt to write across a tenancy boundary, and the whole chunk is refused.
  const foreign = ops.find((op) => op.workspaceId !== ctx.workspaceId);
  if (foreign) {
    return c.json(
      { error: 'workspace_mismatch', message: 'An op targets a different workspace.' },
      400,
    );
  }

  const outcome = await applyOps(c.var.db, ctx, ops);
  const etag = await computeSnapshotEtag(c.var.db, ctx);
  return c.json({ ...outcome, etag });
});
