// Tests for block content: the three block ops through the sync endpoint, append ordering, reorder by
// sortKey alone, versioning and replay, every per-op rejection reason, the cascade from a page delete,
// and what the snapshot and its ETag say about blocks.
import { generateKeyBetween } from 'fractional-indexing';
import { describe, expect, it } from 'vitest';
import { getBlock, listBlocks } from '../src/repo/blocks';
import { createPage } from '../src/repo/pages';
import { BLOCK_TYPES } from '../src/sync/ops';
import { apiFetch, createAccount, makeOp, type TestAccount } from './helpers';

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

type SnapshotResponse = {
  pages: { id: string }[];
  blocks: {
    id: string;
    pageId: string;
    type: string;
    text: string;
    checked: boolean;
    props: string | null;
    sortKey: string;
    version: number;
    updatedAt: number;
  }[];
};

// Posts a chunk of ops as the given account.
function sync(account: TestAccount, ops: unknown[]) {
  return apiFetch(`/api/workspaces/${account.workspaceId}/sync`, {
    method: 'POST',
    sessionId: account.sessionId,
    body: JSON.stringify({ ops }),
  });
}

// Posts a chunk and returns the parsed body, asserting the request itself was accepted.
async function syncBody(account: TestAccount, ops: unknown[]): Promise<SyncResponse> {
  const response = await sync(account, ops);
  expect(response.status).toBe(200);
  return (await response.json()) as SyncResponse;
}

// Reads the snapshot as the given account.
async function snapshot(account: TestAccount): Promise<{ body: SnapshotResponse; etag: string }> {
  const response = await apiFetch(`/api/workspaces/${account.workspaceId}/snapshot`, {
    sessionId: account.sessionId,
  });
  expect(response.status).toBe(200);
  return { body: (await response.json()) as SnapshotResponse, etag: response.headers.get('ETag')! };
}

