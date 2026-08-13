// The wire types for the Phase 1 API contract. They mirror the server responses exactly so the
// rest of the app never reshapes data at the boundary.

/** The signed-in user. */
export interface User {
  id: string;
  email: string;
  name: string;
}

/** One workspace the user belongs to, with the role they hold in it. */
export interface Membership {
  workspaceId: string;
  name: string;
  role: string;
}

/**
 * GET /api/me. `memberships` is an array today with one element; the client treats that as a
 * current fact and never as an invariant.
 */
export interface MeResponse {
  user: User;
  memberships: Membership[];
}

/** What a page can be. A row is always a child of a database; never changes after creation. */
export type PageKind = 'page' | 'database' | 'row';

/** A page as the snapshot returns it. `sortKey` is a fractional index, not a position. */
export interface PageRecord {
  id: string;
  parentId: string | null;
  title: string;
  icon: string;
  sortKey: string;
  kind: PageKind;
  version: number;
  // The server sends epoch milliseconds; the union keeps an ISO string valid too, since both are
  // accepted by `new Date(...)` and D1 has stored timestamps both ways historically.
  updatedAt: number | string;
}

/** The seven property types. Fixed once created; a phase.update op carrying `type` is rejected. */
export type PropertyType =
  'text' | 'number' | 'select' | 'multiSelect' | 'date' | 'checkbox' | 'url';

/**
 * The six option colors, exported from the contract so frontend and worker share the list.
 * Amber, blue and purple are the existing product palette; gray, teal and rose extend it so a
 * select with six options is still readable.
 */
export const OPTION_COLORS = ['gray', 'amber', 'blue', 'purple', 'teal', 'rose'] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

/** One option in a select or multiSelect property. */
export interface SelectOption {
  id: string;
  name: string;
  color: OptionColor;
}

/** A property as the snapshot returns it. `options` is always an array, empty for non-select types. */
export interface PropertyRecord {
  id: string;
  databasePageId: string;
  name: string;
  type: PropertyType;
  options: SelectOption[];
  sortKey: string;
  version: number;
  updatedAt: number;
}

/**
 * A property value as the snapshot returns it. `value` is the raw JSON string as stored;
 * the client parses it per type. `null` means the cell is empty.
 */
export interface PropertyValueRecord {
  rowPageId: string;
  propertyId: string;
  value: string | null;
  version: number;
  updatedAt: number;
}

/**
 * The eleven block types of Phase 2, exactly as the server stores them. Phase 2 has no inline
 * formatting, so `text` everywhere below is plain text.
 * Future: image, embed and database-view blocks join this list in later phases.
 */
export type BlockType =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletedList'
  | 'numberedList'
  | 'todo'
  | 'quote'
  | 'divider'
  | 'code'
  | 'callout';

/**
 * A block as the snapshot returns it. `sortKey` is a fractional index, so a reorder is one op on
 * one row. `props` is a JSON string holding type-specific extras only - the code language, the
 * callout emoji - and is null for the types that have none.
 */
export interface BlockRecord {
  id: string;
  pageId: string;
  type: BlockType;
  text: string;
  checked: boolean;
  props: string | null;
  sortKey: string;
  version: number;
  updatedAt: number | string;
}

/**
 * GET /api/workspaces/:workspaceId/snapshot — the only read on cold start.
 * Future: Phase 4 adds views and per-view settings as a sibling key here.
 */
export interface SnapshotResponse {
  workspaceId: string;
  pages: PageRecord[];
  blocks: BlockRecord[];
  /** All properties for every database in this workspace. Absent on a pre-Phase-3 server. */
  properties?: PropertyRecord[];
  /** All property values for every row in this workspace. Absent on a pre-Phase-3 server. */
  values?: PropertyValueRecord[];
}

/** The entity kinds ops can target. Phase 3 adds property and value. */
export type OpEntity = 'page' | 'block' | 'property' | 'value';

