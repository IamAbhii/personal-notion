import { describe, expect, it } from 'vitest';
import {
  buildPropertyCreateOp,
  buildPropertyDeleteOp,
  buildPropertyUpdateOp,
  buildValueSetOp,
} from './propertyOps';

describe('buildPropertyCreateOp', () => {
  it('builds a property.create op with the required fields', () => {
    const op = buildPropertyCreateOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      databasePageId: 'db-1',
      name: 'Status',
      type: 'select',
      options: [{ id: 'opt-1', name: 'Todo', color: 'gray' }],
    });
    expect(op.type).toBe('property.create');
    expect(op.entity).toBe('property');
    expect(op.entityId).toBe('prop-1');
    expect(op.workspaceId).toBe('ws-1');
    expect(op.baseVersion).toBe(0);
    expect(op.payload.databasePageId).toBe('db-1');
    expect(op.payload.name).toBe('Status');
    expect(op.payload.type).toBe('select');
    expect(op.payload.options).toHaveLength(1);
  });

  it('omits options and sortKey when not provided', () => {
    const op = buildPropertyCreateOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      databasePageId: 'db-1',
      name: 'Notes',
      type: 'text',
    });
    expect(op.payload.options).toBeUndefined();
    expect(op.payload.sortKey).toBeUndefined();
  });

  it('includes sortKey when provided', () => {
    const op = buildPropertyCreateOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      databasePageId: 'db-1',
      name: 'Due',
      type: 'date',
      sortKey: 'a1',
    });
    expect(op.payload.sortKey).toBe('a1');
  });

  it('mints a fresh opId on each call', () => {
    const args = {
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      databasePageId: 'db-1',
      name: 'X',
      type: 'text' as const,
    };
    const a = buildPropertyCreateOp(args);
    const b = buildPropertyCreateOp(args);
    expect(a.opId).not.toBe(b.opId);
  });
});

describe('buildPropertyUpdateOp', () => {
  it('builds a property.update op with the changes', () => {
    const op = buildPropertyUpdateOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      baseVersion: 3,
      changes: { name: 'Renamed' },
    });
    expect(op.type).toBe('property.update');
    expect(op.entity).toBe('property');
    expect(op.entityId).toBe('prop-1');
    expect(op.baseVersion).toBe(3);
    expect(op.payload.name).toBe('Renamed');
  });

  it('can carry options and sortKey', () => {
    const options = [{ id: 'o1', name: 'Open', color: 'blue' as const }];
    const op = buildPropertyUpdateOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      baseVersion: 1,
      changes: { options, sortKey: 'b2' },
    });
    expect(op.payload.options).toEqual(options);
    expect(op.payload.sortKey).toBe('b2');
  });
});

describe('buildPropertyDeleteOp', () => {
  it('builds a property.delete op with an empty payload', () => {
    const op = buildPropertyDeleteOp({
      workspaceId: 'ws-1',
      propertyId: 'prop-1',
      baseVersion: 2,
    });
    expect(op.type).toBe('property.delete');
    expect(op.entity).toBe('property');
    expect(op.entityId).toBe('prop-1');
    expect(op.baseVersion).toBe(2);
    expect(op.payload).toEqual({});
  });
});

describe('buildValueSetOp', () => {
  it('derives the entityId from rowPageId and propertyId', () => {
    const op = buildValueSetOp({
      workspaceId: 'ws-1',
      rowPageId: 'row-1',
      propertyId: 'prop-1',
      value: '"Hello"',
    });
    expect(op.type).toBe('value.set');
    expect(op.entity).toBe('value');
    expect(op.entityId).toBe('row-1:prop-1');
    expect(op.payload.rowPageId).toBe('row-1');
    expect(op.payload.propertyId).toBe('prop-1');
    expect(op.payload.value).toBe('"Hello"');
  });

  it('allows null value to clear a cell', () => {
    const op = buildValueSetOp({
      workspaceId: 'ws-1',
      rowPageId: 'row-1',
      propertyId: 'prop-1',
      value: null,
    });
    expect(op.payload.value).toBeNull();
  });

  it('defaults baseVersion to 0', () => {
    const op = buildValueSetOp({
      workspaceId: 'ws-1',
      rowPageId: 'row-1',
      propertyId: 'prop-1',
      value: 'true',
    });
    expect(op.baseVersion).toBe(0);
  });

  it('uses the provided baseVersion when given', () => {
    const op = buildValueSetOp({
      workspaceId: 'ws-1',
      rowPageId: 'row-1',
      propertyId: 'prop-1',
      value: '42',
      baseVersion: 7,
    });
    expect(op.baseVersion).toBe(7);
  });
});
