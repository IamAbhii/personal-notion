import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import { submitOps } from '../sync/ops';
import { buildPageCreateOp, buildPageDeleteOp, buildPageUpdateOp } from '../sync/pageOps';
import { sortKeyForNewChild } from '../lib/pageTree';
import type { PageRecord, PageUpdatePayload } from '../api/types';

/** The default look of a freshly created page, before the user names it or picks an icon. */
export const DEFAULT_PAGE_TITLE = 'Untitled';
export const DEFAULT_PAGE_ICON = '\u{1F4C4}';

export interface PageMutations {
  createPage: (parentId: string | null) => Promise<string>;
  updatePage: (page: PageRecord, changes: PageUpdatePayload) => Promise<void>;
  deletePage: (page: PageRecord) => Promise<void>;
  isMutating: boolean;
}

/**
 * The page write API for the UI. Each call builds one op and posts it, then invalidates the
 * workspace snapshot so the tree re-reads server truth - which is why edits survive a refresh.
 * Future: when the durable queue lands, these apply the op to the local store first and the flush
 * loop does the posting; the shape returned here does not change.
 */
export function usePageMutations(
  userId: string,
  workspaceId: string,
  pages: PageRecord[],
): PageMutations {
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.snapshot(userId, workspaceId) });

  const create = useMutation({
    mutationFn: async (parentId: string | null) => {
      // The id is minted here, not by the server, so the caller can navigate immediately.
      const pageId = crypto.randomUUID();
      const op = buildPageCreateOp({
        workspaceId,
        pageId,
        parentId,
        title: DEFAULT_PAGE_TITLE,
        icon: DEFAULT_PAGE_ICON,
        sortKey: sortKeyForNewChild(pages, parentId),
      });
      await submitOps(workspaceId, [op]);
      return pageId;
    },
    onSuccess: invalidate,
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

  return {
    createPage: (parentId) => create.mutateAsync(parentId),
    updatePage: (page, changes) => update.mutateAsync({ page, changes }),
    deletePage: (page) => remove.mutateAsync(page),
    isMutating: create.isPending || update.isPending || remove.isPending,
  };
}
