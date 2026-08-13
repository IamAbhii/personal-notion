// Tests for Phase 3: databases, properties, rows and property values. Covers every new op type,
// every rejection reason, the kind/parent rules, cascades, snapshot keys, ETag changes and the seed.
import { describe, expect, it } from 'vitest';
import { listBlocks } from '../src/repo/blocks';
import { listPages } from '../src/repo/pages';
import { listProperties } from '../src/repo/properties';
import { listValues } from '../src/repo/propertyValues';
import { seedWorkspace } from '../src/seed/seedWorkspace';
import { SEED_DATABASES } from '../src/seed/template';
import {
  MAX_OPTION_NAME_LENGTH,
  MAX_PROPERTIES_PER_DATABASE,
  MAX_PROPERTY_NAME_LENGTH,
  MAX_VALUE_LENGTH,
  OPTION_COLORS,
  PROPERTY_TYPES,
} from '../src/sync/ops';
import { apiFetch, createAccount, makeOp, type TestAccount } from './helpers';

type SyncResponse = {
  results: { opId: string; status: string; reason?: string; entityId?: string; version?: number }[];
  versionMismatches: {
    opId: string;
    entityId: string;
    baseVersion: number;
    serverVersion: number;
  }[];
  etag: string;
};

type SnapshotResponse = {
  pages: { id: string; kind: string; parentId: string | null; title: string }[];
  blocks: { id: string; pageId: string }[];
  properties: {
    id: string;
    databasePageId: string;
    name: string;
    type: string;
    options: { id: string; name: string; color: string }[];
    sortKey: string;
    version: number;
    updatedAt: number;
  }[];
  values: {
    rowPageId: string;
    propertyId: string;
    value: string | null;
    version: number;
    updatedAt: number;
  }[];
};

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

// Creates a property and returns its id.
async function createProperty(
  account: TestAccount,
  databasePageId: string,
  options: { name?: string; type?: string; propOptions?: unknown[]; sortKey?: string } = {},
): Promise<string> {
  const propId = crypto.randomUUID();
  await syncBody(account, [
    makeOp(account.workspaceId, 'property.create', propId, {
      databasePageId,
      name: options.name ?? 'Title',
      type: options.type ?? 'text',
      ...(options.propOptions ? { options: options.propOptions } : {}),
      ...(options.sortKey ? { sortKey: options.sortKey } : {}),
    }),
  ]);
  return propId;
}

// Creates a row page under a database and returns its id.
async function createRow(
  account: TestAccount,
  databasePageId: string,
  title = 'Row',
): Promise<string> {
  const rowId = crypto.randomUUID();
  await syncBody(account, [
    makeOp(account.workspaceId, 'page.create', rowId, {
      parentId: databasePageId,
      title,
      kind: 'row',
    }),
  ]);
  return rowId;
}

// ── page.create with kind ────────────────────────────────────────────────────

describe('page.create with kind', () => {
  it('creates a database page (kind=database)', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const pages = await listPages(owner.db, owner.ctx);
    const dbPage = pages.find((p) => p.id === dbId);
    expect(dbPage?.kind).toBe('database');
  });

  it('creates a row page (kind=row) under a database', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const rowId = await createRow(owner, dbId, 'First row');
    const pages = await listPages(owner.db, owner.ctx);
    const rowPage = pages.find((p) => p.id === rowId);
    expect(rowPage?.kind).toBe('row');
    expect(rowPage?.parentId).toBe(dbId);
  });

  it('defaults kind to page when omitted', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Plain' })]);
    const pages = await listPages(owner.db, owner.ctx);
    expect(pages.find((p) => p.id === pageId)?.kind).toBe('page');
  });

  it('rejects a row page with no parent', async () => {
    const owner = await createAccount();
    const rowId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.create', rowId, { kind: 'row' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/row page must have a database/);
  });

  it('rejects a row page parented to a plain page', async () => {
    const owner = await createAccount();
    const parentId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.create', parentId, { title: 'Plain parent' }),
    ]);
    const rowId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.create', rowId, { parentId, kind: 'row' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/row page must have a database/);
  });

  it('rejects a page or database parented to a database page', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    for (const kind of ['page', 'database'] as const) {
      const childId = crypto.randomUUID();
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'page.create', childId, { parentId: dbId, kind }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/cannot be parented to a database or row/);
    }
  });

  it('rejects a page or database parented to a row page', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const rowId = await createRow(owner, dbId);
    for (const kind of ['page', 'database'] as const) {
      const childId = crypto.randomUUID();
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'page.create', childId, { parentId: rowId, kind }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/cannot be parented to a database or row/);
    }
  });
});

