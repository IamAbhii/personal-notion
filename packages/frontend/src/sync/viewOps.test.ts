import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildViewCreateOp, buildViewDeleteOp, buildViewUpdateOp } from './viewOps';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('buildViewCreateOp', () => {
  it('builds a view.create op with the required fields', () => {
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'Table',
      kind: 'table',
    });

    expect(op).toMatchObject({
      workspaceId: 'ws-1',
      entity: 'view',
      entityId: 'v-1',
      type: 'view.create',
      baseVersion: 0,
      payload: {
        databasePageId: 'db-1',
        name: 'Table',
        kind: 'table',
      },
    });
    expect(op.opId).toMatch(UUID);
    expect(Number.isInteger(op.createdAt)).toBe(true);
  });

  it('omits optional payload fields when not provided', () => {
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'Board',
      kind: 'board',
    });

    expect('groupPropertyId' in op.payload).toBe(false);
    expect('filters' in op.payload).toBe(false);
    expect('sort' in op.payload).toBe(false);
    expect('sortKey' in op.payload).toBe(false);
  });

  it('includes groupPropertyId when provided', () => {
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'Board',
      kind: 'board',
      groupPropertyId: 'prop-status',
    });

    expect(op.payload.groupPropertyId).toBe('prop-status');
  });

  it('includes null groupPropertyId when explicitly null', () => {
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'Board',
      kind: 'board',
      groupPropertyId: null,
    });

    expect(op.payload.groupPropertyId).toBeNull();
  });

  it('includes filters and sort when provided', () => {
    const filters = [{ id: 'f1', propertyId: 'p1', operator: 'contains' as const, value: 'x' }];
    const sort = { propertyId: 'p1', direction: 'asc' as const };
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'Table',
      kind: 'table',
      filters,
      sort,
      sortKey: 'a0',
    });

    expect(op.payload.filters).toEqual(filters);
    expect(op.payload.sort).toEqual(sort);
    expect(op.payload.sortKey).toBe('a0');
  });

  it('sets baseVersion to 0 because a new view has no prior version', () => {
    const op = buildViewCreateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      databasePageId: 'db-1',
      name: 'List',
      kind: 'list',
    });
    expect(op.baseVersion).toBe(0);
  });
});

describe('buildViewUpdateOp', () => {
  it('builds a view.update op carrying the change payload', () => {
    const op = buildViewUpdateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      baseVersion: 3,
      changes: { name: 'Renamed Table' },
    });

    expect(op).toMatchObject({
      workspaceId: 'ws-1',
      entity: 'view',
      entityId: 'v-1',
      type: 'view.update',
      baseVersion: 3,
      payload: { name: 'Renamed Table' },
    });
    expect(op.opId).toMatch(UUID);
  });

  it('carries the baseVersion from the caller so conflicts are detectable', () => {
    const op = buildViewUpdateOp({
      workspaceId: 'ws-1',
      viewId: 'v-2',
      baseVersion: 7,
      changes: { sort: { propertyId: 'p1', direction: 'desc' } },
    });
    expect(op.baseVersion).toBe(7);
  });

  it('passes through filter changes intact', () => {
    const filters = [
      { id: 'f1', propertyId: 'p1', operator: 'is' as const, value: 'opt-1' },
      { id: 'f2', propertyId: 'p2', operator: 'isChecked' as const, value: null },
    ];
    const op = buildViewUpdateOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      baseVersion: 1,
      changes: { filters },
    });
    expect(op.payload.filters).toEqual(filters);
  });
});

describe('buildViewDeleteOp', () => {
  it('builds a view.delete op with an empty payload', () => {
    const op = buildViewDeleteOp({
      workspaceId: 'ws-1',
      viewId: 'v-1',
      baseVersion: 2,
    });

    expect(op).toMatchObject({
      workspaceId: 'ws-1',
      entity: 'view',
      entityId: 'v-1',
      type: 'view.delete',
      baseVersion: 2,
      payload: {},
    });
    expect(op.opId).toMatch(UUID);
  });

  it('uses the provided baseVersion so the server can detect conflicts', () => {
    const op = buildViewDeleteOp({
      workspaceId: 'ws-1',
      viewId: 'v-5',
      baseVersion: 12,
    });
    expect(op.baseVersion).toBe(12);
  });
});
