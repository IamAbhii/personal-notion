import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPageCreateOp, buildPageDeleteOp, buildPageUpdateOp } from './pageOps';
import { OpRejectedError, submitOps } from './ops';
import type { SyncResponse } from '../api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('page op builders', () => {
  it('builds a page.create op with a client-minted id and a full payload', () => {
    const op = buildPageCreateOp({
      workspaceId: 'ws-1',
      pageId: 'page-1',
      parentId: null,
      title: 'Untitled',
      icon: '\u{1F4C4}',
      sortKey: 'a0',
    });

    expect(op).toMatchObject({
      workspaceId: 'ws-1',
      entity: 'page',
      entityId: 'page-1',
      type: 'page.create',
      baseVersion: 0,
      payload: { parentId: null, title: 'Untitled', icon: '\u{1F4C4}', sortKey: 'a0' },
    });
    expect(op.opId).toMatch(UUID);
    expect(typeof op.clientSeq).toBe('number');
    expect(Number.isInteger(op.createdAt)).toBe(true);
  });

  it('includes kind in the payload when it is not the default "page"', () => {
    const op = buildPageCreateOp({
      workspaceId: 'ws-1',
      pageId: 'page-1',
      parentId: null,
      title: 'My DB',
      icon: '',
      sortKey: 'a0',
      kind: 'database',
    });

    expect(op.payload).toMatchObject({ kind: 'database' });
  });

  it('omits kind from the payload when it is the default "page" to stay backward compatible', () => {
    const op = buildPageCreateOp({
      workspaceId: 'ws-1',
      pageId: 'page-1',
      parentId: null,
      title: 'My Page',
      icon: '',
      sortKey: 'a0',
      kind: 'page',
    });

    expect('kind' in op.payload).toBe(false);
  });

  it('builds a page.update op carrying only the changed fields and the base version', () => {
    const op = buildPageUpdateOp({
      workspaceId: 'ws-1',
      pageId: 'page-1',
      baseVersion: 7,
      changes: { title: 'Renamed' },
    });

    expect(op.type).toBe('page.update');
    expect(op.baseVersion).toBe(7);
    expect(op.payload).toEqual({ title: 'Renamed' });
  });

  it('builds a page.delete op with an empty payload', () => {
    const op = buildPageDeleteOp({ workspaceId: 'ws-1', pageId: 'page-1', baseVersion: 3 });

    expect(op.type).toBe('page.delete');
    expect(op.entityId).toBe('page-1');
    expect(op.payload).toEqual({});
  });

  it('gives every op a monotonic clientSeq that survives a reload', () => {
    const first = buildPageDeleteOp({ workspaceId: 'ws-1', pageId: 'a', baseVersion: 1 });
    const second = buildPageDeleteOp({ workspaceId: 'ws-1', pageId: 'b', baseVersion: 1 });

    expect(second.clientSeq).toBe(first.clientSeq + 1);
    expect(localStorage.getItem('personal-space:clientSeq')).toBe(String(second.clientSeq));
  });
});

describe('submitOps', () => {
  it('posts the batch to the workspace sync endpoint', async () => {
    const response: SyncResponse = {
      results: [{ opId: 'op-1', status: 'applied', entityId: 'page-1', version: 1 }],
      versionMismatches: [],
      etag: 'W/"1"',
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const op = buildPageDeleteOp({ workspaceId: 'ws-1', pageId: 'page-1', baseVersion: 1 });
    await submitOps('ws-1', [op]);

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/workspaces/ws-1/sync');
    expect(JSON.parse(String(init?.body))).toEqual({ ops: [op] });
  });

  it('throws with the reason when the server rejects an op', async () => {
    const response: SyncResponse = {
      results: [{ opId: 'op-1', status: 'rejected', reason: 'parent missing' }],
      versionMismatches: [],
      etag: 'W/"1"',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const op = buildPageDeleteOp({ workspaceId: 'ws-1', pageId: 'page-1', baseVersion: 1 });

    await expect(submitOps('ws-1', [op])).rejects.toThrow(OpRejectedError);
  });

  it('refuses a batch larger than the 25-op server limit', async () => {
    const ops = Array.from({ length: 26 }, (_unused, index) =>
      buildPageDeleteOp({ workspaceId: 'ws-1', pageId: `page-${index}`, baseVersion: 1 }),
    );

    await expect(submitOps('ws-1', ops)).rejects.toThrow(/at most 25 ops/);
  });
});
