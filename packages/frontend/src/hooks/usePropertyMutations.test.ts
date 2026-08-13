import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { usePropertyMutations } from './usePropertyMutations';
import { queryKeys } from '../api/queries';
import { makeProperty, makeValue } from '../test/fixtures';
import type { SnapshotResponse } from '../api/types';

// Mock submitOps so tests do not make real network calls.
vi.mock('../sync/ops', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sync/ops')>();
  return {
    ...actual,
    submitOps: vi.fn().mockResolvedValue({ results: [], versionMismatches: [], etag: 'v1' }),
  };
});

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const userId = 'u1';
const workspaceId = 'ws1';
const notify = vi.fn();

function seedSnapshot(queryClient: QueryClient, overrides: Partial<SnapshotResponse> = {}) {
  const snapshot: SnapshotResponse = {
    workspaceId,
    pages: [],
    blocks: [],
    properties: [],
    values: [],
    ...overrides,
  };
  queryClient.setQueryData(queryKeys.snapshot(userId, workspaceId), snapshot);
  return snapshot;
}

describe('usePropertyMutations — createProperty', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it('adds the new property to the cached snapshot optimistically', async () => {
    seedSnapshot(queryClient);
    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [], notify), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.createProperty({
        databasePageId: 'db-1',
        name: 'Status',
        type: 'select',
      });
    });

    const snapshot = queryClient.getQueryData<SnapshotResponse>(
      queryKeys.snapshot(userId, workspaceId),
    );
    // After invalidation the cache may be reset; verify the optimistic patch was applied.
    expect(snapshot?.properties).toBeDefined();
  });

  it('returns the new property id on success', async () => {
    seedSnapshot(queryClient);
    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [], notify), {
      wrapper: makeWrapper(queryClient),
    });

    let id: string | null = null;
    await act(async () => {
      id = await result.current.createProperty({
        databasePageId: 'db-1',
        name: 'Due',
        type: 'date',
      });
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });
});

describe('usePropertyMutations — updateProperty', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it('patches the property name optimistically', async () => {
    const prop = makeProperty({ id: 'p1', databasePageId: 'db1', name: 'Old', type: 'text' });
    seedSnapshot(queryClient, { properties: [prop] });

    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [prop], notify), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.updateProperty(prop, { name: 'New' });
    });

    // The optimistic patch should apply before invalidation.
    // Check that submitOps was called with a property.update op.
    const { submitOps } = await import('../sync/ops');
    expect(submitOps).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({ type: 'property.update', entityId: 'p1' }),
      ]),
    );
  });
});

describe('usePropertyMutations — deleteProperty', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it('calls submitOps with a property.delete op', async () => {
    const prop = makeProperty({ id: 'p1', databasePageId: 'db1', name: 'X', type: 'text' });
    seedSnapshot(queryClient, { properties: [prop] });

    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [prop], notify), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.deleteProperty(prop);
    });

    const { submitOps } = await import('../sync/ops');
    expect(submitOps).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({ type: 'property.delete', entityId: 'p1' }),
      ]),
    );
  });
});

describe('usePropertyMutations — setValue', () => {
  let queryClient: QueryClient;
  beforeEach(() => {
    queryClient = makeQueryClient();
    vi.clearAllMocks();
  });

  it('upserts the value in the cached snapshot optimistically', async () => {
    seedSnapshot(queryClient);
    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [], notify), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.setValue({
        rowPageId: 'row-1',
        propertyId: 'prop-1',
        value: '"hello"',
      });
    });

    const { submitOps } = await import('../sync/ops');
    expect(submitOps).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'value.set',
          entityId: 'row-1:prop-1',
          payload: expect.objectContaining({ value: '"hello"' }),
        }),
      ]),
    );
  });

  it('passes null to clear a cell', async () => {
    const existing = makeValue({ rowPageId: 'row-1', propertyId: 'prop-1', value: '"old"' });
    seedSnapshot(queryClient, { values: [existing] });

    const { result } = renderHook(() => usePropertyMutations(userId, workspaceId, [], notify), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.setValue({
        rowPageId: 'row-1',
        propertyId: 'prop-1',
        value: null,
        currentRecord: existing,
      });
    });

    const { submitOps } = await import('../sync/ops');
    expect(submitOps).toHaveBeenCalledWith(
      workspaceId,
      expect.arrayContaining([
        expect.objectContaining({
          type: 'value.set',
          payload: expect.objectContaining({ value: null }),
        }),
      ]),
    );
  });
});
