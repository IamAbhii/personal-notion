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

// A block's text is a paragraph, not a document. 10k characters is far more than anyone types into
// one block and well under D1's 2 MB row ceiling, which an unbounded value could otherwise hit.
export const MAX_BLOCK_TEXT_LENGTH = 10000;
// props carries only type-specific extras (a code language, a callout emoji), so it is small by
// construction; the limit stops it being used as a side channel for arbitrary state.
export const MAX_BLOCK_PROPS_LENGTH = 1000;

// The eleven block types the editor offers, and the only values the type column may hold. Membership
// is checked in payloadRejection rather than by a zod enum, so an unknown type costs the client that
// op instead of failing the whole batch.
export const BLOCK_TYPES = [
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'bulletedList',
  'numberedList',
  'todo',
  'quote',
  'divider',
  'code',
  'callout',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

// True when value is one of the eleven types.
export function isBlockType(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

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

// type is a plain string here, not an enum: see BLOCK_TYPES. sortKey omitted means "append after the
// page's last block", computed by the applier from projected state.
const blockCreatePayload = z.object({
  pageId: z.string().min(1),
  type: z.string(),
  text: z.string().optional(),
  checked: z.boolean().optional(),
  props: z.string().nullable().optional(),
  sortKey: z.string().optional(),
});

// A subset of the editable fields, like page.update: a drag-reorder is one block.update carrying only
// sortKey. pageId is declared so a payload that tries to move a block between pages can be rejected
// per-op rather than silently stripped; moving between pages is not in scope for Phase 2.
const blockUpdatePayload = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  checked: z.boolean().optional(),
  props: z.string().nullable().optional(),
  sortKey: z.string().optional(),
  pageId: z.unknown().optional(),
});

const blockDeletePayload = z.object({}).loose().optional();

const opEnvelope = {
  opId: z.string().min(1),
  workspaceId: z.string().min(1),
  entity: z.enum(['page', 'block']),
  entityId: z.string().min(1),
  // The version the client believed it was editing. Null when the client had no version yet.
  baseVersion: z.number().int().nullable().optional(),
  // Monotonic per device, so a device's queue has a total order.
  clientSeq: z.number().int(),
  createdAt: z.number().int(),
};

// Future: later phases add database.*, row.* and view.* members to this union; the envelope and the
// batching rules stay as they are.
export const opSchema = z.discriminatedUnion('type', [
  z.object({ ...opEnvelope, type: z.literal('page.create'), payload: pageCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.update'), payload: pageUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.delete'), payload: pageDeletePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.create'), payload: blockCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.update'), payload: blockUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.delete'), payload: blockDeletePayload }),
]);

export const syncRequestSchema = z.object({ ops: z.array(opSchema) });

export type Op = z.infer<typeof opSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;

type BlockWriteOp = Extract<Op, { type: 'block.create' | 'block.update' }>;

// The entity an op type acts on. The envelope carries `entity` for the applied_ops log and for future
// entity-scoped routing, so it must agree with the op type rather than being trusted blindly.
function entityFamily(type: Op['type']): 'page' | 'block' {
  return type.startsWith('block.') ? 'block' : 'page';
}

// Why an op's payload is unacceptable, or null when it is fine. Deliberately not expressed as zod
// constraints on the schema: a schema failure fails the whole batch with 400, whereas one bad field
// should cost the client only that op, through the same per-op `rejected` path as a missing parent.
export function payloadRejection(op: Op): string | null {
  const family = entityFamily(op.type);
  if (op.entity !== family) return `entity must be "${family}" for ${op.type}`;
  if (op.type === 'block.create' || op.type === 'block.update') return blockRejection(op);
  if (op.type === 'page.delete' || op.type === 'block.delete') return null;
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

// Why a block create or update payload is unacceptable, or null when it is fine. Same per-op policy
// as the page checks above.
function blockRejection(op: BlockWriteOp): string | null {
  const payload = op.payload;
  // Moving a block to another page is not in scope for Phase 2, and silently ignoring the field would
  // leave the client believing the move happened.
  // Future: allow it by validating the target page here and treating the move as a page change plus a
  // sortKey inside the new page.
  if (op.type === 'block.update' && payload.pageId !== undefined) {
    return 'a block cannot be moved between pages';
  }
  const { type, text, props, sortKey } = payload;
  if (type !== undefined && !isBlockType(type)) return 'unknown block type';
  if (text !== undefined && text.length > MAX_BLOCK_TEXT_LENGTH) {
    return `text must be at most ${MAX_BLOCK_TEXT_LENGTH} characters`;
  }
  if (props !== undefined && props !== null && !isValidProps(props)) {
    return `props must be valid JSON of at most ${MAX_BLOCK_PROPS_LENGTH} characters`;
  }
  if (sortKey !== undefined && !isValidSortKey(sortKey)) {
    return 'sortKey is not a valid fractional index';
  }
  return null;
}

// props is stored as an opaque string and read back by the client as JSON, so a value that does not
// parse would break every later read of that block. It is checked once, here.
function isValidProps(props: string): boolean {
  if (props.length > MAX_BLOCK_PROPS_LENGTH) return false;
  try {
    JSON.parse(props);
    return true;
  } catch {
    return false;
  }
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