// ── page.update kind rejection ───────────────────────────────────────────────

describe('page.update with kind field', () => {
  it('rejects an update carrying kind', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'page.update', dbId, { kind: 'page' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/cannot change kind/);
  });
});

// ── property.create ──────────────────────────────────────────────────────────

describe('property.create', () => {
  it('creates a property on a database page and appends it', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Status', type: 'select' });
    const props = await listProperties(owner.db, owner.ctx);
    const prop = props.find((p) => p.id === propId);
    expect(prop?.name).toBe('Status');
    expect(prop?.type).toBe('select');
    expect(prop?.databasePageId).toBe(dbId);
    expect(prop?.version).toBe(1);
  });

  it('stores select options as a JSON array', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const options = [
      { id: crypto.randomUUID(), name: 'Active', color: 'blue' },
      { id: crypto.randomUUID(), name: 'Done', color: 'teal' },
    ];
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options,
      }),
    ]);
    const props = await listProperties(owner.db, owner.ctx);
    const prop = props.find((p) => p.id === propId)!;
    const stored = JSON.parse(prop.options!) as typeof options;
    expect(stored).toHaveLength(2);
    expect(stored[0]?.name).toBe('Active');
    expect(stored[1]?.color).toBe('teal');
  });

  it('rejects a property.create for a non-database page', async () => {
    const owner = await createAccount();
    const pageId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', pageId, { title: 'Plain' })]);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: pageId,
        name: 'P',
        type: 'text',
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/not a database page/);
  });

  it('rejects an unknown property type', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'P',
        type: 'image',
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/unknown property type/);
  });

  it('rejects an over-length name', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'x'.repeat(MAX_PROPERTY_NAME_LENGTH + 1),
        type: 'text',
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/name must be at most/);
  });

  it('rejects an unknown option color', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options: [{ id: 'o1', name: 'Active', color: 'hotpink' }],
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/unknown option color/);
  });

  it('rejects duplicate option ids', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options: [
          { id: 'dup', name: 'A', color: 'blue' },
          { id: 'dup', name: 'B', color: 'teal' },
        ],
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/duplicate option id/);
  });

  it('rejects an over-long option name', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options: [{ id: 'o1', name: 'x'.repeat(MAX_OPTION_NAME_LENGTH + 1), color: 'blue' }],
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/option name must be at most/);
  });

  it(`rejects creating more than ${MAX_PROPERTIES_PER_DATABASE} properties on one database`, async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);

    // Create the maximum allowed.
    for (let i = 0; i < MAX_PROPERTIES_PER_DATABASE; i++) {
      const id = crypto.randomUUID();
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'property.create', id, {
          databasePageId: dbId,
          name: `Prop ${i}`,
          type: 'text',
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    }

    // One more should be rejected.
    const extraId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', extraId, {
        databasePageId: dbId,
        name: 'Too many',
        type: 'text',
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/limit/);
  });

  it('appends properties in clientSeq order when sortKey is omitted', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', ids[0]!, {
        databasePageId: dbId,
        name: 'A',
        type: 'text',
      }),
      makeOp(owner.workspaceId, 'property.create', ids[1]!, {
        databasePageId: dbId,
        name: 'B',
        type: 'number',
      }),
      makeOp(owner.workspaceId, 'property.create', ids[2]!, {
        databasePageId: dbId,
        name: 'C',
        type: 'checkbox',
      }),
    ]);
    const props = await listProperties(owner.db, owner.ctx);
    const dbProps = props.filter((p) => p.databasePageId === dbId);
    expect(dbProps.map((p) => p.id)).toEqual(ids);
  });
});

