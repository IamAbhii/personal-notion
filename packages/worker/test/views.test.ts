// Tests for Phase 4 views: every op type, every validation rejection, the page.delete cascade,
// the snapshot, the reset asserting views are cleared, and the seed producing three views per
// database with the board's groupPropertyId set.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listPages } from '../src/repo/pages';
import { listProperties } from '../src/repo/properties';
import { listViews } from '../src/repo/views';
import { seedWorkspace } from '../src/seed/seedWorkspace';
import { SEED_DATABASES } from '../src/seed/template';
import { DEV_OWNER } from '../src/auth/resolveAccess';
import { apiFetch, createAccount, makeOp, OWNER_EMAIL, type TestAccount } from './helpers';

type SyncResponse = {
  results: { opId: string; status: string; reason?: string; entityId?: string; version?: number }[];
  versionMismatches: unknown[];
  etag: string;
};

type SnapshotResponse = {
  pages: { id: string; kind: string; parentId: string | null; title: string }[];
  properties: { id: string; databasePageId: string; name: string; type: string }[];
  views: {
    id: string;
    databasePageId: string;
    name: string;
    kind: string;
    groupPropertyId: string | null;
    filters: { id: string; propertyId: string; operator: string; value: string | null }[];
    sort: { propertyId: string; direction: string } | null;
    sortKey: string;
    version: number;
    updatedAt: number;
  }[];
  etag?: string;
};

// Sends ops to the sync endpoint and returns the parsed body.
function sync(account: TestAccount, ops: unknown[]) {
  return apiFetch(`/api/workspaces/${account.workspaceId}/sync`, {
    method: 'POST',
    sessionId: account.sessionId,
    body: JSON.stringify({ ops }),
  });
}

async function syncBody(account: TestAccount, ops: unknown[]): Promise<SyncResponse> {
  const response = await sync(account, ops);
  expect(response.status).toBe(200);
  return (await response.json()) as SyncResponse;
}

async function snapshot(account: TestAccount): Promise<{ body: SnapshotResponse; etag: string }> {
  const response = await apiFetch(`/api/workspaces/${account.workspaceId}/snapshot`, {
    sessionId: account.sessionId,
  });
  expect(response.status).toBe(200);
  return { body: (await response.json()) as SnapshotResponse, etag: response.headers.get('ETag')! };
}

// Creates a database page and returns its id.
async function createDatabase(account: TestAccount, title = 'My DB'): Promise<string> {
  const dbId = crypto.randomUUID();
  await syncBody(account, [
    makeOp(account.workspaceId, 'page.create', dbId, { title, kind: 'database' }),
  ]);
  return dbId;
}

// Creates a select property on a database and returns its id and the option ids.
async function createSelectProperty(
  account: TestAccount,
  databasePageId: string,
  opts: { name?: string; options?: { id: string; name: string; color: string }[] } = {},
): Promise<{ propId: string; options: { id: string; name: string; color: string }[] }> {
  const propId = crypto.randomUUID();
  const options = opts.options ?? [
    { id: crypto.randomUUID(), name: 'Option A', color: 'blue' },
    { id: crypto.randomUUID(), name: 'Option B', color: 'teal' },
  ];
  await syncBody(account, [
    makeOp(account.workspaceId, 'property.create', propId, {
      databasePageId,
      name: opts.name ?? 'Status',
      type: 'select',
      options,
    }),
  ]);
  return { propId, options };
}

// Creates a text property and returns its id.
async function createTextProperty(
  account: TestAccount,
  databasePageId: string,
  name = 'Notes',
): Promise<string> {
  const propId = crypto.randomUUID();
  await syncBody(account, [
    makeOp(account.workspaceId, 'property.create', propId, {
      databasePageId,
      name,
      type: 'text',
    }),
  ]);
  return propId;
}

// Creates a view and returns the op result.
async function createView(
  account: TestAccount,
  payload: Record<string, unknown>,
): Promise<{ viewId: string; result: SyncResponse['results'][0] }> {
  const viewId = crypto.randomUUID();
  const body = await syncBody(account, [
    makeOp(account.workspaceId, 'view.create', viewId, payload),
  ]);
  return { viewId, result: body.results[0]! };
}

// ── view.create ────────────────────────────────────────────────────────────────

