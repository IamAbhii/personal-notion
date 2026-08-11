import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../api/queries';
import { isLeaving, submitOnUnload, submitOps } from '../sync/ops';
import { buildBlockCreateOp, buildBlockDeleteOp, buildBlockUpdateOp } from '../sync/blockOps';
import {
  blocksForPage,
  blockTypeLabel,
  sortKeyAfterIndex,
  sortKeyForNewBlock,
} from '../lib/blocks';
import { describeWriteFailure } from '../lib/errors';
import type { BlockRecord, BlockType, BlockUpdatePayload, SnapshotResponse } from '../api/types';

/** What a caller asks for when it creates a block; the id and the sort key are minted here. */
export interface CreateBlockArgs {
  pageId: string;
  type: BlockType;
  text?: string;
  /** Insert directly after this block. Omitted or null appends at the end of the page. */
  afterBlockId?: string | null;
}

export interface BlockMutations {
  /**
   * The new block's id, returned synchronously: the block is in the cached snapshot before this
   * returns, so the caller can focus it in the same event rather than after a round trip.
   */
  createBlock: (args: CreateBlockArgs) => string;
  updateBlock: (block: BlockRecord, changes: BlockUpdatePayload) => Promise<void>;
  deleteBlock: (block: BlockRecord) => Promise<void>;
}

/**
 * The block write API for the editor. Every call builds one op, applies it to the cached snapshot
 * so the editor reacts immediately, posts it, and then re-reads the snapshot so server truth wins.
 *
 * No call here rejects: a failed write is reported through `notify` and the snapshot is refetched,
 * which also discards the optimistic patch, so local state is reconciled rather than left diverged.
 * Future: when the durable queue lands, these append the op to IndexedDB instead of posting it and
 * the flush loop does the network; the shape returned here does not change.
 */
