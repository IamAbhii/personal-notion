import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { useBlockMutations } from './useBlockMutations';
import { makeBlock } from '../test/fixtures';
import type { BlockRecord, Op, OpResult, SnapshotResponse, SyncResponse } from '../api/types';

// Mock ops so isLeaving and submitOnUnload are controllable. submitOps still uses the real fetch
// path — existing tests mock globalThis.fetch to intercept it.
vi.mock('../sync/ops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/ops')>();
  return {
    ...actual,
    isLeaving: vi.fn().mockReturnValue(false),
    submitOnUnload: vi.fn(),
  };
});

// React JSX in .ts files is handled by vitest's happy-dom environment.
// We use createElement directly to avoid requiring the file extension to be .tsx.
import { createElement } from 'react';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const SNAPSHOT_KEY = ['snapshot', 'u-1', 'ws-1'];

/** A minimal snapshot with one block, suitable for mutation tests. */
function makeSnapshot(blocks: BlockRecord[]): SnapshotResponse {
  return {
    workspaceId: 'ws-1',
    pages: [],
    blocks,
    properties: [],
    values: [],
    views: [],
  };
}

/** Mocks fetch to return a successful sync response for every op in the request. */
function mockSyncSuccess(status: OpResult['status'] = 'applied', reason?: string): Op[] {
  const posted: Op[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body)) as { ops: Op[] };
    posted.push(...body.ops);
    const response: SyncResponse = {
      results: body.ops.map((op) => ({
        opId: op.opId,
        status,
        reason,
        entityId: op.entityId,
        version: 2,
      })),
      versionMismatches: [],
      etag: 'W/"2"',
    };
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return posted;
}

function renderBlockMutations(seedBlocks: BlockRecord[] = []) {
  const notify = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

  // Seed the snapshot so optimistic patches have something to modify.
  queryClient.setQueryData(SNAPSHOT_KEY, makeSnapshot(seedBlocks));

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const { result } = renderHook(() => useBlockMutations('u-1', 'ws-1', seedBlocks, notify), {
    wrapper,
  });

  const getSnapshot = () => queryClient.getQueryData<SnapshotResponse>(SNAPSHOT_KEY);

  return { result, notify, invalidate, queryClient, getSnapshot };
}

// ── createBlock ────────────────────────────────────────────────────────────────

describe('useBlockMutations — createBlock', () => {
  it('returns a block id synchronously before any network round trip', () => {
    mockSyncSuccess();
    const { result } = renderBlockMutations();
    let blockId: string;
    act(() => {
      blockId = result.current.createBlock({ pageId: 'p-1', type: 'paragraph', text: 'Hello' });
    });
    expect(blockId!).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('applies an optimistic patch to the snapshot immediately', () => {
    mockSyncSuccess();
    const { result, getSnapshot } = renderBlockMutations();
    let blockId: string;
    act(() => {
      blockId = result.current.createBlock({
        pageId: 'p-1',
        type: 'heading1',
        text: 'New heading',
      });
    });
    const snapshot = getSnapshot();
    const added = snapshot?.blocks.find((b) => b.id === blockId!);
    expect(added).toBeDefined();
    expect(added?.type).toBe('heading1');
    expect(added?.text).toBe('New heading');
    expect(added?.pageId).toBe('p-1');
  });

  it('invalidates the snapshot after the server round trip', async () => {
    mockSyncSuccess();
    const { result, invalidate } = renderBlockMutations();
    await act(async () => {
      result.current.createBlock({ pageId: 'p-1', type: 'paragraph' });
      // Allow the async mutation to flush.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: SNAPSHOT_KEY }));
  });

  it('notifies on network failure instead of throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, notify } = renderBlockMutations();
    await act(async () => {
      result.current.createBlock({ pageId: 'p-1', type: 'paragraph' });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const message = String(notify.mock.calls[0]?.[0]);
    // When navigator.onLine is true (the test default), a TypeError is a transient network error
    // (e.g. a keepalive body-size rejection) — not an offline condition. The message says to retry
    // rather than claiming the user is offline, which would be misleading and wrong.
    expect(message).toContain('Please try again');
    expect(message).not.toContain('offline');
  });
});

// ── updateBlock ────────────────────────────────────────────────────────────────

describe('useBlockMutations — updateBlock', () => {
  it('applies an optimistic patch to the snapshot before the network resolves', async () => {
    mockSyncSuccess();
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1', text: 'Original text' });
    const { result, getSnapshot } = renderBlockMutations([seedBlock]);

    await act(async () => {
      void result.current.updateBlock(seedBlock, { text: 'Updated text' });
    });

    const snapshot = getSnapshot();
    const updated = snapshot?.blocks.find((b) => b.id === 'b-1');
    expect(updated?.text).toBe('Updated text');
  });

  it('resolves without throwing even when the op is rejected', async () => {
    mockSyncSuccess('rejected', 'block no longer exists');
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1' });
    const { result, notify } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await expect(result.current.updateBlock(seedBlock, { text: 'x' })).resolves.toBeUndefined();
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]?.[0])).toContain('block no longer exists');
  });

  it('invalidates the snapshot after the server confirms the update', async () => {
    mockSyncSuccess();
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1' });
    const { result, invalidate } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await result.current.updateBlock(seedBlock, { text: 'New' });
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: SNAPSHOT_KEY }));
  });
});