describe('block ops through POST /api/workspaces/:workspaceId/sync', () => {
  it('creates, updates and deletes a block', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Lighting ideas' });
    const blockId = crypto.randomUUID();

    const created = await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', blockId, {
        pageId: page.id,
        type: 'todo',
        text: 'Chase the walls',
        checked: false,
      }),
    ]);
    expect(created.results[0]).toMatchObject({ status: 'applied', entityId: blockId, version: 1 });
    expect(await getBlock(owner.db, owner.ctx, blockId)).toMatchObject({
      pageId: page.id,
      type: 'todo',
      text: 'Chase the walls',
      checked: 0,
      props: null,
      version: 1,
    });

    const updated = await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.update', blockId, { checked: true, text: 'Walls chased' }),
    ]);
    expect(updated.results[0]).toMatchObject({ status: 'applied', version: 2 });
    expect(await getBlock(owner.db, owner.ctx, blockId)).toMatchObject({
      checked: 1,
      text: 'Walls chased',
      version: 2,
    });

    const removed = await syncBody(owner, [makeOp(owner.workspaceId, 'block.delete', blockId)]);
    expect(removed.results[0]?.status).toBe('applied');
    // A deleted row has no version left to report.
    expect(removed.results[0]).not.toHaveProperty('version');
    expect(await getBlock(owner.db, owner.ctx, blockId)).toBeUndefined();
  });

  it('stores props for the types that carry extras', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Film stock notes' });
    const codeId = crypto.randomUUID();

    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', codeId, {
        pageId: page.id,
        type: 'code',
        text: 'const x = 1;',
        props: '{"language":"typescript"}',
      }),
    ]);

    const stored = await getBlock(owner.db, owner.ctx, codeId);
    expect(stored?.props).toBe('{"language":"typescript"}');
  });

  it('appends blocks in clientSeq order when sortKey is omitted', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: '2026 Intentions' });
    const ids = ['first', 'second', 'third'].map(() => crypto.randomUUID());

    // All three in one chunk, so the append keys must come from projected state rather than from the
    // database, which has not been written yet.
    await syncBody(
      owner,
      ids.map((id, index) =>
        makeOp(owner.workspaceId, 'block.create', id, {
          pageId: page.id,
          type: 'paragraph',
          text: `Line ${index}`,
        }),
      ),
    );

    const stored = await listBlocks(owner.db, owner.ctx);
    expect(stored.map((block) => block.id)).toEqual(ids);

    // A block created in a later chunk still lands last.
    const fourth = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', fourth, {
        pageId: page.id,
        type: 'paragraph',
        text: 'Line 3',
      }),
    ]);
    expect((await listBlocks(owner.db, owner.ctx)).map((block) => block.id)).toEqual([
      ...ids,
      fourth,
    ]);
  });

  it('appends into the right page when two pages are edited in one chunk', async () => {
    const owner = await createAccount();
    const first = await createPage(owner.db, owner.ctx, { title: 'One' });
    const second = await createPage(owner.db, owner.ctx, { title: 'Two' });
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];

    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', ids[0]!, { pageId: first.id, type: 'paragraph' }),
      makeOp(owner.workspaceId, 'block.create', ids[1]!, { pageId: second.id, type: 'paragraph' }),
      makeOp(owner.workspaceId, 'block.create', ids[2]!, { pageId: first.id, type: 'paragraph' }),
    ]);

    const stored = await listBlocks(owner.db, owner.ctx);
    const onFirst = stored.filter((block) => block.pageId === first.id);
    expect(onFirst.map((block) => block.id)).toEqual([ids[0], ids[2]]);
    // Each page's keys are generated independently, so the two pages start from the same first key.
    expect(stored.find((block) => block.id === ids[1])?.sortKey).toBe(onFirst[0]?.sortKey);
  });

  it('reorders a block with a single sortKey-only update', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Packing list' });
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await syncBody(
      owner,
      ids.map((id) =>
        makeOp(owner.workspaceId, 'block.create', id, { pageId: page.id, type: 'bulletedList' }),
      ),
    );
    const before = await listBlocks(owner.db, owner.ctx);
    expect(before.map((block) => block.id)).toEqual(ids);

    // Drag the last block to the top: one op on one row, which is the whole point of fractional keys.
    const topKey = generateKeyBetween(null, before[0]!.sortKey);
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.update', ids[2]!, { sortKey: topKey }),
    ]);
    expect(body.results[0]).toMatchObject({ status: 'applied', version: 2 });

    const after = await listBlocks(owner.db, owner.ctx);
    expect(after.map((block) => block.id)).toEqual([ids[2], ids[0], ids[1]]);
    // The two blocks that did not move were not rewritten.
    expect(after.filter((block) => block.version !== 1).map((block) => block.id)).toEqual([ids[2]]);
  });

  it('replays a block op idempotently, returning its original outcome', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Journal' });
    const blockId = crypto.randomUUID();
    const op = makeOp(owner.workspaceId, 'block.create', blockId, {
      pageId: page.id,
      type: 'quote',
      text: 'Light the room, not the ceiling.',
    });

    const first = await syncBody(owner, [op]);
    expect(first.results[0]).toMatchObject({ status: 'applied', version: 1 });

    const replay = await syncBody(owner, [op]);
    expect(replay.results[0]).toMatchObject({ status: 'replayed', entityId: blockId, version: 1 });
    expect(await listBlocks(owner.db, owner.ctx)).toHaveLength(1);
  });

  it('applies a baseVersion mismatch on a block as last write wins but reports it', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Weekly Review' });
    const blockId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', blockId, { pageId: page.id, type: 'paragraph' }),
    ]);
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.update', blockId, { text: 'Second version' }),
    ]);

    const stale = makeOp(
      owner.workspaceId,
      'block.update',
      blockId,
      { text: 'Stale text' },
      { baseVersion: 1 },
    );
    const body = await syncBody(owner, [stale]);

    expect(body.results[0]).toMatchObject({ status: 'applied', version: 3 });
    expect(body.versionMismatches).toEqual([
      { opId: stale.opId, entityId: blockId, baseVersion: 1, serverVersion: 2 },
    ]);
    expect((await getBlock(owner.db, owner.ctx, blockId))?.text).toBe('Stale text');
  });
});

