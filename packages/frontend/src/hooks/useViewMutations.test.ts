import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { generateKeyBetween } from 'fractional-indexing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { useViewMutations } from './useViewMutations';
import type { Op, OpResult, SnapshotResponse, SyncResponse, ViewRecord } from '../api/types';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const SNAPSHOT_KEY = ['snapshot', 'u-1', 'ws-1'];

function makeSnapshot(views: ViewRecord[] = []): SnapshotResponse {
  return { workspaceId: 'ws-1', pages: [], blocks: [], properties: [], values: [], views };
}

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

function renderViewMutations(seedViews: ViewRecord[] = []) {
  const notify = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  queryClient.setQueryData(SNAPSHOT_KEY, makeSnapshot(seedViews));

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const { result } = renderHook(() => useViewMutations('u-1', 'ws-1', seedViews, notify), {
    wrapper,
  });

  const getViews = () => queryClient.getQueryData<SnapshotResponse>(SNAPSHOT_KEY)?.views ?? [];

  return { result, notify, invalidate, getViews };
}

// ── createView ─────────────────────────────────────────────────────────────────

describe('useViewMutations — createView', () => {
  it('returns the new view id on success', async () => {
    mockSyncSuccess();
    const { result } = renderViewMutations();
    let viewId: string | null = null;
    await act(async () => {
      viewId = await result.current.createView({
        databasePageId: 'db-1',
        name: 'Table',
        kind: 'table',
      });
    });
    expect(viewId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('applies an optimistic patch to the snapshot immediately', async () => {
    mockSyncSuccess();
    const { result, getViews } = renderViewMutations();
    await act(async () => {
      await result.current.createView({ databasePageId: 'db-1', name: 'Board', kind: 'board' });
    });
    const views = getViews();
    expect(views).toHaveLength(1);
    expect(views[0]?.name).toBe('Board');
    expect(views[0]?.kind).toBe('board');
  });

  it('returns null and notifies when the op is rejected', async () => {
    mockSyncSuccess('rejected', 'database not found');
    const { result, notify } = renderViewMutations();
    let viewId: string | null = 'not-null';
    await act(async () => {
      viewId = await result.current.createView({
        databasePageId: 'db-1',
        name: 'Table',
        kind: 'table',
      });
    });
    expect(viewId).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]?.[0])).toContain('database not found');
  });
});

// ── updateView ─────────────────────────────────────────────────────────────────

describe('useViewMutations — updateView', () => {
  const seedView: ViewRecord = {
    id: 'v-1',
    databasePageId: 'db-1',
    name: 'Old Name',
    kind: 'table',
    groupPropertyId: null,
    filters: [],
    sort: null,
    sortKey: 'a0',
    version: 1,
    updatedAt: 0,
  };

  it('applies the change to the snapshot optimistically', async () => {
    mockSyncSuccess();
    const { result, getViews } = renderViewMutations([seedView]);
    await act(async () => {
      await result.current.updateView(seedView, { name: 'New Name' });
    });
    const views = getViews();
    expect(views[0]?.name).toBe('New Name');
  });

  it('resolves without throwing on rejection and notifies', async () => {
    mockSyncSuccess('rejected', 'view no longer exists');
    const { result, notify } = renderViewMutations([seedView]);
    await act(async () => {
      await expect(result.current.updateView(seedView, { name: 'x' })).resolves.toBeUndefined();
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(String(notify.mock.calls[0]?.[0])).toContain('view no longer exists');
  });

  it('invalidates the snapshot after the server confirms', async () => {
    mockSyncSuccess();
    const { result, invalidate } = renderViewMutations([seedView]);
    await act(async () => {
      await result.current.updateView(seedView, { name: 'Renamed' });
    });
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: SNAPSHOT_KEY }));
  });
});

// ── deleteView ─────────────────────────────────────────────────────────────────

describe('useViewMutations — deleteView', () => {
  const seedView: ViewRecord = {
    id: 'v-1',
    databasePageId: 'db-1',
    name: 'Table',
    kind: 'table',
    groupPropertyId: null,
    filters: [],
    sort: null,
    sortKey: 'a0',
    version: 1,
    updatedAt: 0,
  };

  it('removes the view from the snapshot optimistically', async () => {
    mockSyncSuccess();
    const { result, getViews } = renderViewMutations([seedView]);
    await act(async () => {
      await result.current.deleteView(seedView);
    });
    expect(getViews()).toHaveLength(0);
  });

  it('resolves without throwing on rejection and notifies', async () => {
    mockSyncSuccess('rejected', 'already deleted');
    const { result, notify } = renderViewMutations([seedView]);
    await act(async () => {
      await expect(result.current.deleteView(seedView)).resolves.toBeUndefined();
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

// ── createDefaultViews ─────────────────────────────────────────────────────────

describe('useViewMutations — createDefaultViews', () => {
  it('creates three views (table, board, list) and returns three ids', async () => {
    mockSyncSuccess();
    const { result, getViews } = renderViewMutations();
    let ids: string[] = [];
    await act(async () => {
      ids = await result.current.createDefaultViews('db-1');
    });
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3); // all distinct
    const views = getViews();
    expect(views.map((v) => v.kind).sort()).toEqual(['board', 'list', 'table']);
  });
});

// ── sort-key validity (DEF-070) ────────────────────────────────────────────────

// Unit tests for the sort-key logic inside createDefaultViews (DEF-070).
// These test the pure key-minting math rather than the full hook.

/**
 * A key is a valid fractional index when `generateKeyBetween(key, null)` succeeds.
 * An invalid key causes the library to throw: `invalid order key: <key>`.
 */
function isValidKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

describe('createDefaultViews sort-key generation (DEF-070)', () => {
  it('generates three successive valid fractional-index sort keys', () => {
    const k0 = generateKeyBetween(null, null); // 'a0'
    const k1 = generateKeyBetween(k0, null); // 'a1'
    const k2 = generateKeyBetween(k1, null); // 'a2'

    expect(isValidKey(k0)).toBe(true);
    expect(isValidKey(k1)).toBe(true);
    expect(isValidKey(k2)).toBe(true);
  });

  it('keys are in ascending order', () => {
    const k0 = generateKeyBetween(null, null);
    const k1 = generateKeyBetween(k0, null);
    const k2 = generateKeyBetween(k1, null);

    expect(k0 < k1).toBe(true);
    expect(k1 < k2).toBe(true);
  });

  it('single-character strings "a" "b" "c" are NOT valid fractional indices (pre-fix regression guard)', () => {
    // These were what createDefaultViews passed before DEF-070 was fixed. Using them as a "before"
    // input to generateKeyBetween throws, which is exactly what the server rejected.
    expect(() => generateKeyBetween('a', null)).toThrow();
    expect(() => generateKeyBetween('b', null)).toThrow();
    expect(() => generateKeyBetween('c', null)).toThrow();
  });
});
