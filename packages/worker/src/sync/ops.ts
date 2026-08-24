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

// Per-database property limits. 100 characters is longer than any sensible name; 50 properties is
// more than any practical table; 50 options is more than any readable select menu.
export const MAX_PROPERTY_NAME_LENGTH = 100;
export const MAX_PROPERTIES_PER_DATABASE = 50;
export const MAX_OPTIONS_PER_PROPERTY = 50;
export const MAX_OPTION_NAME_LENGTH = 100;

// value is a JSON string; 2000 characters comfortably holds a long text field without allowing
// values to be used as a side channel for arbitrary blobs.
export const MAX_VALUE_LENGTH = 2000;

// View name limit: 200 characters is longer than any sensible view name and well under D1's ceiling.
export const MAX_VIEW_NAME_LENGTH = 200;

// The twelve block types the editor offers, and the only values the type column may hold. Membership
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
  'toggleList',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

// True when value is one of the twelve block types.
export function isBlockType(value: string): value is BlockType {
  return (BLOCK_TYPES as readonly string[]).includes(value);
}

// The seven property types. type is fixed once created; a property.update carrying type is rejected.
// Future: allowing type changes would require migrating existing values, which is a separate feature.
export const PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];

// True when value is one of the seven property types.
export function isPropertyType(value: string): value is PropertyType {
  return (PROPERTY_TYPES as readonly string[]).includes(value);
}

// The fixed palette for select/multiSelect option colors. Exported so the frontend can map names
// to Tailwind classes and Phase 4's board columns inherit the same colors for free.
// Future: more colors could be added here, but the current six cover the common case and adding one
// later is a non-breaking change (old data keeps its stored color name).
export const OPTION_COLORS = ['gray', 'amber', 'blue', 'purple', 'teal', 'rose'] as const;

export type OptionColor = (typeof OPTION_COLORS)[number];

// True when value is one of the allowed option colors.
export function isOptionColor(value: string): value is OptionColor {
  return (OPTION_COLORS as readonly string[]).includes(value);
}

// A single select or multiSelect option. id is client-minted so the client can reference it in
// value.set before the property is persisted (in the same batch).
export type SelectOption = { id: string; name: string; color: OptionColor };

// Zod schema for a SelectOption, reused in property create/update payloads.
const selectOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string(),
});

const pageCreatePayload = z.object({
  parentId: z.string().nullable().optional(),
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  sortKey: z.string().optional(),
  // kind is optional; defaults to 'page'. Rows must be parented to a database; databases and pages
  // must not be parented to a database or row.
  kind: z.enum(['page', 'database', 'row']).optional(),
});