/** All op types across Phases 1–3. Future: view op types are added here. */
export type OpType =
  | 'page.create'
  | 'page.update'
  | 'page.delete'
  | 'block.create'
  | 'block.update'
  | 'block.delete'
  | 'property.create'
  | 'property.update'
  | 'property.delete'
  | 'value.set';

/** Payload of a `page.create` op. The client mints the id, so no id is in the payload. */
export interface PageCreatePayload {
  parentId: string | null;
  title: string;
  icon: string;
  sortKey: string;
  /** Omit for the default 'page' kind. A row or database is minted once and never changed. */
  kind?: PageKind;
}

/** Payload of a `page.update` op: any subset of the mutable page fields. */
export interface PageUpdatePayload {
  title?: string;
  icon?: string;
  parentId?: string | null;
  sortKey?: string;
}

/** Payload of a `page.delete` op. Deletion is permanent and cascades to nested pages. */
export type PageDeletePayload = Record<string, never>;

/**
 * Payload of a `block.create` op. The client mints the block id, so no id is in the payload.
 * Omitting `sortKey` tells the server to append the block at the end of the page.
 */
export interface BlockCreatePayload {
  pageId: string;
  type: BlockType;
  text?: string;
  checked?: boolean;
  props?: string | null;
  sortKey?: string;
}

/**
 * Payload of a `block.update` op: any subset of the mutable block fields. `pageId` is deliberately
 * absent - the server rejects an op that tries to move a block between pages.
 */
export interface BlockUpdatePayload {
  type?: BlockType;
  text?: string;
  checked?: boolean;
  props?: string | null;
  sortKey?: string;
}

/** Payload of a `block.delete` op. Deletion is permanent; there is no trash. */
export type BlockDeletePayload = Record<string, never>;

/**
 * Payload of a `property.create` op. The client mints the property id. `sortKey` omitted appends.
 * `options` is only for select/multiSelect; omit for other types.
 */
export interface PropertyCreatePayload {
  databasePageId: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  sortKey?: string;
}

/**
 * Payload of a `property.update` op: rename, recolor/add/remove options, or reorder.
 * `type` is absent — a property's type cannot be changed once created.
 */
export interface PropertyUpdatePayload {
  name?: string;
  options?: SelectOption[];
  sortKey?: string;
}

/** Payload of a `property.delete` op. Cascades to all values for this property. */
export type PropertyDeletePayload = Record<string, never>;

/**
 * Payload of a `value.set` op. The entityId is `${rowPageId}:${propertyId}` (composite key) so
 * two devices editing the same cell converge under last-write-wins with no id clash.
 * `value` is the JSON-encoded typed value, or null to clear the cell.
 */
export interface ValueSetPayload {
  rowPageId: string;
  propertyId: string;
  value: string | null;
}

export type OpPayload =
  | PageCreatePayload
  | PageUpdatePayload
  | PageDeletePayload
  | BlockCreatePayload
  | BlockUpdatePayload
  | BlockDeletePayload
  | PropertyCreatePayload
  | PropertyUpdatePayload
  | PropertyDeletePayload
  | ValueSetPayload;

/**
 * An intent-based write. Every mutation in the app is one of these, minted client-side with a UUID
 * `opId` and a monotonic `clientSeq`, so a durable queue can be slid underneath unchanged.
 */
export interface Op<TPayload extends OpPayload = OpPayload> {
  opId: string;
  workspaceId: string;
  entity: OpEntity;
  entityId: string;
  type: OpType;
  payload: TPayload;
  baseVersion: number;
  clientSeq: number;
  /** Epoch milliseconds, which is what the sync endpoint validates. */
  createdAt: number;
}

/** The outcome the server reports for one op in a batch. */
export interface OpResult {
  opId: string;
  status: 'applied' | 'replayed' | 'rejected';
  reason?: string;
  entityId?: string;
  version?: number;
}

/** POST /api/workspaces/:workspaceId/sync. */
export interface SyncResponse {
  results: OpResult[];
  // Future: type these and surface them as "N changes overwrote newer edits" when the concurrency
  // reporting UI lands; recorded but unread today, per the last-write-wins policy.
  versionMismatches: unknown[];
  etag: string;
}