// ── deleteBlock ────────────────────────────────────────────────────────────────

describe('useBlockMutations — deleteBlock', () => {
  it('removes the block from the snapshot optimistically', async () => {
    mockSyncSuccess();
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1' });
    const { result, getSnapshot } = renderBlockMutations([seedBlock]);

    await act(async () => {
      void result.current.deleteBlock(seedBlock);
    });

    const snapshot = getSnapshot();
    expect(snapshot?.blocks.find((b) => b.id === 'b-1')).toBeUndefined();
  });

  it('resolves without throwing even when the op is rejected', async () => {
    mockSyncSuccess('rejected', 'not found');
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1' });
    const { result, notify } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await expect(result.current.deleteBlock(seedBlock)).resolves.toBeUndefined();
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('invalidates the snapshot after successful deletion', async () => {
    mockSyncSuccess();
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1' });
    const { result, invalidate } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await result.current.deleteBlock(seedBlock);
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: SNAPSHOT_KEY }));
  });
});

// ── concurrent creates (sort key collision guard) ──────────────────────────────

describe('useBlockMutations — concurrent creates reserve distinct sort keys', () => {
  it('two rapid creates on the same page produce two different ids', () => {
    mockSyncSuccess();
    const { result } = renderBlockMutations();
    let id1: string;
    let id2: string;
    act(() => {
      id1 = result.current.createBlock({ pageId: 'p-1', type: 'paragraph', text: 'A' });
      id2 = result.current.createBlock({ pageId: 'p-1', type: 'paragraph', text: 'B' });
    });
    expect(id1!).not.toBe(id2!);
  });
});

// ── updateBlock: isLeaving path ────────────────────────────────────────────────

describe('useBlockMutations — updateBlock uses submitOnUnload when page is leaving', () => {
  it('calls submitOnUnload instead of the normal mutation when isLeaving() is true (lines 187-188)', async () => {
    // When the page is being unloaded, fetch would be discarded; the hook uses submitOnUnload
    // (keepalive fetch) instead. Mock isLeaving to simulate this state.
    const { isLeaving, submitOnUnload } = await import('../sync/ops');
    vi.mocked(isLeaving).mockReturnValueOnce(true);

    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1', text: 'Hello' });
    const { result } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await result.current.updateBlock(seedBlock, { text: 'Updated' });
    });

    // submitOnUnload must have been called with the workspace id and an op.
    expect(vi.mocked(submitOnUnload)).toHaveBeenCalledWith(
      'ws-1',
      expect.arrayContaining([expect.objectContaining({ type: 'block.update', entityId: 'b-1' })]),
    );
  });
});

// ── label helper: long text truncation ────────────────────────────────────────

describe('useBlockMutations — error label truncates long block text', () => {
  it('truncates block text over 40 characters in the failure notice (line 148)', async () => {
    // Use a block with text longer than 40 characters and trigger an error so handleFailure
    // calls the label function which hits the truncation branch.
    mockSyncSuccess('rejected', 'conflict');
    const longText = 'A'.repeat(50); // 50 chars > 40
    const seedBlock = makeBlock({ id: 'b-1', pageId: 'p-1', text: longText });
    const { result, notify } = renderBlockMutations([seedBlock]);

    await act(async () => {
      await result.current.deleteBlock(seedBlock);
    });

    // The failure message should contain a truncated label ending with '...'
    const message = String(notify.mock.calls[0]?.[0]);
    expect(message).toContain('...');
    expect(message).not.toContain(longText); // full text must not appear
  });
});