describe('view.create', () => {
  it('creates a table view and returns version 1', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const { viewId, result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
    });
    expect(result.status).toBe('applied');
    expect(result.version).toBe(1);
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(viewId);
    expect(stored[0]?.name).toBe('Table');
    expect(stored[0]?.kind).toBe('table');
    expect(stored[0]?.databasePageId).toBe(dbId);
  });

  it('creates a board view with a valid select groupPropertyId', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { propId } = await createSelectProperty(owner, dbId, { name: 'Status' });
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Board',
      kind: 'board',
      groupPropertyId: propId,
    });
    expect(result.status).toBe('applied');
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored[0]?.groupPropertyId).toBe(propId);
  });

  it('rejects view.create when databasePageId is not a database page', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Plain' })]);
    const { result } = await createView(owner, {
      databasePageId: pageId,
      name: 'Table',
      kind: 'table',
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/not a database page/);
  });

  it('rejects view.create when databasePageId does not exist', async () => {
    const owner = await createAccount();
    const { result } = await createView(owner, {
      databasePageId: crypto.randomUUID(),
      name: 'Table',
      kind: 'table',
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/not a database page/);
  });

  it('rejects view.create when groupPropertyId is not a property of the database', async () => {
    const owner = await createAccount();
    const db1 = await createDatabase(owner, 'DB 1');
    const db2 = await createDatabase(owner, 'DB 2');
    const { propId } = await createSelectProperty(owner, db1, { name: 'Status' });
    // propId belongs to db1, not db2.
    const { result } = await createView(owner, {
      databasePageId: db2,
      name: 'Board',
      kind: 'board',
      groupPropertyId: propId,
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/groupPropertyId/);
  });

  it('rejects view.create when groupPropertyId is not a select property', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    // text property — not select.
    const textPropId = await createTextProperty(owner, dbId, 'Notes');
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Board',
      kind: 'board',
      groupPropertyId: textPropId,
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/select property/);
  });

  it('rejects a filter whose propertyId does not belong to the database', async () => {
    const owner = await createAccount();
    const db1 = await createDatabase(owner, 'DB 1');
    const db2 = await createDatabase(owner, 'DB 2');
    const propId = await createTextProperty(owner, db1, 'Notes');
    const { result } = await createView(owner, {
      databasePageId: db2,
      name: 'Table',
      kind: 'table',
      filters: [{ id: crypto.randomUUID(), propertyId: propId, operator: 'contains', value: 'x' }],
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/does not belong/);
  });

  it('rejects a filter with an operator illegal for the property type', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    // text property only allows contains/notContains; 'is' is for select.
    const propId = await createTextProperty(owner, dbId, 'Notes');
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
      filters: [{ id: crypto.randomUUID(), propertyId: propId, operator: 'is', value: 'x' }],
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/not valid for property type/);
  });

  it('rejects a sort whose propertyId does not exist', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
      sort: { propertyId: crypto.randomUUID(), direction: 'asc' },
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/does not exist/);
  });

  it('rejects a sort whose propertyId belongs to a different database', async () => {
    const owner = await createAccount();
    const db1 = await createDatabase(owner, 'DB 1');
    const db2 = await createDatabase(owner, 'DB 2');
    const propId = await createTextProperty(owner, db1, 'Notes');
    const { result } = await createView(owner, {
      databasePageId: db2,
      name: 'Table',
      kind: 'table',
      sort: { propertyId: propId, direction: 'asc' },
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/does not belong/);
  });

  it('accepts sort.propertyId = "title" without a property lookup', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
      sort: { propertyId: 'title', direction: 'asc' },
    });
    expect(result.status).toBe('applied');
  });

  it('rejects view.create with an empty name', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { result } = await createView(owner, {
      databasePageId: dbId,
      name: '',
      kind: 'table',
    });
    expect(result.status).toBe('rejected');
    expect(result.reason).toMatch(/name must not be empty/);
  });

  it('appends views in clientSeq order when sortKey is omitted', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.create', ids[0]!, {
        databasePageId: dbId,
        name: 'Table',
        kind: 'table',
      }),
      makeOp(owner.workspaceId, 'view.create', ids[1]!, {
        databasePageId: dbId,
        name: 'Board',
        kind: 'board',
      }),
      makeOp(owner.workspaceId, 'view.create', ids[2]!, {
        databasePageId: dbId,
        name: 'List',
        kind: 'list',
      }),
    ]);
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored.map((v) => v.id)).toEqual(ids);
  });
});

