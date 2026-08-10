// The op shape - the only write path in the product. Phases 1-5 post one op at a time and await the
// result; Phase 6 adds the durable queue and the flush loop on top of exactly this shape.
import { z } from 'zod';

// The client chunks its queue at this size and the server rejects anything larger with 413 rather
// than truncating, because D1 allows 50 queries per Worker invocation on the free plan.
export const MAX_OPS_PER_BATCH = 25;

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
