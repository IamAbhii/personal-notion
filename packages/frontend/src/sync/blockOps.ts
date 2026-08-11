import { buildOp } from './ops';
import type {
  BlockCreatePayload,
  BlockDeletePayload,
  BlockType,
  BlockUpdatePayload,
  Op,
} from '../api/types';

// The three block ops of Phase 2, each a thin named wrapper over buildOp so callers never assemble
// an op literal by hand and every write in the editor has the same shape.

/**
 * A new block. The caller mints `blockId` so the editor can focus the block before the server
 * replies. Leaving `sortKey` out appends the block at the end of the page, which is what the
 * "click the empty page body" path wants; Enter passes a key between the neighbours instead.
 */
export function buildBlockCreateOp(args: {
  workspaceId: string;
  blockId: string;
  pageId: string;
  type: BlockType;
  text?: string;
  checked?: boolean;
  props?: string | null;
  sortKey?: string;
}): Op<BlockCreatePayload> {
  const payload: BlockCreatePayload = { pageId: args.pageId, type: args.type };
  // Only the fields the caller set are sent, so the server applies its own defaults for the rest.
  if (args.text !== undefined) payload.text = args.text;
  if (args.checked !== undefined) payload.checked = args.checked;
  if (args.props !== undefined) payload.props = args.props;
  if (args.sortKey !== undefined) payload.sortKey = args.sortKey;

  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'block',
    entityId: args.blockId,
    type: 'block.create',
    // A block that does not exist yet has no version to have been based on.
    baseVersion: 0,
    payload,
  });
}

/**
 * A field-level block edit: the type, the text, the checkbox, the props or the sort key, or any
 * subset. A drag-reorder is one of these carrying only `sortKey`, which is the whole reason the
 * ordering is fractional.
 */
export function buildBlockUpdateOp(args: {
  workspaceId: string;
  blockId: string;
  baseVersion: number;
  changes: BlockUpdatePayload;
}): Op<BlockUpdatePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'block',
    entityId: args.blockId,
    type: 'block.update',
    // Future: the server records this mismatch and still applies the op (last write wins);
    // refusing here instead is what turns on optimistic concurrency.
    baseVersion: args.baseVersion,
    payload: args.changes,
  });
}

/** A permanent delete of one block. */
export function buildBlockDeleteOp(args: {
  workspaceId: string;
  blockId: string;
  baseVersion: number;
}): Op<BlockDeletePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'block',
    entityId: args.blockId,
    type: 'block.delete',
    baseVersion: args.baseVersion,
    payload: {},
  });
}