export function useBlockMutations(
  userId: string,
  workspaceId: string,
  blocks: BlockRecord[],
  notify: (message: string) => void,
): BlockMutations {
  const queryClient = useQueryClient();
  const snapshotKey = queryKeys.snapshot(userId, workspaceId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: snapshotKey });

  /** Applies an op's effect to the cached snapshot, so the editor never waits for a round trip. */
  const patchBlocks = (apply: (current: BlockRecord[]) => BlockRecord[]) => {
    queryClient.setQueryData<SnapshotResponse>(snapshotKey, (snapshot) =>
      snapshot ? { ...snapshot, blocks: apply(snapshot.blocks ?? []) } : snapshot,
    );
  };

  // Sort keys minted for creates that are still in flight. `blocks` is the last snapshot this
  // render saw, so without this two fast Enters at the same position compute the same key, and
  // colliding keys leave no key available between the two rows.
  const reservedKeys = useRef<Map<string, Set<string>>>(new Map());

  const reserveSortKey = (pageId: string, afterBlockId: string | null): string => {
    const reserved = reservedKeys.current.get(pageId) ?? new Set<string>();
    const pageBlocks = blocksForPage(blocks, pageId);
    const afterIndex = afterBlockId
      ? pageBlocks.findIndex((block) => block.id === afterBlockId)
      : -1;
    const sortKey =
      afterIndex >= 0
        ? sortKeyAfterIndex(pageBlocks, afterIndex, [...reserved])
        : sortKeyForNewBlock(pageBlocks, [...reserved]);
    reserved.add(sortKey);
    reservedKeys.current.set(pageId, reserved);
    return sortKey;
  };

  // Only the network half of a create: the id, the key and the optimistic patch are already done by
  // the time this runs, because the caller needs the id before any await.
  const create = useMutation({
    mutationFn: async (args: CreateBlockArgs & { blockId: string; sortKey: string }) => {
      try {
        const op = buildBlockCreateOp({
          workspaceId,
          blockId: args.blockId,
          pageId: args.pageId,
          type: args.type,
          text: args.text ?? '',
          sortKey: args.sortKey,
        });
        await submitOps(workspaceId, [op]);
        // The reservation is held until the refetched snapshot carries the key, or a later create
        // computing from a stale snapshot would pick the same one again.
        await invalidate();
      } finally {
        reservedKeys.current.get(args.pageId)?.delete(args.sortKey);
      }
    },
  });

  /** Applies an update to the cached snapshot and returns the op that carries it to the server. */
  const stageUpdate = (block: BlockRecord, changes: BlockUpdatePayload) => {
    patchBlocks((current) =>
      current.map((candidate) =>
        candidate.id === block.id ? { ...candidate, ...changes } : candidate,
      ),
    );
    return buildBlockUpdateOp({
      workspaceId,
      blockId: block.id,
      baseVersion: block.version,
      changes,
    });
  };

  const update = useMutation({
    mutationFn: async (args: { block: BlockRecord; changes: BlockUpdatePayload }) => {
      await submitOps(workspaceId, [stageUpdate(args.block, args.changes)]);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (block: BlockRecord) => {
      patchBlocks((current) => current.filter((candidate) => candidate.id !== block.id));
      const op = buildBlockDeleteOp({
        workspaceId,
        blockId: block.id,
        baseVersion: block.version,
      });
      await submitOps(workspaceId, [op]);
    },
    onSuccess: invalidate,
  });

  /** Reports the failure and re-reads the snapshot, which also rolls the optimistic patch back. */
  const handleFailure = async (action: string, error: unknown) => {
    notify(describeWriteFailure(action, error));
    await invalidate();
  };

  /** What the failed write was, for the notice: the type plus a short quote of the block's text. */
  const label = (block: BlockRecord) => {
    const type = blockTypeLabel(block.type).toLowerCase();
    if (!block.text) return `the ${type} block`;
    const text = block.text.length > 40 ? `${block.text.slice(0, 40)}...` : block.text;
    return `the ${type} block "${text}"`;
  };

  return {
    // The id is minted here, not by the server, and the optimistic patch runs before the network,
    // so the new block exists in the snapshot when this returns and the caret can move to it in the
    // same keystroke. Awaiting the op first left focus in the block the user had just left, and the
    // next character was committed to it.
    createBlock: (args) => {
      const blockId = crypto.randomUUID();
      const sortKey = reserveSortKey(args.pageId, args.afterBlockId ?? null);
      patchBlocks((current) => [
        ...current,
        {
          id: blockId,
          pageId: args.pageId,
          type: args.type,
          text: args.text ?? '',
          checked: false,
          props: null,
          sortKey,
          version: 1,
          updatedAt: Date.now(),
        },
      ]);
      void create
        .mutateAsync({ ...args, blockId, sortKey })
        .catch((error: unknown) =>
          handleFailure(`Adding a ${blockTypeLabel(args.type).toLowerCase()} block`, error),
        );
      return blockId;
    },
    updateBlock: async (block, changes) => {
      // The page is going away, so this is an autosave flush racing the unload. Going through the
      // mutation would lose it: its fetch starts a microtask later, by which time the navigation has
      // been committed and the request is discarded. `submitOnUnload` writes the op down and starts
      // the request here and now. Nothing is invalidated - there is no page left to render a result.
      if (isLeaving()) {
        submitOnUnload(workspaceId, [stageUpdate(block, changes)]);
        return;
      }
      try {
        await update.mutateAsync({ block, changes });
      } catch (error) {
        // The op names its fields, so the notice can say which edit was lost with no per-field case.
        const fields = Object.keys(changes).join(' and ');
        await handleFailure(`Changing the ${fields} of ${label(block)}`, error);
      }
    },
    deleteBlock: async (block) => {
      try {
        await remove.mutateAsync(block);
      } catch (error) {
        await handleFailure(`Deleting ${label(block)}`, error);
      }
    },
  };
}