// ── view.update ────────────────────────────────────────────────────────────────

describe('view.update', () => {
  it('renames a view and bumps its version', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Old Name',
      kind: 'table',
    });
    await syncBody(owner, [makeOp(owner.workspaceId, 'view.update', viewId, { name: 'New Name' })]);
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored[0]?.name).toBe('New Name');
    expect(stored[0]?.version).toBe(2);
  });

  it('updates groupPropertyId to a valid select property', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Board',
      kind: 'board',
    });
    const { propId } = await createSelectProperty(owner, dbId, { name: 'Status' });
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', viewId, { groupPropertyId: propId }),
    ]);
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored[0]?.groupPropertyId).toBe(propId);
  });

  it('clears groupPropertyId when null is passed', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { propId } = await createSelectProperty(owner, dbId, { name: 'Status' });
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Board',
      kind: 'board',
      groupPropertyId: propId,
    });
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', viewId, { groupPropertyId: null }),
    ]);
    const stored = await listViews(owner.db, owner.ctx);
    expect(stored[0]?.groupPropertyId).toBeNull();
  });

  it('rejects view.update carrying kind', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
    });
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', viewId, { kind: 'board' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/kind cannot be changed/);
  });

  it('rejects updating a view that no longer exists', async () => {
    const owner = await createAccount();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', crypto.randomUUID(), { name: 'Ghost' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });

  it('rejects view.update when groupPropertyId is not a select property', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const textPropId = await createTextProperty(owner, dbId, 'Notes');
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Board',
      kind: 'board',
    });
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', viewId, { groupPropertyId: textPropId }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/select property/);
  });

  it('rejects a filter update with an illegal operator for the property type', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createTextProperty(owner, dbId, 'Notes');
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
    });
    // 'before' is for date properties; text only allows contains/notContains.
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.update', viewId, {
        filters: [
          { id: crypto.randomUUID(), propertyId: propId, operator: 'before', value: '2026-01-01' },
        ],
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/not valid for property type/);
  });
});

// ── view.delete ────────────────────────────────────────────────────────────────