// ── property.update ──────────────────────────────────────────────────────────

describe('property.update', () => {
  it('renames a property and bumps its version', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Old name', type: 'text' });
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.update', propId, { name: 'New name' }),
    ]);
    const props = await listProperties(owner.db, owner.ctx);
    const prop = props.find((p) => p.id === propId)!;
    expect(prop.name).toBe('New name');
    expect(prop.version).toBe(2);
  });

  it('updates options on a select property', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const optId = crypto.randomUUID();
    const propId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options: [{ id: optId, name: 'Draft', color: 'gray' }],
      }),
    ]);
    const newOptId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.update', propId, {
        options: [
          { id: optId, name: 'Draft', color: 'gray' },
          { id: newOptId, name: 'Published', color: 'teal' },
        ],
      }),
    ]);
    const props = await listProperties(owner.db, owner.ctx);
    const stored = JSON.parse(props.find((p) => p.id === propId)!.options!) as unknown[];
    expect(stored).toHaveLength(2);
  });

  it('rejects a type change', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'P', type: 'text' });
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.update', propId, { type: 'number' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/type cannot be changed/);
  });

  it('rejects updating a property that no longer exists', async () => {
    const owner = await createAccount();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.update', crypto.randomUUID(), { name: 'Ghost' }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });
});

// ── property.delete ──────────────────────────────────────────────────────────

