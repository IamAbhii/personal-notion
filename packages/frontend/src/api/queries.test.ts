import { afterEach, describe, expect, it, vi } from 'vitest';
import { meQueryOptions, queryKeys, snapshotQueryOptions } from './queries';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Stubs fetch to return a given body as a 200 JSON response. Lets us exercise the queryFn
 * callbacks (which call apiGet) without a live server.
 */
function stubFetch(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('queryKeys', () => {
  it('me() returns a stable key array', () => {
    expect(queryKeys.me()).toEqual(['me']);
  });

  it('snapshot() embeds the user id and workspace id', () => {
    const key = queryKeys.snapshot('u-1', 'ws-1');
    expect(key).toEqual(['snapshot', 'u-1', 'ws-1']);
  });
});

describe('meQueryOptions', () => {
  it('queryFn calls /api/me and returns the parsed body', async () => {
    stubFetch({ user: { id: 'u-1' }, memberships: [] });
    const opts = meQueryOptions();
    // Call the queryFn directly to cover the arrow function body (line 19).
    const result = await opts.queryFn!({ queryKey: opts.queryKey } as never);
    expect((result as { user: { id: string } }).user.id).toBe('u-1');
  });
});

describe('snapshotQueryOptions', () => {
  it('queryFn calls the workspace snapshot endpoint and returns the parsed body', async () => {
    stubFetch({ pages: [], blocks: [], properties: [], values: [], views: [], etag: 'W/"1"' });
    const opts = snapshotQueryOptions('u-1', 'ws-1');
    const result = await opts.queryFn!({ queryKey: opts.queryKey } as never);
    expect((result as { pages: unknown[] }).pages).toEqual([]);
  });

  it('snapshot URL contains the workspace id', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          pages: [],
          blocks: [],
          properties: [],
          values: [],
          views: [],
          etag: 'W/"1"',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );
    const opts = snapshotQueryOptions('u-1', 'ws-42');
    await opts.queryFn!({ queryKey: opts.queryKey } as never);
    const [url] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('ws-42');
  });
});