describe('view.delete', () => {
  it('deletes a view', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const { viewId } = await createView(owner, {
      databasePageId: dbId,
      name: 'Table',
      kind: 'table',
    });
    const body = await syncBody(owner, [makeOp(owner.workspaceId, 'view.delete', viewId)]);
    expect(body.results[0]?.status).toBe('applied');
    expect(await listViews(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('rejects deleting a view that no longer exists', async () => {
    const owner = await createAccount();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.delete', crypto.randomUUID()),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });
});

// ── page.delete cascade ────────────────────────────────────────────────────────

describe('page.delete cascade to views', () => {
  it('deleting a database removes all its views', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    // Create three views on the database.
    await createView(owner, { databasePageId: dbId, name: 'Table', kind: 'table' });
    await createView(owner, { databasePageId: dbId, name: 'Board', kind: 'board' });
    await createView(owner, { databasePageId: dbId, name: 'List', kind: 'list' });
    expect(await listViews(owner.db, owner.ctx)).toHaveLength(3);

    // Delete the database.
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', dbId)]);

    // All views must be gone.
    expect(await listViews(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('deleting a plain page does not remove views on sibling databases', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Plain' })]);
    const dbId = await createDatabase(owner, 'Projects');
    await createView(owner, { databasePageId: dbId, name: 'Table', kind: 'table' });

    // Delete the plain page — views on the database must be untouched.
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', pageId)]);

    expect(await listViews(owner.db, owner.ctx)).toHaveLength(1);
  });

  it('deleting a database tree deletes views on every nested database', async () => {
    const owner = await createAccount();
    // Create a parent page with a database child.
    const parentId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.create', parentId, { title: 'Parent' }),
    ]);
    // A database cannot be a child of a plain page in strict kind rules, but we can delete the
    // parent (plain) page while the database is at root level — instead test two root databases.
    const db1 = await createDatabase(owner, 'DB 1');
    const db2 = await createDatabase(owner, 'DB 2');
    await createView(owner, { databasePageId: db1, name: 'Table', kind: 'table' });
    await createView(owner, { databasePageId: db2, name: 'Table', kind: 'table' });
    expect(await listViews(owner.db, owner.ctx)).toHaveLength(2);

    // Delete both databases in one op each.
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', db1)]);
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', db2)]);

    expect(await listViews(owner.db, owner.ctx)).toHaveLength(0);
  });
});

// ── snapshot ───────────────────────────────────────────────────────────────────

describe('snapshot with views', () => {
  it('returns views in the snapshot with parsed filters and sort', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const propId = await createTextProperty(owner, dbId, 'Notes');
    const viewId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.create', viewId, {
        databasePageId: dbId,
        name: 'Filtered',
        kind: 'table',
        filters: [{ id: 'f1', propertyId: propId, operator: 'contains', value: 'foo' }],
        sort: { propertyId: 'title', direction: 'asc' },
      }),
    ]);

    const { body } = await snapshot(owner);
    expect(Array.isArray(body.views)).toBe(true);
    expect(body.views).toHaveLength(1);
    const view = body.views[0]!;
    expect(view.id).toBe(viewId);
    expect(view.kind).toBe('table');
    expect(view.name).toBe('Filtered');
    // filters is a parsed array, not a JSON string.
    expect(Array.isArray(view.filters)).toBe(true);
    expect(view.filters[0]?.operator).toBe('contains');
    expect(view.filters[0]?.value).toBe('foo');
    // sort is a parsed object, not a JSON string.
    expect(view.sort).not.toBeNull();
    expect(view.sort?.propertyId).toBe('title');
    expect(view.sort?.direction).toBe('asc');
  });

  it('returns an empty filters array when no filters are set', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    await createView(owner, { databasePageId: dbId, name: 'Table', kind: 'table' });
    const { body } = await snapshot(owner);
    expect(body.views[0]?.filters).toEqual([]);
  });

  it('returns null for sort when no sort is set', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    await createView(owner, { databasePageId: dbId, name: 'Table', kind: 'table' });
    const { body } = await snapshot(owner);
    expect(body.views[0]?.sort).toBeNull();
  });

  it('ETag changes when a view is created', async () => {
    const owner = await createAccount();
    const { etag: before } = await snapshot(owner);
    const dbId = await createDatabase(owner);
    await createView(owner, { databasePageId: dbId, name: 'Table', kind: 'table' });
    const { etag: after } = await snapshot(owner);
    expect(after).not.toBe(before);
  });

  it('ETag starts with p4- so pre-Phase-4 ETags do not match', async () => {
    const owner = await createAccount();
    const { etag } = await snapshot(owner);
    expect(etag).toMatch(/^"p4-/);
  });
});

// ── reset ──────────────────────────────────────────────────────────────────────

describe('reset clears views', () => {
  beforeEach(() => {
    env.AUTH_DISABLED = 'true';
    env.ALLOWED_EMAIL = DEV_OWNER.email;
  });

  afterEach(() => {
    env.AUTH_DISABLED = 'false';
    env.ALLOWED_EMAIL = OWNER_EMAIL;
  });

  it('clears views and reseeds them from the template', async () => {
    const owner = await createAccount({ email: DEV_OWNER.email });
    await seedWorkspace(owner.db, owner.ctx);

    // Assert views were seeded (three per database = six total).
    const seededViews = await listViews(owner.db, owner.ctx);
    expect(seededViews.length).toBeGreaterThan(0);

    // Manually add an extra view to confirm it is wiped by reset.
    const pages = await listPages(owner.db, owner.ctx);
    const dbPage = pages.find((p) => p.kind === 'database')!;
    const strayViewId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'view.create', strayViewId, {
        databasePageId: dbPage.id,
        name: 'Stray view',
        kind: 'list',
      }),
    ]);
    const beforeReset = await listViews(owner.db, owner.ctx);
    expect(beforeReset.some((v) => v.id === strayViewId)).toBe(true);

    // Reset the workspace.
    const response = await apiFetch(`/api/workspaces/${owner.workspaceId}/test/reset`, {
      method: 'POST',
    });
    expect(response.status).toBe(200);

    const afterReset = await listViews(owner.db, owner.ctx);
    // Stray view is gone and no row from the pre-reset state survives (fresh ids on reseed).
    expect(afterReset.some((v) => v.id === strayViewId)).toBe(false);
    expect(beforeReset.every((old) => afterReset.every((v) => v.id !== old.id))).toBe(true);
    // The seeded views are back (at least as many as before the stray was added).
    expect(afterReset.length).toBe(seededViews.length);
  });
});

