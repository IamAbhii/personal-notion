import { buildOp } from './ops';
import type {
  Op,
  ViewCreatePayload,
  ViewDeletePayload,
  ViewFilter,
  ViewKind,
  ViewSort,
  ViewUpdatePayload,
} from '../api/types';

// The three view ops of Phase 4, each a thin named wrapper over buildOp so callers never assemble
// an op literal by hand and every op in the app has the same shape.

/**
 * Creates a new view on a database. The caller mints the view id. `sortKey` omitted appends
 * to the end of the database's view list.
 */
export function buildViewCreateOp(args: {
  workspaceId: string;
  viewId: string;
  databasePageId: string;
  name: string;
  kind: ViewKind;
  groupPropertyId?: string | null;
  filters?: ViewFilter[];
  sort?: ViewSort | null;
  sortKey?: string;
}): Op<ViewCreatePayload> {
  const payload: ViewCreatePayload = {
    databasePageId: args.databasePageId,
    name: args.name,
    kind: args.kind,
  };
  if (args.groupPropertyId !== undefined) payload.groupPropertyId = args.groupPropertyId;
  if (args.filters !== undefined) payload.filters = args.filters;
  if (args.sort !== undefined) payload.sort = args.sort;
  if (args.sortKey !== undefined) payload.sortKey = args.sortKey;

  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'view',
    entityId: args.viewId,
    type: 'view.create',
    // A view that does not exist yet has no version to have been based on.
    baseVersion: 0,
    payload,
  });
}

/**
 * Updates mutable view fields: name, groupPropertyId, filters, sort, sortKey.
 * `kind` is absent from the payload — a view's kind is fixed at creation.
 */
export function buildViewUpdateOp(args: {
  workspaceId: string;
  viewId: string;
  baseVersion: number;
  changes: ViewUpdatePayload;
}): Op<ViewUpdatePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'view',
    entityId: args.viewId,
    type: 'view.update',
    baseVersion: args.baseVersion,
    payload: args.changes,
  });
}

/** Permanently deletes a view. Deletion cascades to nothing — the view is self-contained. */
export function buildViewDeleteOp(args: {
  workspaceId: string;
  viewId: string;
  baseVersion: number;
}): Op<ViewDeletePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'view',
    entityId: args.viewId,
    type: 'view.delete',
    baseVersion: args.baseVersion,
    payload: {},
  });
}
