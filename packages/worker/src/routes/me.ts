// GET /api/me - the signed-in user plus their workspace memberships, and the one place a workspace
// is created and seeded.
import { Hono } from 'hono';
import { createWorkspaceForUser, findUserById, listMemberships } from '../repo/accounts';
import { contextFor } from '../repo/context';
import { seedWorkspace } from '../seed/seedWorkspace';
import type { AppEnv } from '../types';

export const meRoutes = new Hono<AppEnv>();

// Returns { user, memberships }. memberships is an array holding one element today; the client picks
// its workspace from the list and never hardcodes an id.
// A resolved user with no workspace yet gets one created, its membership row written and the seed
// template applied in this same request, so first launch is populated with no extra start step and
// the multi-account future gets a populated first run for free.
meRoutes.get('/me', async (c) => {
  const db = c.var.db;
  const identity = c.var.identity;

  if (identity.workspaceId === null) {
    const membership = await createWorkspaceForUser(db, identity.userId, 'My Space');
    await seedWorkspace(db, contextFor(identity, membership.workspaceId));
  }

  const memberships = await listMemberships(db, identity.userId);
  const user = await findUserById(db, identity.userId);

  return c.json({
    user: { id: identity.userId, email: user?.email ?? '', name: user?.name ?? '' },
    memberships,
  });
});
