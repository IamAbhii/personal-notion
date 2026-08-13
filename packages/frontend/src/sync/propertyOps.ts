import { buildOp } from './ops';
import type {
  Op,
  PropertyCreatePayload,
  PropertyDeletePayload,
  PropertyUpdatePayload,
  SelectOption,
  PropertyType,
  ValueSetPayload,
} from '../api/types';

// The four property-side ops of Phase 3, each a thin named wrapper over buildOp so callers never
// assemble an op literal by hand.

/**
 * A new property on a database. The caller mints `propertyId`. Omitting `sortKey` appends.
 * `options` is only required for select/multiSelect types.
 */
export function buildPropertyCreateOp(args: {
  workspaceId: string;
  propertyId: string;
  databasePageId: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
  sortKey?: string;
}): Op<PropertyCreatePayload> {
  const payload: PropertyCreatePayload = {
    databasePageId: args.databasePageId,
    name: args.name,
    type: args.type,
  };
  if (args.options !== undefined) payload.options = args.options;
  if (args.sortKey !== undefined) payload.sortKey = args.sortKey;

  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'property',
    entityId: args.propertyId,
    type: 'property.create',
    // A property that does not exist yet has no version to have been based on.
    baseVersion: 0,
    payload,
  });
}

/**
 * A field-level property edit: rename, manage options or change sort order.
 * Type is not editable — a payload carrying `type` is rejected by the server.
 */
export function buildPropertyUpdateOp(args: {
  workspaceId: string;
  propertyId: string;
  baseVersion: number;
  changes: PropertyUpdatePayload;
}): Op<PropertyUpdatePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'property',
    entityId: args.propertyId,
    type: 'property.update',
    baseVersion: args.baseVersion,
    payload: args.changes,
  });
}

/** A permanent delete of one property. Cascades to all property_values rows for it. */
export function buildPropertyDeleteOp(args: {
  workspaceId: string;
  propertyId: string;
  baseVersion: number;
}): Op<PropertyDeletePayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'property',
    entityId: args.propertyId,
    type: 'property.delete',
    baseVersion: args.baseVersion,
    payload: {},
  });
}

/**
 * Sets one cell value. The entityId is the composite key `${rowPageId}:${propertyId}` so two
 * devices editing the same cell converge under last-write-wins rather than minting two ids.
 * `value` is the JSON-encoded typed value; null clears the cell.
 */
export function buildValueSetOp(args: {
  workspaceId: string;
  rowPageId: string;
  propertyId: string;
  value: string | null;
  baseVersion?: number;
}): Op<ValueSetPayload> {
  return buildOp({
    workspaceId: args.workspaceId,
    entity: 'value',
    entityId: `${args.rowPageId}:${args.propertyId}`,
    type: 'value.set',
    // Values use an upsert so the effective base version is always 0 for a new row and the stored
    // version for an existing one. When the caller does not know the stored version, 0 is safe
    // because last-write-wins means the server applies the op regardless of version mismatch.
    baseVersion: args.baseVersion ?? 0,
    payload: {
      rowPageId: args.rowPageId,
      propertyId: args.propertyId,
      value: args.value,
    },
  });
}
