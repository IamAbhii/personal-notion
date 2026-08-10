// The op shape - the only write path in the product. Phases 1-5 post one op at a time and await the
// result; Phase 6 adds the durable queue and the flush loop on top of exactly this shape.
import { z } from 'zod';
import { isValidSortKey } from '../lib/sortKey';

// The client chunks its queue at this size and the server rejects anything larger with 413 rather
// than truncating, because D1 allows 50 queries per Worker invocation on the free plan.
export const MAX_OPS_PER_BATCH = 25;

// A title is a page name, not a document: 500 characters is longer than any sensible name and far
// under D1's 2 MB row ceiling, which an unbounded title could otherwise hit (SQLITE_TOOBIG).
export const MAX_TITLE_LENGTH = 500;
// An icon is one emoji. 32 characters leaves room for a multi-codepoint sequence (skin tone, ZWJ
// family) without allowing an icon to carry a payload.
export const MAX_ICON_LENGTH = 32;

const pageCreatePayload = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  sortKey: z.string().optional(),
});

// A page.update payload is a subset of the editable fields: ops are field-level rather than
// whole-document, so a future implementation can merge two edits to different fields.
const pageUpdatePayload = z.object({
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortKey: z.string().optional(),
});

const pageDeletePayload = z.object({}).loose().optional();

const opEnvelope = {
  opId: z.string().min(1),
  workspaceId: z.string().min(1),
  entity: z.literal('page'),
  entityId: z.string().min(1),
  // The version the client believed it was editing. Null when the client had no version yet.
  baseVersion: z.number().int().nullable().optional(),
  // Monotonic per device, so a device's queue has a total order.
  clientSeq: z.number().int(),
  createdAt: z.number().int(),
};

// Future: later phases add block.*, database.*, row.* and view.* members to this union; the
// envelope and the batching rules stay as they are.
export const opSchema = z.discriminatedUnion('type', [
  z.object({ ...opEnvelope, type: z.literal('page.create'), payload: pageCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.update'), payload: pageUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.delete'), payload: pageDeletePayload }),
]);

export const syncRequestSchema = z.object({ ops: z.array(opSchema) });

export type Op = z.infer<typeof opSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;

// Why an op's payload is unacceptable, or null when it is fine. Deliberately not expressed as zod
// constraints on the schema: a schema failure fails the whole batch with 400, whereas one bad field
// should cost the client only that op, through the same per-op `rejected` path as a missing parent.
export function payloadRejection(op: Op): string | null {
  if (op.type === 'page.delete') return null;
  const { title, icon, sortKey } = op.payload;
  if (title !== undefined && title.length > MAX_TITLE_LENGTH) {
    return `title must be at most ${MAX_TITLE_LENGTH} characters`;
  }
  if (icon !== undefined && icon !== null && icon.length > MAX_ICON_LENGTH) {
    return `icon must be at most ${MAX_ICON_LENGTH} characters`;
  }
  // A stored sort_key that is not a valid fractional index breaks key generation for every later
  // sibling, so it is refused at the door rather than persisted.
  if (sortKey !== undefined && !isValidSortKey(sortKey)) {
    return 'sortKey is not a valid fractional index';
  }
  return null;
}

export type OpStatus = 'applied' | 'replayed' | 'rejected';

export type OpResult = {
  opId: string;
  status: OpStatus;
  reason?: string;
  entityId?: string;
  version?: number;
};

export type VersionMismatch = {
  opId: string;
  entityId: string;
  baseVersion: number;
  serverVersion: number;
};
