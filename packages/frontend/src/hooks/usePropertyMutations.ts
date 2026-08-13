import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import { submitOps } from '../sync/ops';
import {
  buildPropertyCreateOp,
  buildPropertyDeleteOp,
  buildPropertyUpdateOp,
  buildValueSetOp,
} from '../sync/propertyOps';
import { describeWriteFailure } from '../lib/errors';
import { sortKeyForNewChild } from '../lib/pageTree';
import type {
  PropertyRecord,
  PropertyType,
  PropertyUpdatePayload,
  PropertyValueRecord,
  SelectOption,
  SnapshotResponse,
} from '../api/types';

export interface PropertyMutations {
  createProperty: (args: {
    databasePageId: string;
    name: string;
    type: PropertyType;
    options?: SelectOption[];
  }) => Promise<string | null>;
  updateProperty: (property: PropertyRecord, changes: PropertyUpdatePayload) => Promise<void>;
  deleteProperty: (property: PropertyRecord) => Promise<void>;
  /** Sets a cell value. `value` is the JSON-encoded typed value, or null to clear. */
  setValue: (args: {
    rowPageId: string;
    propertyId: string;
    value: string | null;
    currentRecord?: PropertyValueRecord;
  }) => Promise<void>;
}

/**
 * The property and value write API for the database UI. Follows the same optimistic-update pattern
 * as useBlockMutations: patch the cached snapshot immediately so the UI feels instant, then
 * invalidate after the server confirms to reconcile with server truth.
 *
 * No call here rejects — failures are reported through `notify` and the snapshot is refetched.
 * Future: when the durable queue lands, these append ops to IndexedDB first; the shape does not change.
 */
export function usePropertyMutations(
  userId: string,
  workspaceId: string,
  properties: PropertyRecord[],
  notify: (message: string) => void,
): PropertyMutations {
  const queryClient = useQueryClient();
  const snapshotKey = queryKeys.snapshot(userId, workspaceId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: snapshotKey });

  const patchSnapshot = (apply: (current: SnapshotResponse) => SnapshotResponse) => {
    queryClient.setQueryData<SnapshotResponse>(snapshotKey, (snapshot) =>
      snapshot ? apply(snapshot) : snapshot,
    );
  };

  // Sort keys for new properties, following the same reserved-key pattern as blocks and pages.
  const computeSortKey = (databasePageId: string): string => {
    // Reuse sortKeyForNewChild: properties share the same fractional-indexing scheme. Treat the
    // databasePageId as the "parent" id so each database's properties are keyed independently.
    const siblings = properties
      .filter((p) => p.databasePageId === databasePageId)
      // PropertyRecord does not have parentId; pass a synthetic page shape to sortKeyForNewChild.
      .map((p) => ({ id: p.id, parentId: databasePageId, sortKey: p.sortKey }) as never);
    return sortKeyForNewChild(siblings, databasePageId);
  };

  const create = useMutation({
    mutationFn: async (args: {
      propertyId: string;
      databasePageId: string;
      name: string;
      type: PropertyType;
      options?: SelectOption[];
      sortKey: string;
    }) => {
      const op = buildPropertyCreateOp({
        workspaceId,
        propertyId: args.propertyId,
        databasePageId: args.databasePageId,
        name: args.name,
        type: args.type,
        options: args.options,
        sortKey: args.sortKey,
      });
      // Optimistic patch: add the new property before the server replies.
      patchSnapshot((s) => ({
        ...s,
        properties: [
          ...(s.properties ?? []),
          {
            id: args.propertyId,
            databasePageId: args.databasePageId,
            name: args.name,
            type: args.type,
            options: args.options ?? [],
            sortKey: args.sortKey,
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
    mutationFn: async (args: { property: PropertyRecord; changes: PropertyUpdatePayload }) => {
      const op = buildPropertyUpdateOp({
        workspaceId,
        propertyId: args.property.id,
        baseVersion: args.property.version,
        changes: args.changes,
      });
      // Optimistic patch: apply changes to the cached property immediately.
      patchSnapshot((s) => ({
        ...s,
        properties: (s.properties ?? []).map((p) =>
          p.id === args.property.id ? { ...p, ...args.changes } : p,
        ),
      }));
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (property: PropertyRecord) => {
      const op = buildPropertyDeleteOp({
        workspaceId,
        propertyId: property.id,
        baseVersion: property.version,
      });
      // Optimistic patch: remove the property and all its values from the cache.
      patchSnapshot((s) => ({
        ...s,
        properties: (s.properties ?? []).filter((p) => p.id !== property.id),
        values: (s.values ?? []).filter((v) => v.propertyId !== property.id),
      }));
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const setVal = useMutation({
    mutationFn: async (args: {
      rowPageId: string;
      propertyId: string;
      value: string | null;
      baseVersion?: number;
    }) => {
      const op = buildValueSetOp({
        workspaceId,
        rowPageId: args.rowPageId,
        propertyId: args.propertyId,
        value: args.value,
        baseVersion: args.baseVersion,
      });
      // Optimistic patch: upsert the value in the cached values list.
      patchSnapshot((s) => {
        const existing = (s.values ?? []).find(
          (v) => v.rowPageId === args.rowPageId && v.propertyId === args.propertyId,
        );
        const next: PropertyValueRecord = existing
          ? { ...existing, value: args.value, updatedAt: Date.now() }
          : {
              rowPageId: args.rowPageId,
              propertyId: args.propertyId,
              value: args.value,
              version: 1,
              updatedAt: Date.now(),
            };
        return {
          ...s,
          values: existing
            ? (s.values ?? []).map((v) =>
                v.rowPageId === args.rowPageId && v.propertyId === args.propertyId ? next : v,
              )
            : [...(s.values ?? []), next],
        };
      });
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const handleFailure = async (action: string, error: unknown) => {
    notify(describeWriteFailure(action, error));
    await invalidate();
  };

  return {
    createProperty: async ({ databasePageId, name, type, options }) => {
      const propertyId = crypto.randomUUID();
      const sortKey = computeSortKey(databasePageId);
      try {
        await create.mutateAsync({ propertyId, databasePageId, name, type, options, sortKey });
        return propertyId;
      } catch (error) {
        await handleFailure(`Adding the property "${name}"`, error);
        return null;
      }
    },
    updateProperty: async (property, changes) => {
      try {
        await update.mutateAsync({ property, changes });
      } catch (error) {
        const fields = Object.keys(changes).join(' and ');
        await handleFailure(`Updating the ${fields} of "${property.name}"`, error);
      }
    },
    deleteProperty: async (property) => {
      try {
        await remove.mutateAsync(property);
      } catch (error) {
        await handleFailure(`Deleting the property "${property.name}"`, error);
      }
    },
    setValue: async ({ rowPageId, propertyId, value, currentRecord }) => {
      try {
        await setVal.mutateAsync({
          rowPageId,
          propertyId,
          value,
          baseVersion: currentRecord?.version,
        });
      } catch (error) {
        await handleFailure('Saving the cell value', error);
      }
    },
  };
}