// A page.update payload is a subset of the editable fields: ops are field-level rather than
// whole-document, so a future implementation can merge two edits to different fields. kind is
// declared here so its presence can be detected and rejected per-op in payloadRejection.
const pageUpdatePayload = z.object({
  title: z.string().optional(),
  icon: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  sortKey: z.string().optional(),
  kind: z.unknown().optional(),
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

// Property create: all fields required or optional as stated. sortKey omitted appends after the last
// property. options is only meaningful for select/multiSelect but is accepted for all types and
// ignored by the frontend for others.
const propertyCreatePayload = z.object({
  databasePageId: z.string().min(1),
  name: z.string(),
  type: z.string(),
  options: z.array(selectOptionSchema).optional(),
  sortKey: z.string().optional(),
});

// type is declared so its presence can be detected and rejected per-op: a property's type cannot
// change once set. All other fields are optional updates.
// Future: allowing type changes would require migrating existing cell values; not in scope.
const propertyUpdatePayload = z.object({
  name: z.string().optional(),
  options: z.array(selectOptionSchema).optional(),
  sortKey: z.string().optional(),
  type: z.unknown().optional(),
});

const propertyDeletePayload = z.object({}).loose().optional();

// value.set is an upsert keyed by (row_page_id, property_id). entityId is the derived key
// `${rowPageId}:${propertyId}` so the applied_ops log can identify it. value is a JSON string
// encoding the typed value, or null to clear the cell.
const valueSetPayload = z.object({
  rowPageId: z.string().min(1),
  propertyId: z.string().min(1),
  value: z.string().nullable(),
});

// The eight filter operators across all property types. operator is stored as a plain string rather
// than a zod enum so an unknown operator costs only that op rather than the whole batch.
export const FILTER_OPERATORS = [
  'contains',
  'notContains',
  'is',
  'isNot',
  'before',
  'after',
  'isChecked',
  'isNotChecked',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

// True when value is one of the eight filter operators.
export function isFilterOperator(value: string): value is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(value);
}

// Which operators are legal for each property type. Used by the applier to validate filter settings
// against the type of the property being filtered.
export const OPERATORS_BY_TYPE: Record<string, FilterOperator[]> = {
  text: ['contains', 'notContains'],
  url: ['contains', 'notContains'],
  select: ['is', 'isNot'],
  multiSelect: ['is', 'isNot'],
  checkbox: ['isChecked', 'isNotChecked'],
  date: ['before', 'after'],
  number: ['is', 'isNot'],
};

// A single filter condition. operator is z.string() (not an enum) so an unknown operator costs
// only this op rather than failing the whole batch.
const viewFilterSchema = z.object({
  id: z.string().min(1),
  propertyId: z.string().min(1),
  operator: z.string(),
  value: z.string().nullable(),
});

// A view sort. direction uses z.enum so an obviously bad value fails the batch-level parse
// (a developer mistake, not a server-skew issue), consistent with page.create's kind enum.
const viewSortSchema = z.object({
  propertyId: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

// view.create: entityId is the view id, minted client-side. databasePageId must be an existing
// database page in the workspace. kind is fixed at creation; view.update may not carry it.
const viewCreatePayload = z.object({
  databasePageId: z.string().min(1),
  name: z.string(),
  kind: z.enum(['table', 'board', 'list']),
  groupPropertyId: z.string().nullable().optional(),
  filters: z.array(viewFilterSchema).optional(),
  sort: viewSortSchema.nullable().optional(),
  sortKey: z.string().optional(),
});

// kind is declared here so its presence can be detected and rejected per-op in viewRejection.
// Future: kind changes would require migrating dependent UI state; not in scope.
const viewUpdatePayload = z.object({
  name: z.string().optional(),
  groupPropertyId: z.string().nullable().optional(),
  filters: z.array(viewFilterSchema).optional(),
  sort: viewSortSchema.nullable().optional(),
  sortKey: z.string().optional(),
  kind: z.unknown().optional(),
});

const viewDeletePayload = z.object({}).loose().optional();

const opEnvelope = {
  opId: z.string().min(1),
  workspaceId: z.string().min(1),
  entity: z.enum(['page', 'block', 'property', 'value', 'view']),
  entityId: z.string().min(1),
  // The version the client believed it was editing. Null when the client had no version yet.
  baseVersion: z.number().int().nullable().optional(),
  // Monotonic per device, so a device's queue has a total order.
  clientSeq: z.number().int(),
  createdAt: z.number().int(),
};

export const opSchema = z.discriminatedUnion('type', [
  z.object({ ...opEnvelope, type: z.literal('page.create'), payload: pageCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.update'), payload: pageUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('page.delete'), payload: pageDeletePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.create'), payload: blockCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.update'), payload: blockUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('block.delete'), payload: blockDeletePayload }),
  z.object({ ...opEnvelope, type: z.literal('property.create'), payload: propertyCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('property.update'), payload: propertyUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('property.delete'), payload: propertyDeletePayload }),
  z.object({ ...opEnvelope, type: z.literal('value.set'), payload: valueSetPayload }),
  z.object({ ...opEnvelope, type: z.literal('view.create'), payload: viewCreatePayload }),
  z.object({ ...opEnvelope, type: z.literal('view.update'), payload: viewUpdatePayload }),
  z.object({ ...opEnvelope, type: z.literal('view.delete'), payload: viewDeletePayload }),
]);

export const syncRequestSchema = z.object({ ops: z.array(opSchema) });

export type Op = z.infer<typeof opSchema>;
export type SyncRequest = z.infer<typeof syncRequestSchema>;

type BlockWriteOp = Extract<Op, { type: 'block.create' | 'block.update' }>;
type PropertyWriteOp = Extract<Op, { type: 'property.create' | 'property.update' }>;
type ViewWriteOp = Extract<Op, { type: 'view.create' | 'view.update' }>;

// The entity an op type acts on. The envelope carries `entity` for the applied_ops log and for future
// entity-scoped routing, so it must agree with the op type rather than being trusted blindly.
function entityFamily(type: Op['type']): 'page' | 'block' | 'property' | 'value' | 'view' {
  if (type.startsWith('block.')) return 'block';
  if (type.startsWith('property.')) return 'property';
  if (type.startsWith('value.')) return 'value';
  if (type.startsWith('view.')) return 'view';
  return 'page';
}

// Why an op's payload is unacceptable, or null when it is fine. Deliberately not expressed as zod
// constraints on the schema: a schema failure fails the whole batch with 400, whereas one bad field
// should cost the client only that op, through the same per-op `rejected` path as a missing parent.
export function payloadRejection(op: Op): string | null {
  const family = entityFamily(op.type);
  if (op.entity !== family) return `entity must be "${family}" for ${op.type}`;
  if (op.type === 'block.create' || op.type === 'block.update') return blockRejection(op);
  if (op.type === 'property.create' || op.type === 'property.update') return propertyRejection(op);
  if (op.type === 'value.set') return valueRejection(op);
  if (op.type === 'view.create' || op.type === 'view.update') return viewRejection(op);
  // page.delete, block.delete, property.delete and view.delete have no payload fields to validate.
  if (
    op.type === 'page.delete' ||
    op.type === 'block.delete' ||
    op.type === 'property.delete' ||
    op.type === 'view.delete'
  ) {
    return null;
  }

  // page.create and page.update
  if (op.type === 'page.update' && op.payload.kind !== undefined) {
    return 'a page cannot change kind';
  }
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

// Why a property create or update payload is unacceptable, or null when it is fine.
function propertyRejection(op: PropertyWriteOp): string | null {
  // A property's type is fixed once created: changing it would require migrating existing values.
  // Future: type migration is a separate feature, not in scope.
  if (op.type === 'property.update' && op.payload.type !== undefined) {
    return "a property's type cannot be changed";
  }

  if (op.type === 'property.create') {
    const { name, type, options, sortKey } = op.payload;
    if (name.trim() === '') return 'name must not be empty';
    if (name.length > MAX_PROPERTY_NAME_LENGTH) {
      return `name must be at most ${MAX_PROPERTY_NAME_LENGTH} characters`;
    }
    if (!isPropertyType(type)) return 'unknown property type';
    if (options !== undefined) {
      const err = validateOptions(options);
      if (err) return err;
    }
    if (sortKey !== undefined && !isValidSortKey(sortKey)) {
      return 'sortKey is not a valid fractional index';
    }
    return null;
  }

  // property.update
  const { name, options, sortKey } = op.payload;
  if (name !== undefined && name.trim() === '') return 'name must not be empty';
  if (name !== undefined && name.length > MAX_PROPERTY_NAME_LENGTH) {
    return `name must be at most ${MAX_PROPERTY_NAME_LENGTH} characters`;
  }
  if (options !== undefined) {
    const err = validateOptions(options);
    if (err) return err;
  }
  if (sortKey !== undefined && !isValidSortKey(sortKey)) {
    return 'sortKey is not a valid fractional index';
  }
  return null;
}

// Validates an array of SelectOption definitions, returning a rejection reason or null.
// Duplicate name detection is case-insensitive and compares trimmed values so that "Done" and
// "done " are treated as the same name — two options that differ only in case or surrounding
// whitespace produce identical columns on a board and identical chips in every picker, which is
// the same usability problem as an exact duplicate.
function validateOptions(
  options: Array<{ id: string; name: string; color: string }>,
): string | null {
  if (options.length > MAX_OPTIONS_PER_PROPERTY) {
    return `options must have at most ${MAX_OPTIONS_PER_PROPERTY} entries`;
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const opt of options) {
    const trimmedName = opt.name.trim();
    if (trimmedName === '') return 'option name must not be empty';
    if (opt.name.length > MAX_OPTION_NAME_LENGTH) {
      return `option name must be at most ${MAX_OPTION_NAME_LENGTH} characters`;
    }
    if (!isOptionColor(opt.color)) return 'unknown option color';
    if (seenIds.has(opt.id)) return 'duplicate option id';
    seenIds.add(opt.id);
    // Normalise to lowercase for the duplicate-name check so "Done" and "done" are the same key.
    const normalizedName = trimmedName.toLowerCase();
    if (seenNames.has(normalizedName)) {
      return `duplicate option name: option names must be unique (case-insensitive)`;
    }
    seenNames.add(normalizedName);
  }
  return null;
}

// Why a value.set payload is unacceptable without loading state, or null when it is fine.
// Type-correctness of the JSON value against the property's type is checked in the applier, where
// the property state is available.
function valueRejection(op: Extract<Op, { type: 'value.set' }>): string | null {
  const { value } = op.payload;
  if (value !== null && value.length > MAX_VALUE_LENGTH) {
    return `value must be at most ${MAX_VALUE_LENGTH} characters`;
  }
  return null;
}

// Why a view create or update payload is unacceptable without loading state, or null when it is fine.
// Stateful checks (databasePageId exists, groupPropertyId is a select property, filter propertyIds
// belong to the database, operator is legal for property type) are deferred to the applier.
function viewRejection(op: ViewWriteOp): string | null {
  // A view's kind is fixed at creation, matching the same pattern as a page's kind.
  if (op.type === 'view.update' && op.payload.kind !== undefined) {
    return "a view's kind cannot be changed";
  }
  const { name, sortKey } = op.payload;
  if (name !== undefined) {
    if (name.trim() === '') return 'name must not be empty';
    if (name.length > MAX_VIEW_NAME_LENGTH) {
      return `name must be at most ${MAX_VIEW_NAME_LENGTH} characters`;
    }
  }
  if (sortKey !== undefined && !isValidSortKey(sortKey)) {
    return 'sortKey is not a valid fractional index';
  }
  // Validate filter operators structurally; the operator-vs-property-type check is in the applier.
  const filters = op.payload.filters;
  if (filters !== undefined) {
    for (const f of filters) {
      if (!isFilterOperator(f.operator)) return `unknown filter operator: ${f.operator}`;
    }
  }
  // Validate sort direction structurally; the sort propertyId check is in the applier.
  const sort = op.payload.sort;
  if (sort !== undefined && sort !== null) {
    if (sort.direction !== 'asc' && sort.direction !== 'desc') {
      return "sort direction must be 'asc' or 'desc'";
    }
    if (!sort.propertyId || sort.propertyId.trim() === '')
      return 'sort propertyId must not be empty';
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
