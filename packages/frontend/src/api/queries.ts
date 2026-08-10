import { queryOptions } from '@tanstack/react-query';
import { apiGet } from './client';
import type { MeResponse, SnapshotResponse } from './types';

/**
 * Query keys, namespaced by user and workspace. One browser profile must be able to hold two
 * accounts' cached data without collisions, so the user id is part of the key from day one.
 */
export const queryKeys = {
  me: () => ['me'] as const,
  snapshot: (userId: string, workspaceId: string) =>
    ['snapshot', userId, workspaceId] as const satisfies readonly unknown[],
};

/** The signed-in user and their workspace memberships. Everything else keys off this. */
export const meQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.me(),
    queryFn: () => apiGet<MeResponse>('/api/me'),
    staleTime: 5 * 60 * 1000,
  });

/**
 * The whole workspace in one read. Future: this becomes the IndexedDB-persisted cache that the
 * offline queue applies ops to optimistically before any network attempt.
 */
export const snapshotQueryOptions = (userId: string, workspaceId: string) =>
  queryOptions({
    queryKey: queryKeys.snapshot(userId, workspaceId),
    queryFn: () => apiGet<SnapshotResponse>(`/api/workspaces/${workspaceId}/snapshot`),
  });
