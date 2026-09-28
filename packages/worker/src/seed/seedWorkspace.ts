// Applies the seed template to a workspace. Called on first sign-in (from GET /api/me) rather than
// at deploy time, so every new workspace - today's one and any future account's - gets a populated
// first run from the same code path.
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import {
  blocks,
  pages,
  properties,
  propertyValues,
  views,
  type BlockRow,
  type PageRow,
  type PropertyRow,
  type PropertyValueRow,
  type ViewRow,
} from '../db/schema';
import { newId } from '../lib/ids';
import type { Ctx } from '../repo/context';
import { countPages } from '../repo/pages';
import type { SelectOption } from '../sync/ops';
import { SEED_DATABASES, SEED_PAGES, type SeedDatabaseDef, type SeedPage } from './template';

// D1 allows at most 100 bound parameters per query and a page row binds 10 (now including kind),
// so multi-row inserts are chunked at 10 rows. Chunking is safe because every chunk goes into the
// same batch.
const ROWS_PER_INSERT = 10;
// A block row binds 11 parameters, so its chunks are smaller.
const BLOCK_ROWS_PER_INSERT = 9;
// A property row binds 10 parameters.
const PROPERTY_ROWS_PER_INSERT = 10;
// A property_values row binds 7 parameters.
const VALUE_ROWS_PER_INSERT = 14;
// A view row binds 12 parameters (id, workspace_id, database_page_id, name, kind, group_property_id,
// filters, sort, sort_key, version, created_at, updated_at), so max 8 rows per insert.
const VIEW_ROWS_PER_INSERT = 8;