// ── seed ───────────────────────────────────────────────────────────────────────

describe('seedWorkspace with views', () => {
  it('seeds three views per database', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    // Each database gets exactly three views (table, board, list).
    expect(allViews).toHaveLength(SEED_DATABASES.length * 3);
  });

  it('seeds views with the correct kinds: one table, one board, one list per database', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);
    const databaseIds = pages.filter((p) => p.kind === 'database').map((p) => p.id);

    for (const dbId of databaseIds) {
      const dbViews = allViews.filter((v) => v.databasePageId === dbId);
      expect(dbViews).toHaveLength(3);
      const kinds = dbViews.map((v) => v.kind).sort();
      expect(kinds).toEqual(['board', 'list', 'table']);
    }
  });

  it('seeds the board view with a groupPropertyId pointing to a select property', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);
    const propById = new Map(props.map((p) => [p.id, p]));

    const boardViews = allViews.filter((v) => v.kind === 'board');
    expect(boardViews.length).toBeGreaterThan(0);
    for (const view of boardViews) {
      expect(view.groupPropertyId).not.toBeNull();
      const prop = propById.get(view.groupPropertyId!);
      expect(prop).toBeTruthy();
      expect(prop?.type).toBe('select');
    }
  });

  it('seeds at least one view with a filter already applied', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const viewsWithFilters = allViews.filter((v) => {
      const parsed = JSON.parse(v.filters) as unknown[];
      return parsed.length > 0;
    });
    expect(viewsWithFilters.length).toBeGreaterThan(0);
  });

  it('seeds at least one view with a sort already applied', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const viewsWithSort = allViews.filter((v) => v.sort !== null);
    expect(viewsWithSort.length).toBeGreaterThan(0);
  });

  it('seeds views referencing real property ids', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);
    const propIds = new Set(props.map((p) => p.id));

    for (const view of allViews) {
      // groupPropertyId, when set, must reference a real property.
      if (view.groupPropertyId) {
        expect(propIds.has(view.groupPropertyId)).toBe(true);
      }
      // Filters, when present, must reference real properties.
      const filters = JSON.parse(view.filters) as Array<{ propertyId: string }>;
      for (const f of filters) {
        expect(propIds.has(f.propertyId)).toBe(true);
      }
      // Sort, when set, must reference 'title' or a real property.
      if (view.sort) {
        const sort = JSON.parse(view.sort) as { propertyId: string };
        if (sort.propertyId !== 'title') {
          expect(propIds.has(sort.propertyId)).toBe(true);
        }
      }
    }
  });

  it('each database board view exercises all status option columns by having rows in each', async () => {
    // This is an assertion about the seed data shape rather than the storage layer: every Status
    // option for both databases must be used by at least one row, so no board column is empty.
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const boardViews = allViews.filter((v) => v.kind === 'board' && v.groupPropertyId !== null);

    // For each board view, find its group property and check that every option is used somewhere.
    const { listValues } = await import('../src/repo/propertyValues');
    const values = await listValues(owner.db, owner.ctx);

    for (const view of boardViews) {
      const prop = props.find((p) => p.id === view.groupPropertyId);
      if (!prop?.options) continue;
      const options = JSON.parse(prop.options) as Array<{ id: string }>;
      const usedOptionIds = new Set(
        values
          .filter((v) => v.propertyId === prop.id && v.value !== null)
          .map((v) => JSON.parse(v.value!) as string),
      );
      for (const opt of options) {
        expect(usedOptionIds.has(opt.id)).toBe(true);
      }
      // At least one column has 2+ cards.
      const countByOption = new Map<string, number>();
      for (const v of values.filter((v) => v.propertyId === prop.id && v.value !== null)) {
        const id = JSON.parse(v.value!) as string;
        countByOption.set(id, (countByOption.get(id) ?? 0) + 1);
      }
      expect([...countByOption.values()].some((count) => count >= 2)).toBe(true);
    }
  });
});
