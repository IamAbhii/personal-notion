// Server-side enforcement for every /api route: one middleware that resolves the session, decides
// access through resolveAccess, and checks the caller's role against the capability the request
// needs. There is no route-level opt-out; the unauthenticated surfaces are mounted before it.
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createDb } from '../db/client';
import { isAuthDisabled } from '../env';
import { findMembershipRole } from '../repo/accounts';
import { contextFor, type Ctx } from '../repo/context';
import { findSessionUser, SESSION_COOKIE } from '../repo/sessions';
import type { AppEnv } from '../types';
import { requiredCapability, roleHasCapability } from './capabilities';
import { DEV_OWNER, resolveAccess } from './resolveAccess';

// Authenticates the request, then authorises it against the capability table.
// 401 = no usable session. 403 = a known caller whose account or role is not permitted.
export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  const db = createDb(c.env.DB);
  c.set('db', db);

  // Dev bypass: a fixed synthetic owner, with no sign-in and no cookie. Refused in production by
  // the config check in src/index.ts, so this cannot be switched on by accident where it matters.
  const profile = isAuthDisabled(c.env)
    ? DEV_OWNER
    : await (async () => {
        const sessionId = getCookie(c, SESSION_COOKIE);
        if (!sessionId) return null;
        const session = await findSessionUser(db, sessionId);
        return session ? { email: session.email, name: session.name } : null;
      })();

  if (!profile) {
    return c.json({ error: 'unauthorized', message: 'Sign in to use this space.' }, 401);
  }

  const identity = await resolveAccess({ db, env: c.env }, profile);
  if (!identity) {
    return c.json(
      { error: 'account_not_allowed', message: 'You do not have access to this space.' },
      403,
    );
  }

  const capability = requiredCapability(c.req.method);
  if (!roleHasCapability(identity.role, capability)) {
    return c.json({ error: 'forbidden', message: `Your role cannot ${capability}.` }, 403);
  }

  c.set('identity', identity);
  await next();
});

// Resolves the :workspaceId path segment against the caller's memberships and puts the resulting
// Ctx in the request context for handlers to pass to the repository. A workspace the caller is not a
// member of returns 404 rather than 403, so workspace ids cannot be probed.
export const requireWorkspace = createMiddleware<AppEnv>(async (c, next) => {
  const workspaceId = c.req.param('workspaceId');
  const role = workspaceId
    ? await findMembershipRole(c.var.db, c.var.identity.userId, workspaceId)
    : undefined;
  if (!workspaceId || !role) {
    return c.json({ error: 'not_found', message: 'Workspace not found.' }, 404);
  }
  // The role for this workspace, not the one resolveAccess happened to pick first.
  const ctx: Ctx = contextFor({ ...c.var.identity, role }, workspaceId);
  c.set('ctx', ctx);
  await next();
});