describe('property.delete', () => {
  it('deletes a property and all its values in one batch', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    // Set a value.
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('Some notes'),
      }),
    ]);
    expect(await listValues(owner.db, owner.ctx)).toHaveLength(1);

    await syncBody(owner, [makeOp(owner.workspaceId, 'property.delete', propId)]);
    expect(await listProperties(owner.db, owner.ctx)).toHaveLength(0);
    expect(await listValues(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('rejects deleting a property that no longer exists', async () => {
    const owner = await createAccount();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.delete', crypto.randomUUID()),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });
});

// ── value.set ────────────────────────────────────────────────────────────────

describe('value.set', () => {
  it('sets and then updates a value (upsert converges, not duplicates)', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    const entityId = `${rowId}:${propId}`;

    const first = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', entityId, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('Hello'),
      }),
    ]);
    expect(first.results[0]).toMatchObject({ status: 'applied', version: 1 });

    const second = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', entityId, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('Hello updated'),
      }),
    ]);
    expect(second.results[0]).toMatchObject({ status: 'applied', version: 2 });

    // Only one value row exists, not two.
    const values = await listValues(owner.db, owner.ctx);
    expect(values).toHaveLength(1);
    expect(values[0]?.value).toBe(JSON.stringify('Hello updated'));
  });

  it('clears a value when value is null', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    const entityId = `${rowId}:${propId}`;

    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', entityId, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('Initial'),
      }),
    ]);
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', entityId, {
        rowPageId: rowId,
        propertyId: propId,
        value: null,
      }),
    ]);
    const values = await listValues(owner.db, owner.ctx);
    expect(values[0]?.value).toBeNull();
  });

  it('rejects value.set for a non-row page', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const plainId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', plainId, { title: 'Plain' })]);
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${plainId}:${propId}`, {
        rowPageId: plainId,
        propertyId: propId,
        value: JSON.stringify('x'),
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/not a row page/);
  });

  it('rejects value.set for a non-existent property', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const rowId = await createRow(owner, dbId);
    const fakeId = crypto.randomUUID();
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${fakeId}`, {
        rowPageId: rowId,
        propertyId: fakeId,
        value: JSON.stringify('x'),
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/no longer exists/);
  });

  it('rejects value.set when propertyId belongs to a different database', async () => {
    const owner = await createAccount();
    const db1 = await createDatabase(owner, 'DB 1');
    const db2 = await createDatabase(owner, 'DB 2');
    const propId = await createProperty(owner, db1, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, db2);
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('x'),
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/does not belong/);
  });

  it('rejects an over-length value JSON string', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    const body = await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: 'x'.repeat(MAX_VALUE_LENGTH + 1),
      }),
    ]);
    expect(body.results[0]?.status).toBe('rejected');
    expect(body.results[0]?.reason).toMatch(/value must be at most/);
  });

  describe('per-type value validation', () => {
    it('accepts a valid text value', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('hello'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a text value that is not a string', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify(42),
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/type text must be a string/);
    });

    it('accepts a valid number value', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Score', type: 'number' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify(42.5),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a non-finite number value', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Score', type: 'number' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: 'null',
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
    });

    it('accepts a valid date value (YYYY-MM-DD)', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Due', type: 'date' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('2026-09-01'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a date that is not YYYY-MM-DD', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Due', type: 'date' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('09/01/2026'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/YYYY-MM-DD/);
    });

    it('accepts a boolean checkbox value', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Done', type: 'checkbox' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify(true),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a checkbox value that is not a boolean', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Done', type: 'checkbox' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('yes'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/checkbox must be a boolean/);
    });

    it('accepts a valid url value (stored as typed, no shape validation)', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Link', type: 'url' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('example.com'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('accepts a select value with a valid option id', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const optId = crypto.randomUUID();
      const propId = crypto.randomUUID();
      await syncBody(owner, [
        makeOp(owner.workspaceId, 'property.create', propId, {
          databasePageId: dbId,
          name: 'Status',
          type: 'select',
          options: [{ id: optId, name: 'Active', color: 'blue' }],
        }),
      ]);
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify(optId),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a select value referencing an unknown option id', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = crypto.randomUUID();
      await syncBody(owner, [
        makeOp(owner.workspaceId, 'property.create', propId, {
          databasePageId: dbId,
          name: 'Status',
          type: 'select',
          options: [{ id: 'opt1', name: 'Active', color: 'blue' }],
        }),
      ]);
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify('unknown-id'),
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/unknown option id/);
    });

    it('accepts a multiSelect value with valid option ids', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const opt1 = crypto.randomUUID();
      const opt2 = crypto.randomUUID();
      const propId = crypto.randomUUID();
      await syncBody(owner, [
        makeOp(owner.workspaceId, 'property.create', propId, {
          databasePageId: dbId,
          name: 'Tags',
          type: 'multiSelect',
          options: [
            { id: opt1, name: 'A', color: 'blue' },
            { id: opt2, name: 'B', color: 'teal' },
          ],
        }),
      ]);
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify([opt1, opt2]),
        }),
      ]);
      expect(body.results[0]?.status).toBe('applied');
    });

    it('rejects a multiSelect value referencing an unknown option id', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = crypto.randomUUID();
      await syncBody(owner, [
        makeOp(owner.workspaceId, 'property.create', propId, {
          databasePageId: dbId,
          name: 'Tags',
          type: 'multiSelect',
          options: [{ id: 'opt1', name: 'A', color: 'blue' }],
        }),
      ]);
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: JSON.stringify(['opt1', 'bad-id']),
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/unknown option id/);
    });

    it('rejects a value that is not valid JSON', async () => {
      const owner = await createAccount();
      const dbId = await createDatabase(owner);
      const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
      const rowId = await createRow(owner, dbId);
      const body = await syncBody(owner, [
        makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
          rowPageId: rowId,
          propertyId: propId,
          value: '{not-json',
        }),
      ]);
      expect(body.results[0]?.status).toBe('rejected');
      expect(body.results[0]?.reason).toMatch(/not valid JSON/);
    });
  });
});

// ── cascade ───────────────────────────────────────────────────────────────────