// Flattens the page template into page rows and block rows, minting a fresh uuid for every row and a
// fractional sort_key per sibling group, so the tree renders in template order and each page's blocks
// read in the order the template lists them.
function buildPageRows(ctx: Ctx, now: number): { pageRows: PageRow[]; blockRows: BlockRow[] } {
  const pageRows: PageRow[] = [];
  const blockRows: BlockRow[] = [];

  const walk = (nodes: SeedPage[], parentId: string | null) => {
    let previousKey: string | null = null;
    for (const node of nodes) {
      const sortKey = generateKeyBetween(previousKey, null);
      previousKey = sortKey;
      const id = newId();
      pageRows.push({
        id,
        workspaceId: ctx.workspaceId,
        parentId,
        title: node.title,
        icon: node.icon,
        sortKey,
        kind: 'page',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      let previousBlockKey: string | null = null;
      for (const block of node.blocks ?? []) {
        const blockSortKey = generateKeyBetween(previousBlockKey, null);
        previousBlockKey = blockSortKey;
        blockRows.push({
          id: newId(),
          workspaceId: ctx.workspaceId,
          pageId: id,
          type: block.type,
          text: block.text ?? '',
          checked: block.checked ? 1 : 0,
          props: block.props ?? null,
          sortKey: blockSortKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (node.children) walk(node.children, id);
    }
  };

  walk(SEED_PAGES, null);
  return { pageRows, blockRows };
}

// Flattens the database template into page rows (databases and rows), block rows, property rows,
// value rows and view rows. Option ids are minted here so values can reference them. The
// lastPageKey parameter positions the database pages after all regular pages at the root level.
function buildDatabaseRows(
  ctx: Ctx,
  now: number,
  lastPageKey: string | null,
): {
  pageRows: PageRow[];
  blockRows: BlockRow[];
  propertyRows: PropertyRow[];
  valueRows: PropertyValueRow[];
  viewRows: ViewRow[];
} {
  const pageRows: PageRow[] = [];
  const blockRows: BlockRow[] = [];
  const propertyRows: PropertyRow[] = [];
  const valueRows: PropertyValueRow[] = [];
  const viewRows: ViewRow[] = [];

  let previousDbKey = lastPageKey;

  for (const db of SEED_DATABASES) {
    const dbSortKey = generateKeyBetween(previousDbKey, null);
    previousDbKey = dbSortKey;
    const dbPageId = newId();

    // The database page itself (kind = 'database').
    pageRows.push({
      id: dbPageId,
      workspaceId: ctx.workspaceId,
      parentId: null,
      title: db.title,
      icon: db.icon,
      sortKey: dbSortKey,
      kind: 'database',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Mint property ids and option ids upfront so rows can reference them.
    const propertyIdByName = new Map<string, string>();
    // Maps property name → { optionId by option name }
    const optionIdByName = new Map<string, Map<string, string>>();

    let previousPropKey: string | null = null;
    for (const propDef of db.properties) {
      const propId = newId();
      propertyIdByName.set(propDef.name, propId);
      previousPropKey = generateKeyBetween(previousPropKey, null);

      const optionMap = new Map<string, string>();
      const options: SelectOption[] = (propDef.options ?? []).map((opt) => {
        const optId = newId();
        optionMap.set(opt.name, optId);
        return { id: optId, name: opt.name, color: opt.color };
      });
      optionIdByName.set(propDef.name, optionMap);

      propertyRows.push({
        id: propId,
        workspaceId: ctx.workspaceId,
        databasePageId: dbPageId,
        name: propDef.name,
        type: propDef.type,
        options: options.length > 0 ? JSON.stringify(options) : null,
        sortKey: previousPropKey,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Rows (kind = 'row', parentId = dbPageId).
    let previousRowKey: string | null = null;
    for (const rowDef of db.rows) {
      const rowSortKey = generateKeyBetween(previousRowKey, null);
      previousRowKey = rowSortKey;
      const rowPageId = newId();

      pageRows.push({
        id: rowPageId,
        workspaceId: ctx.workspaceId,
        parentId: dbPageId,
        title: rowDef.title,
        icon: null,
        sortKey: rowSortKey,
        kind: 'row',
        version: 1,
        createdAt: now,
        updatedAt: now,
      });

      // Blocks on the row page.
      let previousBlockKey: string | null = null;
      for (const block of rowDef.blocks ?? []) {
        const blockSortKey = generateKeyBetween(previousBlockKey, null);
        previousBlockKey = blockSortKey;
        blockRows.push({
          id: newId(),
          workspaceId: ctx.workspaceId,
          pageId: rowPageId,
          type: block.type,
          text: block.text ?? '',
          checked: block.checked ? 1 : 0,
          props: block.props ?? null,
          sortKey: blockSortKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Property values for this row.
      for (const { propertyName, value } of rowDef.values ?? []) {
        const propId = propertyIdByName.get(propertyName);
        if (!propId) continue;

        const optionMap = optionIdByName.get(propertyName);
        // Encode the value as a JSON string. For select/multiSelect, map option names to minted ids.
        const encoded = encodeValue(propertyName, value, optionMap, db);
        if (encoded === null) continue;

        valueRows.push({
          workspaceId: ctx.workspaceId,
          rowPageId: rowPageId,
          propertyId: propId,
          value: encoded,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    // Views for this database (table, board, list — one of each per the Phase 4 template).
    let previousViewKey: string | null = null;
    for (const viewDef of db.views ?? []) {
      const viewSortKey = generateKeyBetween(previousViewKey, null);
      previousViewKey = viewSortKey;

      // Resolve groupPropertyName to an id; skip the view if the name is unknown.
      let groupPropertyId: string | null = null;
      if (viewDef.groupPropertyName) {
        const gId = propertyIdByName.get(viewDef.groupPropertyName);
        if (!gId) continue;
        groupPropertyId = gId;
      }

      // Resolve filter property names to ids; skip any filter whose name is unknown.
      const resolvedFilters = (viewDef.filters ?? []).flatMap((f) => {
        const propId = propertyIdByName.get(f.propertyName);
        if (!propId) return [];
        return [{ id: newId(), propertyId: propId, operator: f.operator, value: f.value }];
      });

      // Resolve sort property name to id; 'title' is the special literal and passes through as-is.
      let resolvedSort: { propertyId: string; direction: 'asc' | 'desc' } | null = null;
      if (viewDef.sort) {
        const sortPropId =
          viewDef.sort.propertyName === 'title'
            ? 'title'
            : propertyIdByName.get(viewDef.sort.propertyName);
        if (sortPropId) {
          resolvedSort = { propertyId: sortPropId, direction: viewDef.sort.direction };
        }
      }

      viewRows.push({
        id: newId(),
        workspaceId: ctx.workspaceId,
        databasePageId: dbPageId,
        name: viewDef.name,
        kind: viewDef.kind,
        groupPropertyId,
        filters: JSON.stringify(resolvedFilters),
        sort: resolvedSort ? JSON.stringify(resolvedSort) : null,
        sortKey: viewSortKey,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return { pageRows, blockRows, propertyRows, valueRows, viewRows };
}

// Converts a seed value (JS value) to its JSON-encoded storage form. For select and multiSelect the
// value is an option name (or array of names); these are mapped to the minted option ids.
// Returns null when the value cannot be encoded (unknown option name etc.), which skips the cell.
function encodeValue(
  propertyName: string,
  value: unknown,
  optionMap: Map<string, string> | undefined,
  db: SeedDatabaseDef,
): string | null {
  const propDef = db.properties.find((p) => p.name === propertyName);
  if (!propDef) return null;

  if (propDef.type === 'select') {
    if (typeof value !== 'string') return null;
    const id = optionMap?.get(value);
    if (!id) return null;
    return JSON.stringify(id);
  }
  if (propDef.type === 'multiSelect') {
    if (!Array.isArray(value)) return null;
    const ids: string[] = [];
    for (const name of value) {
      if (typeof name !== 'string') return null;
      const id = optionMap?.get(name);
      if (!id) return null;
      ids.push(id);
    }
    return JSON.stringify(ids);
  }
  // All other types encode their value directly.
  return JSON.stringify(value);
}

// The insert statements that populate a workspace from the template, plus how many pages they
// create. Exposed as statements rather than only as a write so a caller that has other work to do
// atomically - the test reset, which clears the workspace first - can put it all in one batch.
// Pages first, then their blocks, then properties, values and views, all in one batch.
export function buildSeedStatements(
  db: Db,
  ctx: Ctx,
  now: number,
): { statements: Statement[]; pageCount: number; blockCount: number } {
  const { pageRows, blockRows } = buildPageRows(ctx, now);

  // Position databases after all regular pages at the root level. The last root-level page key is
  // the last element of pageRows that has parentId = null, since walk visits them in order.
  const lastRootKey = pageRows.filter((p) => p.parentId === null).pop()?.sortKey ?? null;

  const {
    pageRows: dbPageRows,
    blockRows: dbBlockRows,
    propertyRows,
    valueRows,
    viewRows,
  } = buildDatabaseRows(ctx, now, lastRootKey);

  const allPageRows = [...pageRows, ...dbPageRows];
  const allBlockRows = [...blockRows, ...dbBlockRows];
  const statements: Statement[] = [];

  for (let i = 0; i < allPageRows.length; i += ROWS_PER_INSERT) {
    statements.push(db.insert(pages).values(allPageRows.slice(i, i + ROWS_PER_INSERT)));
  }
  for (let i = 0; i < allBlockRows.length; i += BLOCK_ROWS_PER_INSERT) {
    statements.push(db.insert(blocks).values(allBlockRows.slice(i, i + BLOCK_ROWS_PER_INSERT)));
  }
  for (let i = 0; i < propertyRows.length; i += PROPERTY_ROWS_PER_INSERT) {
    statements.push(
      db.insert(properties).values(propertyRows.slice(i, i + PROPERTY_ROWS_PER_INSERT)),
    );
  }
  for (let i = 0; i < valueRows.length; i += VALUE_ROWS_PER_INSERT) {
    statements.push(
      db.insert(propertyValues).values(valueRows.slice(i, i + VALUE_ROWS_PER_INSERT)),
    );
  }
  for (let i = 0; i < viewRows.length; i += VIEW_ROWS_PER_INSERT) {
    statements.push(db.insert(views).values(viewRows.slice(i, i + VIEW_ROWS_PER_INSERT)));
  }

  return { statements, pageCount: allPageRows.length, blockCount: allBlockRows.length };
}

// Populates a workspace from the template. Idempotent per workspace: a workspace that already has
// content is left alone, because ids are minted per call so there is nothing to match rows against.
// Returns the number of pages created.
export async function seedWorkspace(db: Db, ctx: Ctx): Promise<number> {
  if ((await countPages(db, ctx)) > 0) return 0;

  const { statements, pageCount } = buildSeedStatements(db, ctx, Date.now());
  await runBatch(db, statements);
  return pageCount;
}
