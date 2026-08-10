import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { usePageMutations } from './usePageMutations';
import { fixturePages } from '../test/fixtures';
import type { Op, PageCreatePayload, OpResult, SyncResponse } from '../api/types';

// The write path's failure behaviour: a rejected op must reach the user and reconcile local state
// (DEF-006), and concurrent creates must not mint the same sortKey (DEF-007).

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** A sync response for the ops in the request, all with the given status. */
function respond(ops: Op[], status: OpResult['status'], reason?: string): SyncResponse {
  return {
    results: ops.map((op) => ({
      opId: op.opId,
      status,
      reason,
      entityId: op.entityId,
      version: 1,
    })),
    versionMismatches: [],
    etag: 'W/"1"',
  };
}

/** Mocks fetch with one canned outcome for every op, and records the ops posted. */
function mockSync(status: OpResult['status'], reason?: string): Op[] {
  const posted: Op[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body)) as { ops: Op[] };
    posted.push(...body.ops);
    return new Response(JSON.stringify(respond(body.ops, status, reason)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return posted;
}

function renderMutations() {
  const notify = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePageMutations('u-1', 'ws-1', fixturePages, notify), {
    wrapper,
  });
  return { result, notify, invalidate };
}

describe('a rejected op (DEF-006)', () => {
  it('tells the user what was dropped instead of escaping as an unhandled error', async () => {
    mockSync('rejected', 'page no longer exists');
    const { result, notify } = renderMutations();
    const page = fixturePages[0]!;

    // The call must resolve: a click handler voids this promise, so a rejection becomes an
    // uncaught page error with nothing on screen.
    await expect(result.current.updatePage(page, { title: 'Renamed' })).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledTimes(1);
    const message = String(notify.mock.calls[0]?.[0]);
    expect(message).toContain('title');
    expect(message).toContain('Journal');
    expect(message).toContain('page no longer exists');
  });

  it('re-reads the snapshot so the stale row goes without a manual reload', async () => {
    mockSync('rejected', 'page no longer exists');
    const { result, invalidate } = renderMutations();

    await result.current.deletePage(fixturePages[1]!);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['snapshot', 'u-1', 'ws-1'] });
  });

  it('reports any reason the server gives, not a fixed set of them', async () => {
    mockSync('rejected', 'title must be at most 500 characters');
    const { result, notify } = renderMutations();

    await result.current.updatePage(fixturePages[0]!, { title: 'x'.repeat(600) });

    expect(String(notify.mock.calls[0]?.[0])).toContain('title must be at most 500 characters');
  });

  it('returns no page id when a create is rejected, so nothing navigates to it', async () => {
    mockSync('rejected', 'parent page no longer exists');
    const { result, notify } = renderMutations();

    await expect(result.current.createPage('p-journal')).resolves.toBeNull();
    expect(String(notify.mock.calls[0]?.[0])).toContain('parent page no longer exists');
  });

  it('says the user is offline rather than repeating the raw fetch error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, notify } = renderMutations();

    await result.current.updatePage(fixturePages[0]!, { icon: '\u{1F680}' });

    const message = String(notify.mock.calls[0]?.[0]);
    expect(message).toContain('offline');
    expect(message).not.toContain('Failed to fetch');
  });
});

describe('concurrent creates (DEF-007)', () => {
  it('gives ten rapid creates ten distinct sortKeys', async () => {
    const posted = mockSync('applied');
    const { result } = renderMutations();

    // Ten clicks before the first result lands: every key is computed from the same stale page list.
    await Promise.all(Array.from({ length: 10 }, () => result.current.createPage(null)));

    const keys = posted.map((op) => (op.payload as PageCreatePayload).sortKey);
    expect(keys).toHaveLength(10);
    expect(new Set(keys).size).toBe(10);
    // Every one must also sort after the existing siblings, or a new page jumps up the tree.
    expect(keys.every((key) => key > 'a1')).toBe(true);
  });

  it('keys concurrent creates under one parent independently of the top level', async () => {
    const posted = mockSync('applied');
    const { result } = renderMutations();

    await Promise.all([
      result.current.createPage('p-trips'),
      result.current.createPage('p-trips'),
      result.current.createPage(null),
    ]);

    const keys = posted.map((op) => (op.payload as PageCreatePayload).sortKey);
    const underTrips = posted
      .filter((op) => (op.payload as PageCreatePayload).parentId === 'p-trips')
      .map((op) => (op.payload as PageCreatePayload).sortKey);
    expect(keys).toHaveLength(3);
    expect(new Set(underTrips).size).toBe(2);
  });
});