describe('per-op rejection of block ops', () => {
  it('rejects each bad op and applies the good ones in the same batch', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Mixed batch' });
    const existingId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', existingId, { pageId: page.id, type: 'paragraph' }),
    ]);

    const goodId = crypto.randomUUID();
    const ops = [
      // Over-length text.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: page.id,
        type: 'paragraph',
        text: 'x'.repeat(10_001),
      }),
      // props that is not JSON.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: page.id,
        type: 'code',
        props: 'language=typescript',
      }),
      // props that is JSON but too long.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: page.id,
        type: 'code',
        props: JSON.stringify({ language: 'x'.repeat(1_001) }),
      }),
      // A type outside the eleven.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: page.id,
        type: 'table',
      }),
      // A sortKey that is not a fractional index.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: page.id,
        type: 'paragraph',
        sortKey: 'zz',
      }),
      // A page that does not exist.
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: crypto.randomUUID(),
        type: 'paragraph',
      }),
      // Update and delete of a block that does not exist.
      makeOp(owner.workspaceId, 'block.update', crypto.randomUUID(), { text: 'Ghost' }),
      makeOp(owner.workspaceId, 'block.delete', crypto.randomUUID()),
      // Moving a block between pages is out of scope.
      makeOp(owner.workspaceId, 'block.update', existingId, { pageId: crypto.randomUUID() }),
      // An envelope whose entity disagrees with the op type.
      makeOp(
        owner.workspaceId,
        'block.create',
        crypto.randomUUID(),
        { pageId: page.id, type: 'paragraph' },
        { entity: 'page' },
      ),
      // The one op that should land.
      makeOp(owner.workspaceId, 'block.create', goodId, {
        pageId: page.id,
        type: 'callout',
        text: 'Fine',
        props: '{"emoji":"\u{1F4A1}"}',
      }),
    ];

    const body = await syncBody(owner, ops);
    const statuses = body.results.map((result) => result.status);
    expect(statuses).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'rejected',
      'applied',
    ]);
    const reasons = body.results.map((result) => result.reason);
    expect(reasons[0]).toBe('text must be at most 10000 characters');
    expect(reasons[1]).toBe('props must be valid JSON of at most 1000 characters');
    expect(reasons[2]).toBe('props must be valid JSON of at most 1000 characters');
    expect(reasons[3]).toBe('unknown block type');
    expect(reasons[4]).toBe('sortKey is not a valid fractional index');
    expect(reasons[5]).toBe('page no longer exists');
    expect(reasons[6]).toBe('block no longer exists');
    expect(reasons[7]).toBe('block no longer exists');
    expect(reasons[8]).toBe('a block cannot be moved between pages');
    expect(reasons[9]).toMatch(/entity must be "block"/);

    // Only the existing block and the one good create survive; nothing else was written, and the
    // rejected move left its target alone.
    const stored = await listBlocks(owner.db, owner.ctx);
    expect(stored.map((block) => block.id).sort()).toEqual([existingId, goodId].sort());
    expect(stored.find((block) => block.id === existingId)).toMatchObject({
      pageId: page.id,
      version: 1,
    });
  });

  it('rejects an unknown type on an update without touching the block', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Types' });
    const blockId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', blockId, { pageId: page.id, type: 'paragraph' }),
    ]);

    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.update', blockId, { type: 'embed' }),
    ]);
    expect(body.results[0]).toMatchObject({ status: 'rejected', reason: 'unknown block type' });
    expect(await getBlock(owner.db, owner.ctx, blockId)).toMatchObject({
      type: 'paragraph',
      version: 1,
    });
  });

  it('accepts every one of the eleven types', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'All types' });

    const body = await syncBody(
      owner,
      BLOCK_TYPES.map((type) =>
        makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
          pageId: page.id,
          type,
          text: type,
        }),
      ),
    );
    expect(body.results.every((result) => result.status === 'applied')).toBe(true);
    const stored = await listBlocks(owner.db, owner.ctx);
    expect(stored.map((block) => block.type).sort()).toEqual([...BLOCK_TYPES].sort());
  });
});

