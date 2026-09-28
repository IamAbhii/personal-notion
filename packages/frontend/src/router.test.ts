import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createAppRouter } from './router';

// Importing this module executes all the module-level createRoute() and createRootRouteWithContext()
// calls (the route definitions), covering the statements that would otherwise stay at 0%.

describe('createAppRouter', () => {
  it('returns a TanStack Router instance configured with the given queryClient', () => {
    const queryClient = new QueryClient();
    const router = createAppRouter(queryClient);
    // The router exposes its context so the loader can call queryClient.ensureQueryData.
    expect(router.options.context.queryClient).toBe(queryClient);
  });

  it('sets defaultPreload to "intent" for hover/focus prefetching', () => {
    const queryClient = new QueryClient();
    const router = createAppRouter(queryClient);
    expect(router.options.defaultPreload).toBe('intent');
  });

  it('two calls with different clients produce independent routers', () => {
    const qc1 = new QueryClient();
    const qc2 = new QueryClient();
    const r1 = createAppRouter(qc1);
    const r2 = createAppRouter(qc2);
    expect(r1).not.toBe(r2);
    expect(r1.options.context.queryClient).toBe(qc1);
    expect(r2.options.context.queryClient).toBe(qc2);
  });
});