describe('page.delete cascade', () => {
  it('deleting a database removes its rows, blocks, properties and values', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId, 'Row 1');

    // Add a block to the row page.
    const blockId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', blockId, {
        pageId: rowId,
        type: 'paragraph',
        text: 'Row content',
      }),
    ]);
    // Set a value.
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('Some notes'),
      }),
    ]);

    // Delete the database.
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', dbId)]);

    expect(await listPages(owner.db, owner.ctx)).toHaveLength(0);
    expect(await listBlocks(owner.db, owner.ctx)).toHaveLength(0);
    expect(await listProperties(owner.db, owner.ctx)).toHaveLength(0);
    expect(await listValues(owner.db, owner.ctx)).toHaveLength(0);
  });

  it('deleting a row removes its blocks and values but leaves the database and properties', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId, 'Row 1');

    // Add block and value.
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'block.create', crypto.randomUUID(), {
        pageId: rowId,
        type: 'paragraph',
        text: 'Row content',
      }),
    ]);
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('notes'),
      }),
    ]);

    // Delete only the row.
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.delete', rowId)]);

    const pages = await listPages(owner.db, owner.ctx);
    // Database page remains.
    expect(pages.map((p) => p.id)).toContain(dbId);
    expect(pages.map((p) => p.id)).not.toContain(rowId);
    // Property remains.
    expect(await listProperties(owner.db, owner.ctx)).toHaveLength(1);
    // Blocks and values are gone.
    expect(await listBlocks(owner.db, owner.ctx)).toHaveLength(0);
    expect(await listValues(owner.db, owner.ctx)).toHaveLength(0);
  });
});

// ── snapshot ──────────────────────────────────────────────────────────────────

describe('snapshot with databases', () => {
  it('returns kind on every page', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const rowId = await createRow(owner, dbId, 'Row 1');
    const plainId = crypto.randomUUID();
    await syncBody(owner, [makeOp(owner.workspaceId, 'page.create', plainId, { title: 'Plain' })]);

    const { body } = await snapshot(owner);
    const byId = new Map(body.pages.map((p) => [p.id, p]));
    expect(byId.get(dbId)?.kind).toBe('database');
    expect(byId.get(rowId)?.kind).toBe('row');
    expect(byId.get(plainId)?.kind).toBe('page');
  });

  it('returns properties with parsed options array', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const optId = crypto.randomUUID();
    const propId = crypto.randomUUID();
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'property.create', propId, {
        databasePageId: dbId,
        name: 'Status',
        type: 'select',
        options: [{ id: optId, name: 'Active', color: 'blue' }],
      }),
    ]);

    const { body } = await snapshot(owner);
    expect(body.properties).toHaveLength(1);
    const prop = body.properties[0]!;
    expect(prop.id).toBe(propId);
    expect(prop.databasePageId).toBe(dbId);
    expect(prop.type).toBe('select');
    expect(Array.isArray(prop.options)).toBe(true);
    expect(prop.options[0]?.name).toBe('Active');
    expect(prop.options[0]?.color).toBe('blue');
  });

  it('returns values with the raw JSON value string', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner, 'Projects');
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('hello'),
      }),
    ]);

    const { body } = await snapshot(owner);
    expect(body.values).toHaveLength(1);
    expect(body.values[0]?.rowPageId).toBe(rowId);
    expect(body.values[0]?.propertyId).toBe(propId);
    // Value is the raw JSON string, not the parsed value.
    expect(body.values[0]?.value).toBe(JSON.stringify('hello'));
  });

  it('ETag starts with p3-', async () => {
    const owner = await createAccount();
    const { etag } = await snapshot(owner);
    expect(etag).toMatch(/^"p3-/);
  });

  it('ETag changes when a property is created', async () => {
    const owner = await createAccount();
    const { etag: before } = await snapshot(owner);
    const dbId = await createDatabase(owner);
    await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const { etag: after } = await snapshot(owner);
    expect(after).not.toBe(before);
  });

  it('ETag changes when a value is set', async () => {
    const owner = await createAccount();
    const dbId = await createDatabase(owner);
    const propId = await createProperty(owner, dbId, { name: 'Notes', type: 'text' });
    const rowId = await createRow(owner, dbId);
    const { etag: before } = await snapshot(owner);

    await syncBody(owner, [
      makeOp(owner.workspaceId, 'value.set', `${rowId}:${propId}`, {
        rowPageId: rowId,
        propertyId: propId,
        value: JSON.stringify('first'),
      }),
    ]);
    const { etag: after } = await snapshot(owner);
    expect(after).not.toBe(before);
  });
});

// ── seed ──────────────────────────────────────────────────────────────────────