describe('page.delete cascading to blocks', () => {
  it('removes the blocks of every page in a nested subtree and leaves other pages alone', async () => {
    const owner = await createAccount();
    const root = await createPage(owner.db, owner.ctx, { title: 'Projects' });
    const child = await createPage(owner.db, owner.ctx, { title: 'Flat', parentId: root.id });
    const grandchild = await createPage(owner.db, owner.ctx, {
      title: 'Lighting',
      parentId: child.id,
    });
    const untouched = await createPage(owner.db, owner.ctx, { title: 'Recipes' });

    const survivorId = crypto.randomUUID();
    await syncBody(owner, [
      ...[root.id, child.id, grandchild.id].flatMap((pageId) =>
        [0, 1].map(() =>
          makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
            pageId,
            type: 'paragraph',
            text: 'Content',
          }),
        ),
      ),
      makeOp(owner.workspaceId, 'block.create', survivorId, {
        pageId: untouched.id,
        type: 'paragraph',
        text: 'Survives',
      }),
    ]);
    expect(await listBlocks(owner.db, owner.ctx)).toHaveLength(7);

    const body = await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', root.id)]);
    expect(body.results[0]?.status).toBe('applied');

    // No orphans: every block of the deleted subtree is gone, and only the other page's block is left.
    const left = await listBlocks(owner.db, owner.ctx);
    expect(left.map((block) => block.id)).toEqual([survivorId]);
  });

  it('cascades to a block created earlier in the same chunk', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();

    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Short lived' }),
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId,
        type: 'paragraph',
        text: 'Gone in the same batch',
      }),
      makeOp(owner.workspaceId, 'page.delete', pageId),
    ]);
    expect(body.results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    expect(await listBlocks(owner.db, owner.ctx)).toHaveLength(0);
  });
});

describe('the snapshot with blocks', () => {
  it('carries blocks in sort order with checked as a boolean', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Intentions' });
    const doneId = crypto.randomUUID();
    const openId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', doneId, {
        pageId: page.id,
        type: 'todo',
        text: 'Shot a roll',
        checked: true,
      }),
      makeOp(owner.workspaceId, 'block.create', openId, {
        pageId: page.id,
        type: 'code',
        text: 'const x = 1;',
        props: '{"language":"typescript"}',
      }),
    ]);

    const { body } = await snapshot(owner);
    expect(body.blocks.map((block) => block.id)).toEqual([doneId, openId]);
    const [done, code] = body.blocks;
    expect(done).toMatchObject({
      pageId: page.id,
      type: 'todo',
      text: 'Shot a roll',
      checked: true,
      props: null,
      version: 1,
    });
    expect(typeof done?.checked).toBe('boolean');
    expect(code).toMatchObject({ checked: false, props: '{"language":"typescript"}' });
    expect(typeof code?.updatedAt).toBe('number');
  });

  it('moves the ETag when a block is edited, and answers 304 while it is not', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Notes' });
    const blockId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', blockId, { pageId: page.id, type: 'paragraph' }),
    ]);

    const { etag } = await snapshot(owner);
    expect(etag.startsWith('"p2-')).toBe(true);

    const unchanged = await apiFetch(`/api/workspaces/${owner.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
      headers: { 'If-None-Match': etag },
    });
    expect(unchanged.status).toBe(304);

    // Editing only a block, with no page touched at all, must still change the ETag.
    await syncBody(owner, [makeOp(owner.workspaceId, 'block.update', blockId, { text: 'Edited' })]);
    const afterEdit = await apiFetch(`/api/workspaces/${owner.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
      headers: { 'If-None-Match': etag },
    });
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.headers.get('ETag')).not.toBe(etag);

    // So must deleting one.
    const afterCreate = (await snapshot(owner)).etag;
    await syncBody(owner, [makeOp(owner.workspaceId, 'block.delete', blockId)]);
    expect((await snapshot(owner)).etag).not.toBe(afterCreate);
  });
});
