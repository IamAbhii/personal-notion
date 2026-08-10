import { apiPost } from '../api/client';
import type { Op, OpEntity, OpPayload, OpResult, OpType, SyncResponse } from '../api/types';

// The write path. Every mutation in the product mints an op here and posts it through
// `submitOps`; nothing writes with a plain REST call. Today the post happens immediately and the
// caller awaits the result.
// Future: Phase 6 slides a durable IndexedDB queue and a flush loop underneath `submitOps` -
// append the op locally, apply it optimistically, then flush in <=25-op chunks in clientSeq order.
// No caller changes when that happens.

const CLIENT_SEQ_KEY = 'personal-space:clientSeq';
const MAX_OPS_PER_REQUEST = 25;

/**
 * The next value of the per-device monotonic op counter. Persisted so the total order survives a
 * reload, which the queue will depend on for ordering unsent ops.
 */
export function nextClientSeq(): number {
  const stored = Number(localStorage.getItem(CLIENT_SEQ_KEY) ?? '0');
  const next = Number.isFinite(stored) ? stored + 1 : 1;
  localStorage.setItem(CLIENT_SEQ_KEY, String(next));
  return next;
}

/** Fields the caller supplies; opId, clientSeq and createdAt are minted here. */
export interface BuildOpInput<TPayload extends OpPayload> {
  workspaceId: string;
  entity: OpEntity;
  entityId: string;
  type: OpType;
  payload: TPayload;
  baseVersion: number;
}

/**
 * Builds a complete op. Ids are client-minted UUIDs so a page created with no network is
 * immediately linkable and nestable and sync never has to remap ids.
 */
export function buildOp<TPayload extends OpPayload>(input: BuildOpInput<TPayload>): Op<TPayload> {
  return {
    opId: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    entity: input.entity,
    entityId: input.entityId,
    type: input.type,
    payload: input.payload,
    baseVersion: input.baseVersion,
    clientSeq: nextClientSeq(),
    createdAt: Date.now(),
  };
}

/** A rejected op is a real failure for the caller: the write did not happen. */
export class OpRejectedError extends Error {
  readonly results: OpResult[];

  constructor(results: OpResult[]) {
    const rejected = results.filter((result) => result.status === 'rejected');
    super(rejected.map((result) => result.reason ?? 'rejected').join('; ') || 'Op rejected');
    this.name = 'OpRejectedError';
    this.results = results;
  }
}

/**
 * Posts a batch of ops to the workspace's sync endpoint and throws if the server rejected any.
 * The batch limit is asserted here because it is the server's contract, not a suggestion.
 */
export async function submitOps(workspaceId: string, ops: Op[]): Promise<SyncResponse> {
  if (ops.length > MAX_OPS_PER_REQUEST) {
    throw new Error(`A sync request carries at most ${MAX_OPS_PER_REQUEST} ops`);
  }
  const response = await apiPost<SyncResponse>(`/api/workspaces/${workspaceId}/sync`, { ops });
  if (response.results.some((result) => result.status === 'rejected')) {
    throw new OpRejectedError(response.results);
  }
  return response;
}
