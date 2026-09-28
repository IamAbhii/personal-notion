// The test-only workspace reset route. It is registered by src/index.ts only when the dev sign-in
// bypass is on, so with the bypass off - which is every production deployment - the path does not
// exist and the API catch-all answers 404.
// Future: this endpoint is bypass-only by construction and must never gain a production code path.
// If a future phase needs a reset in a real environment, that is a separate, authorised, audited
// endpoint, not a flag on this one.
import { Hono } from 'hono';
import { requireWorkspace } from '../auth/middleware';
import { isAuthDisabled, isProduction, type Env } from '../env';
import { resetWorkspace } from '../repo/reset';
import type { AppEnv } from '../types';

// Whether the reset route may be registered at all: only under the dev bypass, and never when the
// Worker is running as production. Checked at registration time rather than inside the handler, so
// there is no code path from a production request to the reset logic.
export function isTestResetEnabled(env: Env): boolean {
  return isAuthDisabled(env) && !isProduction(env);
}

export const testResetRoutes = new Hono<AppEnv>();

// POST /api/workspaces/:workspaceId/test/reset - wipes the workspace's content and reseeds it from
// the template, so an end-to-end spec can start from the known seeded tree. Guarded by
// requireWorkspace like every other workspace-scoped route: an unknown workspace is still a 404.
testResetRoutes.post('/workspaces/:workspaceId/test/reset', requireWorkspace, async (c) => {
  await resetWorkspace(c.var.db, c.var.ctx);
  return c.json({ workspaceId: c.var.ctx.workspaceId });
});
