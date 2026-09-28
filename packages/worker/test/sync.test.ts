// Tests for the only write path in the product: op application order, idempotent replay, the 25-op
// chunk limit, rejection of ops whose target is gone, cascade deletes and version mismatch reporting.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getPage, listPages } from '../src/repo/pages';
import { apiFetch, createAccount, makeOp } from './helpers';

type SyncResponse = {
  results: { opId: string; status: string; reason?: string; entityId?: string; version?: number }[];
  versionMismatches: {
    opId: string;
    entityId: string;
    baseVersion: number;
    serverVersion: number;
  }[];
  etag: string;
};

// Posts a chunk of ops as the given account.
function sync(account: { workspaceId: string; sessionId: string }, ops: unknown[]) {
  return apiFetch(`/api/workspaces/${account.workspaceId}/sync`, {
    method: 'POST',
    sessionId: account.sessionId,
    body: JSON.stringify({ ops }),
  });
}

describe('POST /api/workspaces/:workspaceId/sync', () => {
  it('applies page.create, page.update and page.delete in clientSeq order', async () => {
    const owner = await createAccount();
    const parentId = crypto.randomUUID();
    const childId = crypto.randomUUID();

    // Deliberately out of order in the request body: the server sorts by clientSeq, so the child's
    // create still sees its parent.
    const child = makeOp(owner.workspaceId, 'page.create', childId, {
      parentId,
      title: 'Lighting ideas',
      icon: '💡',
    });
    const parent = makeOp(owner.workspaceId, 'page.create', parentId, {
      title: 'Flat renovation',
      icon: '🏡',
    });
    parent.clientSeq = child.clientSeq - 1;

    const response = await sync(owner, [child, parent]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponse;
    expect(body.results.map((result) => result.status)).toEqual(['applied', 'applied']);
    expect(body.etag).toBeTruthy();

    const stored = await getPage(owner.db, owner.ctx, childId);
    expect(stored).toMatchObject({ parentId, title: 'Lighting ideas', icon: '💡', version: 1 });

    const rename = makeOp(owner.workspaceId, 'page.update', parentId, { title: 'The flat' });
    const renameBody = (await (await sync(owner, [rename])).json()) as SyncResponse;
    expect(renameBody.results[0]).toMatchObject({ status: 'applied', version: 2 });
    expect((await getPage(owner.db, owner.ctx, parentId))?.title).toBe('The flat');

    const remove = makeOp(owner.workspaceId, 'page.delete', parentId);
    const removeBody = (await (await sync(owner, [remove])).json()) as SyncResponse;
    expect(removeBody.results[0]?.status).toBe('applied');
    // A deleted row has no version left to report.
    expect(removeBody.results[0]).not.toHaveProperty('version');
    // The delete cascades: the child goes with the parent.
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('replays an op idempotently, returning its original outcome', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    const op = makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Journal', icon: '📓' });

    const first = (await (await sync(owner, [op])).json()) as SyncResponse;
    expect(first.results[0]).toMatchObject({ status: 'applied', entityId: pageId, version: 1 });

    const replay = (await (await sync(owner, [op])).json()) as SyncResponse;
    expect(replay.results[0]).toMatchObject({ status: 'replayed', entityId: pageId, version: 1 });

    // Applied once, not twice.
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(1);
  });

  it('rejects a batch of more than 25 ops with 413 and applies none of them', async () => {
    const owner = await createAccount();
    const ops = Array.from({ length: 26 }, () =>
      makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), { title: 'Page' }),
    );

    const response = await sync(owner, ops);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'batch_too_large', maxOps: 25 });
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('accepts a batch of exactly 25 ops', async () => {
    const owner = await createAccount();
    const ops = Array.from({ length: 25 }, () =>
      makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), { title: 'Page' }),
    );

    const response = await sync(owner, ops);
    expect(response.status).toBe(200);
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(25);
  });

  it('rejects an op whose parent was deleted rather than resurrecting it', async () => {
    const owner = await createAccount();
    const parentId = crypto.randomUUID();
    await sync(owner, [makeOp(owner.workspaceId, 'page.create', parentId, { title: 'Projects' })]);
    await sync(owner, [makeOp(owner.workspaceId, 'page.delete', parentId)]);

    const orphan = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), {
      parentId,
      title: 'Orphan',
    });
    const body = (await (await sync(owner, [orphan])).json()) as SyncResponse;
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('rejects an update to a page that no longer exists', async () => {
    const owner = await createAccount();
    const op = makeOp(owner.workspaceId, 'page.update', crypto.randomUUID(), { title: 'Ghost' });

    const body = (await (await sync(owner, [op])).json()) as SyncResponse;
    expect(body.results[0]).toMatchObject({ status: 'rejected' });
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });

  it('applies a baseVersion mismatch as last write wins but reports it', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    await sync(owner, [makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Notes' })]);
    await sync(owner, [makeOp(owner.workspaceId, 'page.update', pageId, { title: 'Notes v2' })]);

    // The page is now at version 2; this op believed it was editing version 1.
    const stale = makeOp(
      owner.workspaceId,
      'page.update',
      pageId,
      { title: 'Stale title' },
      { baseVersion: 1 },
    );
    const body = (await (await sync(owner, [stale])).json()) as SyncResponse;

    expect(body.results[0]?.status).toBe('applied');
    expect(body.versionMismatches).toEqual([
      { opId: stale.opId, entityId: pageId, baseVersion: 1, serverVersion: 2 },
    ]);
    expect((await getPage(owner.db, owner.ctx, pageId))?.title).toBe('Stale title');
  });

  it('rejects a chunk containing an op for a different workspace', async () => {
    const owner = await createAccount();
    const other = await createAccount({ email: 'other@example.com' });
    const op = makeOp(other.workspaceId, 'page.create', crypto.randomUUID(), { title: 'Cross' });

    const response = await sync(owner, [op]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'workspace_mismatch' });
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('returns 404 when syncing to a workspace the session is not a member of', async () => {
    const owner = await createAccount();
    const other = await createAccount({ email: 'other@example.com' });

    const response = await apiFetch(`/api/workspaces/${other.workspaceId}/sync`, {
      method: 'POST',
      sessionId: owner.sessionId,
      body: JSON.stringify({ ops: [] }),
    });
    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed op batch', async () => {
    const owner = await createAccount();
    const response = await sync(owner, [{ opId: 'x', type: 'page.create' }]);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  // DEF-002: the cascade used to be an ON DELETE CASCADE foreign key, which SQLite runs as a
  // trigger, and D1 caps trigger recursion at nine levels. Pages nest to any depth, so the subtree
  // is now computed in the repository layer and deleted explicitly.
  describe.each([1, 9, 10, 25, 60])('deleting a chain of depth %i', (depth) => {
    it('removes every descendant and leaves siblings alone', async () => {
      const owner = await createAccount();
      const chain = Array.from({ length: depth }, () => crypto.randomUUID());
      const siblingId = crypto.randomUUID();

      // Created in chunks of 25, the batch limit: one op per level, each parented to the level above.
      for (let start = 0; start < chain.length; start += 25) {
        const ops = chain.slice(start, start + 25).map((id, offset) => {
          const index = start + offset;
          return makeOp(owner.workspaceId, 'page.create', id, {
            title: `Level ${index}`,
            parentId: index === 0 ? null : chain[index - 1],
          });
        });
        const response = await sync(owner, ops);
        expect(response.status).toBe(200);
      }
      await sync(owner, [
        makeOp(owner.workspaceId, 'page.create', siblingId, { title: 'Untouched' }),
      ]);
      expect(await listPages(owner.db, owner.ctx)).toHaveLength(depth + 1);

      const response = await sync(owner, [makeOp(owner.workspaceId, 'page.delete', chain[0]!)]);
      expect(response.status).toBe(200);
      const body = (await response.json()) as SyncResponse;
      expect(body.results[0]?.status).toBe('applied');

      const left = await listPages(owner.db, owner.ctx);
      expect(left.map((page) => page.id)).toEqual([siblingId]);
    });
  });

  // DEF-003: a stored sortKey that is not a fractional index used to make every later create under
  // that parent throw out of key generation, permanently.
  it('rejects an op whose sortKey is not a valid fractional index', async () => {
    const owner = await createAccount();
    const poison = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), {
      title: 'Poison',
      sortKey: 'zz',
    });

    const response = await sync(owner, [poison]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponse;
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/sortKey/);
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('creates a page under a parent that already has an invalid sibling sortKey', async () => {
    const owner = await createAccount();
    const parentId = crypto.randomUUID();
    await sync(owner, [makeOp(owner.workspaceId, 'page.create', parentId, { title: 'Parent' })]);

    // Written straight to D1, the way a row created before the validation existed would look.
    const poisonedId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pages (id, workspace_id, parent_id, title, icon, sort_key, version, created_at, updated_at)
       VALUES (?, ?, ?, 'Legacy', NULL, 'zz', 1, 0, 0)`,
    )
      .bind(poisonedId, owner.workspaceId, parentId)
      .run();

    const childId = crypto.randomUUID();
    const response = await sync(owner, [
      makeOp(owner.workspaceId, 'page.create', childId, { parentId, title: 'New child' }),
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponse;
    expect(body.results[0]?.status).toBe('applied');
    expect(await getPage(owner.db, owner.ctx, childId)).toBeDefined();
  });

  // DEF-004: a duplicated opId used to break the applied_ops primary key and lose the whole batch.
  it('treats a duplicate opId inside one batch as a replay and applies the rest', async () => {
    const owner = await createAccount();
    const duplicatedId = crypto.randomUUID();
    const duplicated = makeOp(
      owner.workspaceId,
      'page.create',
      duplicatedId,
      { title: 'Twice' },
      { opId: 'duplicate-op-id' },
    );
    const others = Array.from({ length: 3 }, (_, index) =>
      makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), { title: `Other ${index}` }),
    );

    const response = await sync(owner, [duplicated, ...others, { ...duplicated, clientSeq: 999 }]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponse;
    expect(body.results.map((result) => result.status)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'replayed',
    ]);
    // The duplicated page exists once, and none of the valid ops were lost.
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(4);
    expect(await getPage(owner.db, owner.ctx, duplicatedId)).toBeDefined();
  });

  // DEF-005: title and icon were unbounded, and a value past D1's row limit escaped as a bare 500.
  it('rejects an over-length title and an over-length icon per op', async () => {
    const owner = await createAccount();
    const longTitle = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), {
      title: 'x'.repeat(100_000),
    });
    const longIcon = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), {
      title: 'Fine',
      icon: '🙂'.repeat(2_000),
    });
    const good = makeOp(owner.workspaceId, 'page.create', crypto.randomUUID(), { title: 'Fine' });

    const response = await sync(owner, [longTitle, longIcon, good]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as SyncResponse;
    expect(body.results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
      'applied',
    ]);
    expect(body.results[0]?.reason).toMatch(/title/);
    expect(body.results[1]?.reason).toMatch(/icon/);
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(1);
  });

  it('answers an unexpected server error with the JSON error envelope, not a bare 500', async () => {
    const owner = await createAccount();
    // An entity id past D1's 2 MB row ceiling throws deep in the write path (SQLITE_TOOBIG). The
    // point is the shape of the response, not this particular cause.
    const op = makeOp(owner.workspaceId, 'page.create', 'x'.repeat(3_000_000), { title: 'Huge' });

    const response = await sync(owner, [op]);
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(await response.json()).toMatchObject({ error: 'internal_error' });
  });
});
