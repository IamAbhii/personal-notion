import { buildOp } from './ops';
import type { Op, PageCreatePayload, PageDeletePayload, PageUpdatePayload } from '../api/types';

// The three page ops of Phase 1, each a thin named wrapper over buildOp so callers never assemble
// an op literal by hand and every op in the app has the same shape.

/** A new page. The caller mints `pageId` so it can navigate to the page before the server replies. */
export function buildPageCreateOp(args: {
  workspaceId: string;
  pageId: string;
  parentId: string | null;
  title: string;
  icon: string;
  sortKey: string;
}): Op<PageCreatePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'page',
    entityId: args.pageId,
    type: 'page.create',
    // A page that does not exist yet has no version to have been based on.
    baseVersion: 0,
    payload: {
      parentId: args.parentId,
      title: args.title,
      icon: args.icon,
      sortKey: args.sortKey,
    },
  });
}

/** A field-level page edit: title, icon, parent or sort key, or any subset of them. */
export function buildPageUpdateOp(args: {
  workspaceId: string;
  pageId: string;
  baseVersion: number;
  changes: PageUpdatePayload;
}): Op<PageUpdatePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'page',
    entityId: args.pageId,
    type: 'page.update',
    // Future: the server records this mismatch and still applies the op (last write wins);
    // refusing here instead is what turns on optimistic concurrency.
    baseVersion: args.baseVersion,
    payload: args.changes,
  });
}

/** A permanent delete of one page; the server cascades to everything nested inside it. */
export function buildPageDeleteOp(args: {
  workspaceId: string;
  pageId: string;
  baseVersion: number;
}): Op<PageDeletePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'page',
    entityId: args.pageId,
    type: 'page.delete',
    baseVersion: args.baseVersion,
    payload: {},
  });
}
