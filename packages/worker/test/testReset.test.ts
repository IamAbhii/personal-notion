// Tests for the test-only workspace reset: it exists only under the dev sign-in bypass, it puts the
// workspace back to the seeded tree, it clears the idempotency log, and it touches one workspace.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { DEV_OWNER } from '../src/auth/resolveAccess';
import { appliedOps } from '../src/db/schema';
import { listBlocks } from '../src/repo/blocks';
import { createPage, listPages } from '../src/repo/pages';
import { seedWorkspace } from '../src/seed/seedWorkspace';
import { apiFetch, createAccount, makeOp, OWNER_EMAIL } from './helpers';

const RESET_PATH = (workspaceId: string) => `/api/workspaces/${workspaceId}/test/reset`;

describe('POST /api/workspaces/:workspaceId/test/reset without the bypass', () => {
  it('is not registered at all, so the path 404s as an unknown endpoint', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);

    const response = await apiFetch(RESET_PATH(owner.workspaceId), {
      method: 'POST',
      sessionId: owner.sessionId,
    });

    expect(response.status).toBe(404);
    // The API catch-all's message, not requireWorkspace's "Workspace not found." - which is what
    // proves the route does not exist rather than the workspace being unknown.
    expect(await response.json()).toEqual({ error: 'not_found', message: 'No such endpoint.' });
    // The workspace is untouched.
    expect((await listPages(owner.db, owner.ctx)).length).toBeGreaterThan(0);
  });
});

describe('POST /api/workspaces/:workspaceId/test/reset under the bypass', () => {
  // The bypass admits a fixed synthetic owner, so these tests act as that address.
  beforeEach(() => {
    env.AUTH_DISABLED = 'true';
    env.ALLOWED_EMAIL = DEV_OWNER.email;
  });

  afterEach(() => {
    env.AUTH_DISABLED = 'false';
    env.ALLOWED_EMAIL = OWNER_EMAIL;
  });

  it('puts a modified workspace back to the seeded tree', async () => {
    const owner = await createAccount({ email: DEV_OWNER.email });
    const seeded = await seedWorkspace(owner.db, owner.ctx);
    const before = await listPages(owner.db, owner.ctx);

    // Modify the workspace the way a spec would: add a page the template does not contain.
    const extra = await createPage(owner.db, owner.ctx, {
      title: 'Left over from a previous spec',
    });

    const response = await apiFetch(RESET_PATH(owner.workspaceId), { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ workspaceId: owner.workspaceId });

    const after = await listPages(owner.db, owner.ctx);
    expect(after).toHaveLength(seeded);
    expect(after.map((page) => page.title).sort()).toEqual(before.map((page) => page.title).sort());
    // Fresh rows, so nothing from the previous run survives.
    expect(after.some((page) => page.id === extra.id)).toBe(false);
    expect(after.some((page) => before.some((old) => old.id === page.id))).toBe(false);
    expect(after.every((page) => page.workspaceId === owner.workspaceId)).toBe(true);
  });

  it('clears applied_ops, so a reset run does not see a previous run as already applied', async () => {
    const owner = await createAccount({ email: DEV_OWNER.email });
    await seedWorkspace(owner.db, owner.ctx);

    const op = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), { title: 'Op page' });
    const sync = await apiFetch(`/api/workspaces/${owner.workspaceId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ ops: [op] }),
    });
    expect(sync.status).toBe(200);

    const logged = await owner.db
      .select()
      .from(appliedOps)
      .where(eq(appliedOps.workspaceId, owner.workspaceId));
    expect(logged).toHaveLength(1);

    const response = await apiFetch(RESET_PATH(owner.workspaceId), { method: 'POST' });
    expect(response.status).toBe(200);

    const cleared = await owner.db
      .select()
      .from(appliedOps)
      .where(eq(appliedOps.workspaceId, owner.workspaceId));
    expect(cleared).toHaveLength(0);

    // The same op id is applied again rather than answered from the log.
    const replay = await apiFetch(`/api/workspaces/${owner.workspaceId}/sync`, {
      method: 'POST',
      body: JSON.stringify({ ops: [op] }),
    });
    expect(replay.status).toBe(200);
    const replayed = await owner.db
      .select()
      .from(appliedOps)
      .where(and(eq(appliedOps.workspaceId, owner.workspaceId), eq(appliedOps.opId, op.opId)));
    expect(replayed).toHaveLength(1);
    expect(replayed[0]?.status).toBe('applied');
  });

  it('wipes leftover blocks and puts the seeded blocks back', async () => {
    const owner = await createAccount({ email: DEV_OWNER.email });
    await seedWorkspace(owner.db, owner.ctx);
    const seededBlocks = await listBlocks(owner.db, owner.ctx);
    expect(seededBlocks.length).toBeGreaterThan(0);

    // A block a previous spec would have left behind, on a page the template does not contain.
    const extraPage = await createPage(owner.db, owner.ctx, { title: 'Left over' });
    const strayId = crypto.randomUUID();
    const sync = await apiFetch(`/api/workspaces/${owner.workspaceId}/sync`, {
      method: 'POST',
      body: JSON.stringify({
        ops: [
          makeOp(owner.workspaceId, 'block.create', strayId, {
            pageId: extraPage.id,
            type: 'paragraph',
            text: 'Stray',
          }),
        ],
      }),
    });
    expect(sync.status).toBe(200);

    const response = await apiFetch(RESET_PATH(owner.workspaceId), { method: 'POST' });
    expect(response.status).toBe(200);

    const after = await listBlocks(owner.db, owner.ctx);
    expect(after).toHaveLength(seededBlocks.length);
    // Fresh rows, and no orphan blocks pointing at pages the reset deleted.
    expect(after.some((block) => block.id === strayId)).toBe(false);
    expect(after.some((block) => seededBlocks.some((old) => old.id === block.id))).toBe(false);
    const pageIds = new Set((await listPages(owner.db, owner.ctx)).map((page) => page.id));
    expect(after.every((block) => pageIds.has(block.pageId))).toBe(true);
  });

  it('resets only the workspace in the path', async () => {
    const owner = await createAccount({ email: DEV_OWNER.email });
    const other = await createAccount({ email: 'other@example.com' });
    await seedWorkspace(owner.db, owner.ctx);
    await seedWorkspace(other.db, other.ctx);
    const otherBefore = await listPages(other.db, other.ctx);

    const response = await apiFetch(RESET_PATH(owner.workspaceId), { method: 'POST' });
    expect(response.status).toBe(200);

    const otherAfter = await listPages(other.db, other.ctx);
    expect(otherAfter.map((page) => page.id)).toEqual(otherBefore.map((page) => page.id));
  });

  it('returns 404 for a workspace the caller is not a member of', async () => {
    await createAccount({ email: DEV_OWNER.email });
    const stranger = await createAccount({ email: 'other@example.com' });

    const response = await apiFetch(RESET_PATH(stranger.workspaceId), { method: 'POST' });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: 'Workspace not found.' });
  });
});
