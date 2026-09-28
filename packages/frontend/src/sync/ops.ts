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

// Whether the document is on its way out. Read by the write path to choose its transport, and set
// by the listeners `watchForUnload` installs.
let leaving = false;

/** True once the page has begun going away or been backgrounded, so a fetch would not survive. */
export function isLeaving(): boolean {
  return leaving;
}

/**
 * Watches for the page going away, so a write started at that moment can pick a transport that
 * survives it. Called once at app start, before React mounts anything: listener order for one event
 * on one target is registration order, so this runs before the autosave flush listeners it informs.
 *
 * Both events are needed and neither is enough. Chromium fires `pagehide` on a reload while
 * `document.visibilityState` is still "visible" - it only flips to hidden afterwards - so the
 * visibility check alone never sees an unload. And on a phone an app switch is often all the warning
 * there is, with no `pagehide` at all.
 */
export function watchForUnload(): void {
  window.addEventListener('pagehide', () => {
    leaving = true;
  });
  // A restore from the back/forward cache means the page is alive again and fetch works normally.
  window.addEventListener('pageshow', () => {
    leaving = false;
  });
  document.addEventListener('visibilitychange', () => {
    leaving = document.visibilityState === 'hidden';
  });
}

// Ops written down at unload, so an edit cannot die with the page. This is the smallest possible
// stand-in for the real thing.
// Future: Phase 6 replaces this key with the durable IndexedDB queue - same op shape, same replay on
// start, but every write goes through it rather than only the ones caught by an unload, and a
// rejection is reported to the user instead of dropped.
const PENDING_OPS_KEY = 'personal-space:pendingOps';

/** The ops an earlier unload wrote down. Unreadable storage reads as empty rather than throwing. */
export function readStashedOps(): Op[] {
  try {
    const raw = localStorage.getItem(PENDING_OPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Op[]) : [];
  } catch {
    return [];
  }
}

/**
 * Writes ops down synchronously, which is the one thing an unload cannot interrupt. Swallows a
 * QuotaExceededError rather than throwing at unload time: a single large image op can hit the
 * 5 MB origin cap, and an unhandled throw at unload is unrecoverable.
 * Future: replace this stash with the durable IndexedDB queue from Phase 6, which is not subject
 * to the localStorage quota and handles large payloads without data loss.
 */
export function stashOps(ops: Op[]): void {
  try {
    localStorage.setItem(PENDING_OPS_KEY, JSON.stringify([...readStashedOps(), ...ops]));
  } catch {
    // QuotaExceededError: the op is too large to stash (e.g. a big image block). Drop it rather
    // than throwing at unload. The user may lose the edit if they close the tab right now, but
    // the app stays alive and later writes are not affected.
  }
}

/**
 * Sends anything an earlier unload wrote down, in `clientSeq` order, and returns how many were sent
 * so the caller can re-read the snapshot. The stash is cleared before the attempt: a replayed op is
 * safe - the server's `applied_ops` table makes it a no-op - but an op the server refuses must not be
 * retried on every start for ever.
 */
export async function flushStashedOps(workspaceId: string): Promise<number> {
  const stashed = readStashedOps();
  const mine = stashed
    .filter((op) => op.workspaceId === workspaceId)
    .sort((a, b) => a.clientSeq - b.clientSeq)
    .slice(0, MAX_OPS_PER_REQUEST);
  if (mine.length === 0) return 0;
  const keep = stashed.filter((op) => !mine.includes(op));
  localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(keep));
  await submitOps(workspaceId, mine);
  return mine.length;
}

/**
 * Sends a batch of ops as the page is going away. Two things happen, and both are needed.
 *
 * The ops are written to local storage first, synchronously, because that is the only step an unload
 * cannot interrupt. Then the request is started in the same synchronous step as the caller: the
 * ordinary path runs through a TanStack mutation whose `fetch` starts a microtask later, by which
 * time the browser has committed to the navigation and discards it - measured, not assumed.
 *
 * Even started synchronously the request often does not land, because a service worker controls the
 * page and Chromium drops a request routed through it when the client that made it goes away. That is
 * what the stash is for: whatever did not land is replayed by `flushStashedOps` on the next start,
 * and a replay is harmless because the server recognises the `opId`.
 *
 * Nothing is awaited and no failure is reported: there is no page left to report it on.
 */
export function submitOnUnload(workspaceId: string, ops: Op[]): void {
  stashOps(ops);
  void submitOps(workspaceId, ops)
    .then(() => {
      // It did land after all - a backgrounded tab is still alive - so drop it rather than let the
      // stash grow across a day of tab switching.
      const sent = new Set(ops.map((op) => op.opId));
      const keep = readStashedOps().filter((op) => !sent.has(op.opId));
      localStorage.setItem(PENDING_OPS_KEY, JSON.stringify(keep));
    })
    .catch(() => {
      // Deliberately silent: the document is unloading, so there is nobody to tell.
    });
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
