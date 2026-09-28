import { useMutation, useQueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import { queryKeys } from '../api/queries';
import { submitOps } from '../sync/ops';
import { buildViewCreateOp, buildViewDeleteOp, buildViewUpdateOp } from '../sync/viewOps';
import { describeWriteFailure } from '../lib/errors';
import type {
  SnapshotResponse,
  ViewFilter,
  ViewKind,
  ViewRecord,
  ViewSort,
  ViewUpdatePayload,
} from '../api/types';

export interface ViewMutations {
  /** Creates a single view for a database. Returns the new view id, or null on failure. */
  createView: (args: {
    databasePageId: string;
    name: string;
    kind: ViewKind;
    groupPropertyId?: string | null;
    filters?: ViewFilter[];
    sort?: ViewSort | null;
    sortKey?: string;
  }) => Promise<string | null>;
  /** Updates mutable view fields (name, groupPropertyId, filters, sort). Kind is immutable. */
  updateView: (view: ViewRecord, changes: ViewUpdatePayload) => Promise<void>;
  /** Permanently deletes a view. */
  deleteView: (view: ViewRecord) => Promise<void>;
  /**
   * Mints and submits three default views (table, board, list) for a newly created database.
   * Called immediately after `page.create` for databases created through the UI. Returns the
   * three view ids so callers can reference them before the snapshot refetch lands.
   */
  createDefaultViews: (databasePageId: string) => Promise<string[]>;
}

/**
 * The view write API for the database UI. Follows the same optimistic-update pattern as
 * usePropertyMutations: patch the cached snapshot immediately, then invalidate on success.
 *
 * No call here rejects. Failures are reported through `notify` and the snapshot is re-read.
 * Future: when the durable queue lands, these append ops to IndexedDB first; the shape is unchanged.
 */
export function useViewMutations(
  userId: string,
  workspaceId: string,
  views: ViewRecord[],
  notify: (message: string) => void,
): ViewMutations {
  const queryClient = useQueryClient();
  const snapshotKey = queryKeys.snapshot(userId, workspaceId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: snapshotKey });

  const patchSnapshot = (apply: (current: SnapshotResponse) => SnapshotResponse) => {
    queryClient.setQueryData<SnapshotResponse>(snapshotKey, (snapshot) =>
      snapshot ? apply(snapshot) : snapshot,
    );
  };

  const create = useMutation({
    mutationFn: async (args: {
      viewId: string;
      databasePageId: string;
      name: string;
      kind: ViewKind;
      groupPropertyId?: string | null;
      filters?: ViewFilter[];
      sort?: ViewSort | null;
      sortKey?: string;
    }) => {
      const op = buildViewCreateOp({
        workspaceId,
        viewId: args.viewId,
        databasePageId: args.databasePageId,
        name: args.name,
        kind: args.kind,
        groupPropertyId: args.groupPropertyId,
        filters: args.filters,
        sort: args.sort,
        sortKey: args.sortKey,
      });
      // Optimistic patch: add the new view before the server replies.
      patchSnapshot((s) => ({
        ...s,
        views: [
          ...(s.views ?? []),
          {
            id: args.viewId,
            databasePageId: args.databasePageId,
            name: args.name,
            kind: args.kind,
            groupPropertyId: args.groupPropertyId ?? null,
            filters: args.filters ?? [],
            sort: args.sort ?? null,
            sortKey: args.sortKey ?? args.viewId,
            version: 1,
            updatedAt: Date.now(),
          },
        ],
      }));
      await submitOps(workspaceId, [op]);
      await invalidate();
    },
  });

  const update = useMutation({
    mutationFn: async (args: { view: ViewRecord; changes: ViewUpdatePayload }) => {
      const op = buildViewUpdateOp({
        workspaceId,
        viewId: args.view.id,
        baseVersion: args.view.version,
        changes: args.changes,
      });
      // Optimistic patch: apply changes to the cached view immediately so filter/sort take
      // effect before the server round trip completes.
      patchSnapshot((s) => ({
        ...s,
        views: (s.views ?? []).map((v) => (v.id === args.view.id ? { ...v, ...args.changes } : v)),
      }));
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (view: ViewRecord) => {
      const op = buildViewDeleteOp({
        workspaceId,
        viewId: view.id,
        baseVersion: view.version,
      });
      patchSnapshot((s) => ({
        ...s,
        views: (s.views ?? []).filter((v) => v.id !== view.id),
      }));
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const handleFailure = async (action: string, error: unknown) => {
    notify(describeWriteFailure(action, error));
    await invalidate();
  };

  // The label-for-a-view helper follows the same short-label pattern as usePageMutations.
  const viewLabel = (v: ViewRecord) => {
    const name = v.name || v.id;
    return `"${name.length > 60 ? `${name.slice(0, 60)}...` : name}"`;
  };

  // Suppress "views is declared but never read" — views is the snapshot projection needed for
  // future sort-key calculations. Currently unused but mirrors the pattern in usePropertyMutations
  // where siblings are read to compute the next sort key.
  void views;

  return {
    createView: async ({ databasePageId, name, kind, groupPropertyId, filters, sort, sortKey }) => {
      const viewId = crypto.randomUUID();
      try {
        await create.mutateAsync({
          viewId,
          databasePageId,
          name,
          kind,
          groupPropertyId,
          filters,
          sort,
          sortKey,
        });
        return viewId;
      } catch (error) {
        await handleFailure(`Creating the ${kind} view`, error);
        return null;
      }
    },

    updateView: async (view, changes) => {
      try {
        await update.mutateAsync({ view, changes });
      } catch (error) {
        await handleFailure(`Updating view ${viewLabel(view)}`, error);
      }
    },

    deleteView: async (view) => {
      try {
        await remove.mutateAsync(view);
      } catch (error) {
        await handleFailure(`Deleting view ${viewLabel(view)}`, error);
      }
    },

    createDefaultViews: async (databasePageId) => {
      // The three default views are minted as a batch so the new database has all view kinds from
      // the first render. They are submitted as three separate ops (not one batch) because
      // create.mutateAsync posts one op per call, matching the ≤25-op chunk limit safely.
      //
      // Existing databases created before Phase 4 (including seeded ones) have their views minted
      // server-side by the seed extension, so this only runs for UI-created databases.
      //
      // Future: if we add customisable default filters per view kind, wire them in here rather than
      // building a separate "post-create wizard" — this is the single creation site.
      const ids: string[] = [];
      // Mint three successive valid fractional-index sort keys. generateKeyBetween(null, null)
      // produces 'a0'; the two following calls extend the sequence to 'a1' and 'a2'.
      // These single-character strings ('a', 'b', 'c') are NOT valid fractional indices and
      // the server rejects them — this was the root cause of DEF-070.
      const k0 = generateKeyBetween(null, null); // 'a0'
      const k1 = generateKeyBetween(k0, null); // 'a1'
      const k2 = generateKeyBetween(k1, null); // 'a2'
      const kinds: Array<{ kind: ViewKind; name: string; sortKey: string }> = [
        { kind: 'table', name: 'Table', sortKey: k0 },
        { kind: 'board', name: 'Board', sortKey: k1 },
        { kind: 'list', name: 'List', sortKey: k2 },
      ];
      // Submit all three ops in parallel: view.create ops for a brand-new database are independent
      // of each other (no sort-key adjacency, no shared entity) so there is no ordering constraint.
      const results = await Promise.all(
        kinds.map(({ kind, name, sortKey }) => {
          const viewId = crypto.randomUUID();
          const op = buildViewCreateOp({
            workspaceId,
            viewId,
            databasePageId,
            name,
            kind,
            sortKey,
          });
          patchSnapshot((s) => ({
            ...s,
            views: [
              ...(s.views ?? []),
              {
                id: viewId,
                databasePageId,
                name,
                kind,
                groupPropertyId: null,
                filters: [],
                sort: null,
                sortKey,
                version: 1,
                updatedAt: Date.now(),
              },
            ],
          }));
          ids.push(viewId);
          return submitOps(workspaceId, [op]);
        }),
      );
      void results; // Results are checked via server reply; no op-level action needed here.
      await invalidate();
      return ids;
    },
  };
}
