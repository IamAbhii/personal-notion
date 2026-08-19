import { describe, expect, it } from 'vitest';
import { snapshotQueryOptions, meQueryOptions } from './queries';

/**
 * Unit tests for query option configuration — structural guards that ensure the query options
 * carry the settings that fix cross-tab data drift (DEF-056, DEF-057).
 */
describe('snapshotQueryOptions', () => {
  it('includes a refetchInterval so the snapshot polls in the background (DEF-056, DEF-057)', () => {
    // Without refetchInterval, a row deleted in another tab stays visible indefinitely in the
    // current tab, and a cell edited in another tab never converges in the current tab.
    // 30 000 ms (30s) is the chosen interval: fast enough to reconcile cross-tab edits within
    // half a minute, conservative enough not to hammer the server.
    const options = snapshotQueryOptions('user-1', 'ws-1');
    expect(options.refetchInterval).toBe(30_000);
  });

  it('includes the workspace and user ids in the query key', () => {
    // The key is namespaced by (userId, workspaceId) so that multiple accounts in the same
    // browser profile do not share cached workspace data (cross-account data isolation).
    const options = snapshotQueryOptions('user-1', 'ws-1');
    expect(options.queryKey).toContain('user-1');
    expect(options.queryKey).toContain('ws-1');
  });

  it('keys differ for different user and workspace ids', () => {
    const a = snapshotQueryOptions('user-1', 'ws-1');
    const b = snapshotQueryOptions('user-2', 'ws-1');
    const c = snapshotQueryOptions('user-1', 'ws-2');
    expect(a.queryKey).not.toEqual(b.queryKey);
    expect(a.queryKey).not.toEqual(c.queryKey);
  });
});

describe('meQueryOptions', () => {
  it('includes a staleTime so the me endpoint is not refetched on every mount', () => {
    const options = meQueryOptions();
    expect(options.staleTime).toBeGreaterThan(0);
  });
});
