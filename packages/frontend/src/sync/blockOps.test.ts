import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBlockCreateOp, buildBlockDeleteOp, buildBlockUpdateOp } from './blockOps';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('block op builders', () => {
  it('builds a block.create op with a client-minted id and the page it belongs to', () => {
    const op = buildBlockCreateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      pageId: 'p-1',
      type: 'paragraph',
      text: 'Hello',
      sortKey: 'a1',
    });

    expect(op).toMatchObject({
      workspaceId: 'ws-1',
      entity: 'block',
      entityId: 'b-1',
      type: 'block.create',
      baseVersion: 0,
      payload: { pageId: 'p-1', type: 'paragraph', text: 'Hello', sortKey: 'a1' },
    });
    expect(op.opId).toMatch(UUID);
    expect(Number.isInteger(op.createdAt)).toBe(true);
  });

  it('omits the sort key entirely when the block should be appended by the server', () => {
    const op = buildBlockCreateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      pageId: 'p-1',
      type: 'todo',
    });

    expect(op.payload).toEqual({ pageId: 'p-1', type: 'todo' });
    expect('sortKey' in op.payload).toBe(false);
  });

  it('includes checked and props when provided (optional field paths)', () => {
    const op = buildBlockCreateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      pageId: 'p-1',
      type: 'todo',
      checked: true,
      props: JSON.stringify({ language: 'typescript' }),
    });

    expect(op.payload).toMatchObject({
      checked: true,
      props: JSON.stringify({ language: 'typescript' }),
    });
  });

  it('builds a block.update op carrying only the changed fields and the base version', () => {
    const op = buildBlockUpdateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      baseVersion: 4,
      changes: { text: 'Edited' },
    });

    expect(op.type).toBe('block.update');
    expect(op.entity).toBe('block');
    expect(op.baseVersion).toBe(4);
    expect(op.payload).toEqual({ text: 'Edited' });
  });

  it('makes a drag-reorder one op carrying only the sort key, never the page', () => {
    const op = buildBlockUpdateOp({
      workspaceId: 'ws-1',
      blockId: 'b-1',
      baseVersion: 2,
      changes: { sortKey: 'a1V' },
    });

    // The server rejects a block.update that names a pageId, so it must never appear here.
    expect(op.payload).toEqual({ sortKey: 'a1V' });
  });

  it('builds a block.delete op with an empty payload', () => {
    const op = buildBlockDeleteOp({ workspaceId: 'ws-1', blockId: 'b-1', baseVersion: 3 });

    expect(op.type).toBe('block.delete');
    expect(op.entityId).toBe('b-1');
    expect(op.payload).toEqual({});
  });

  it('gives every block op a monotonic clientSeq, shared with the page ops', () => {
    const first = buildBlockDeleteOp({ workspaceId: 'ws-1', blockId: 'b-1', baseVersion: 1 });
    const second = buildBlockUpdateOp({
      workspaceId: 'ws-1',
      blockId: 'b-2',
      baseVersion: 1,
      changes: { checked: true },
    });

    expect(second.clientSeq).toBe(first.clientSeq + 1);
  });
});
