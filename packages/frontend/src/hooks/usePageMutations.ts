import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import { submitOps } from '../sync/ops';
import { buildPageCreateOp, buildPageDeleteOp, buildPageUpdateOp } from '../sync/pageOps';
import { sortKeyForNewChild } from '../lib/pageTree';
import { describeWriteFailure } from '../lib/errors';
import type { PageKind, PageRecord, PageUpdatePayload } from '../api/types';

/** The default look of a freshly created page, before the user names it or picks an icon. */
export const DEFAULT_PAGE_TITLE = 'Untitled';
export const DEFAULT_PAGE_ICON = '\u{1F4C4}';

export interface PageMutations {
  /**
   * The new page's id, or null when the write failed - in which case the user has been told.
   * `kind` defaults to 'page'; pass 'database' or 'row' for the Phase 3 entity types.
   */
  createPage: (parentId: string | null, kind?: PageKind) => Promise<string | null>;
  updatePage: (page: PageRecord, changes: PageUpdatePayload) => Promise<void>;
  deletePage: (page: PageRecord) => Promise<void>;
  isMutating: boolean;
}

/**
 * The page write API for the UI. Each call builds one op and posts it, then invalidates the
 * workspace snapshot so the tree re-reads server truth - which is why edits survive a refresh.
 *
 * No call here rejects. A failed write is reported to the user through `notify` and the snapshot is
 * re-read, so local state is reconciled with the server instead of being left silently diverged, and
 * a `void`-ed call in a click handler can never become an unhandled rejection.
 * Future: when the durable queue lands, these apply the op to the local store first and the flush
 * loop does the posting; the shape returned here does not change.
 */
export function usePageMutations(
  userId: string,
  workspaceId: string,
  pages: PageRecord[],
  notify: (message: string) => void,
): PageMutations {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(userId, workspaceId) });

  // Sort keys minted for creates that are still in flight. `pages` is the last snapshot the render
  // saw, so without this two clicks in the same render both compute the key after the same sibling.
  const reservedKeys = useRef<Map<string, Set<string>>>(new Map());

  const reserveSortKey = (parentId: string | null): string => {
    const bucket = parentId ?? '';
    const reserved = reservedKeys.current.get(bucket) ?? new Set<string>();
    const sortKey = sortKeyForNewChild(pages, parentId, [...reserved]);
    reserved.add(sortKey);
    reservedKeys.current.set(bucket, reserved);
    return sortKey;
  };

  const releaseSortKey = (parentId: string | null, sortKey: string) => {
    reservedKeys.current.get(parentId ?? '')?.delete(sortKey);
  };

  const create = useMutation({
    mutationFn: async ({ parentId, kind }: { parentId: string | null; kind?: PageKind }) => {
      // The id is minted here, not by the server, so the caller can navigate immediately.
      const pageId = crypto.randomUUID();
      const sortKey = reserveSortKey(parentId);
      try {
        const op = buildPageCreateOp({
          workspaceId,
          pageId,
          parentId,
          title: DEFAULT_PAGE_TITLE,
          icon: DEFAULT_PAGE_ICON,
          sortKey,
          kind,
        });
        await submitOps(workspaceId, [op]);
        // The reservation is held until the refetched snapshot carries the key, or a later create
        // computing from a stale snapshot would pick the same one again.
        await invalidate();
        return pageId;
      } finally {
        releaseSortKey(parentId, sortKey);
      }
    },
  });

  const update = useMutation({
    mutationFn: async (args: { page: PageRecord; changes: PageUpdatePayload }) => {
      const op = buildPageUpdateOp({
        workspaceId,
        pageId: args.page.id,
        baseVersion: args.page.version,
        changes: args.changes,
      });
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (page: PageRecord) => {
      const op = buildPageDeleteOp({
        workspaceId,
        pageId: page.id,
        baseVersion: page.version,
      });
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  /** Reports the failure and re-reads the snapshot, then swallows it: the caller has no repair to do. */
  const handleFailure = async (action: string, error: unknown) => {
    notify(describeWriteFailure(action, error));
    await invalidate();
  };

  /**
   * What the failed write was, for the notice. Falls back to the id so it is never blank, and is
   * shortened because a title can be 500 characters and would otherwise be the whole message.
   */
  const label = (page: PageRecord) => {
    const title = page.title || page.id;
    return `"${title.length > 60 ? `${title.slice(0, 60)}...` : title}"`;
  };

  return {
    createPage: async (parentId, kind) => {
      try {
        return await create.mutateAsync({ parentId, kind });
      } catch (error) {
        const parent = parentId ? pages.find((page) => page.id === parentId) : undefined;
        const entityName = kind === 'database' ? 'database' : kind === 'row' ? 'row' : 'page';
        const action = parent
          ? `Adding a ${entityName} inside ${label(parent)}`
          : `Adding a ${entityName}`;
        await handleFailure(action, error);
        return null;
      }
    },
    updatePage: async (page, changes) => {
      try {
        await update.mutateAsync({ page, changes });
      } catch (error) {
        // The op names its fields, so the notice can say which edit was lost without a per-field case.
        const fields = Object.keys(changes).join(' and ');
        await handleFailure(`Changing the ${fields} of ${label(page)}`, error);
      }
    },
    deletePage: async (page) => {
      try {
        await remove.mutateAsync(page);
      } catch (error) {
        await handleFailure(`Deleting ${label(page)}`, error);
      }
    },
    isMutating: create.isPending || update.isPending || remove.isPending,
  };
}