describe('seedWorkspace with databases', () => {
  it('seeds the two databases with pages of kind=database and kind=row', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);
    const databases = pages.filter((p) => p.kind === 'database');
    const rows = pages.filter((p) => p.kind === 'row');
    expect(databases).toHaveLength(SEED_DATABASES.length);
    expect(rows.length).toBeGreaterThan(0);
    // Every row page has a database page as its parent.
    const dbIds = new Set(databases.map((p) => p.id));
    expect(rows.every((row) => row.parentId !== null && dbIds.has(row.parentId))).toBe(true);
  });

  it('seeds properties for each database, covering all seven property types', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);
    const types = new Set(props.map((p) => p.type));
    // All seven types must appear across the two databases.
    for (const t of PROPERTY_TYPES) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('seeds all six option colors across select/multiSelect properties', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);
    const colors = new Set<string>();
    for (const prop of props) {
      if (!prop.options) continue;
      const opts = JSON.parse(prop.options) as Array<{ color: string }>;
      for (const o of opts) colors.add(o.color);
    }
    for (const c of OPTION_COLORS) {
      expect(colors.has(c)).toBe(true);
    }
  });

  it('seeds values for rows, with select values referencing real option ids', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const values = await listValues(owner.db, owner.ctx);
    expect(values.length).toBeGreaterThan(0);
    // Every value references an existing row page.
    const pages = await listPages(owner.db, owner.ctx);
    const rowPageIds = new Set(pages.filter((p) => p.kind === 'row').map((p) => p.id));
    expect(values.every((v) => rowPageIds.has(v.rowPageId))).toBe(true);
    // Every value references an existing property.
    const props = await listProperties(owner.db, owner.ctx);
    const propIds = new Set(props.map((p) => p.id));
    expect(values.every((v) => propIds.has(v.propertyId))).toBe(true);
    // Select values reference real option ids.
    const propById = new Map(props.map((p) => [p.id, p]));
    for (const v of values) {
      const prop = propById.get(v.propertyId);
      if (!prop || !v.value) continue;
      if (prop.type !== 'select' && prop.type !== 'multiSelect') continue;
      const options = JSON.parse(prop.options ?? '[]') as Array<{ id: string }>;
      const optionIds = new Set(options.map((o) => o.id));
      const val = JSON.parse(v.value) as unknown;
      if (prop.type === 'select') {
        expect(optionIds.has(val as string)).toBe(true);
      } else {
        expect((val as string[]).every((id) => optionIds.has(id))).toBe(true);
      }
    }
  });

  it('seeds row pages with blocks on at least one row', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);
    const rowPageIds = new Set(pages.filter((p) => p.kind === 'row').map((p) => p.id));
    const blocks = await listBlocks(owner.db, owner.ctx);
    const rowBlocks = blocks.filter((b) => rowPageIds.has(b.pageId));
    expect(rowBlocks.length).toBeGreaterThan(0);
  });

  it('is idempotent: a second call creates nothing', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const firstPages = await listPages(owner.db, owner.ctx);
    const firstProps = await listProperties(owner.db, owner.ctx);
    const firstValues = await listValues(owner.db, owner.ctx);

    const secondResult = await seedWorkspace(owner.db, owner.ctx);
    expect(secondResult).toBe(0);
    expect(await listPages(owner.db, owner.ctx)).toHaveLength(firstPages.length);
    expect(await listProperties(owner.db, owner.ctx)).toHaveLength(firstProps.length);
    expect(await listValues(owner.db, owner.ctx)).toHaveLength(firstValues.length);
  });

  it('applies to two workspaces independently with fresh ids', async () => {
    const mine = await createAccount();
    const theirs = await createAccount({ email: 'other@example.com' });
    await seedWorkspace(mine.db, mine.ctx);
    await seedWorkspace(theirs.db, theirs.ctx);

    const myProps = await listProperties(mine.db, mine.ctx);
    const theirProps = await listProperties(theirs.db, theirs.ctx);
    expect(myProps).toHaveLength(theirProps.length);
    // No id collision.
    const overlap = myProps.filter((p) => theirProps.some((q) => q.id === p.id));
    expect(overlap).toHaveLength(0);
  });
});
