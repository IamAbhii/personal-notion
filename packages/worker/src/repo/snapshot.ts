// The whole workspace in one read: what the client stores locally to work offline, and the only read
// the app needs on cold start.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blocks, pages, properties, propertyValues, views } from '../db/schema';
import { listBlocks } from './blocks';
import type { Ctx } from './context';
import { listPages } from './pages';
import { listProperties, parseOptions } from './properties';
import { listValues } from './propertyValues';
import { listViews } from './views';
import type { FilterOperator, SelectOption } from '../sync/ops';

export type SnapshotPage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  sortKey: string;
  kind: 'page' | 'database' | 'row';
  version: number;
  updatedAt: number;
};

export type SnapshotBlock = {
  id: string;
  pageId: string;
  type: string;
  text: string;
  checked: boolean;
  props: string | null;
  sortKey: string;
  version: number;
  updatedAt: number;
};

export type SnapshotProperty = {
  id: string;
  databasePageId: string;
  name: string;
  type: string;
  // Always an array on the wire; [] for non-select types. Parsed server-side so the client never
  // has to deserialise a nested JSON string.
  options: SelectOption[];
  sortKey: string;
  version: number;
  updatedAt: number;
};

export type SnapshotValue = {
  rowPageId: string;
  propertyId: string;
  // The raw JSON string; the client parses per type. null means the cell is empty.
  value: string | null;
  version: number;
  updatedAt: number;
};

// One filter in a view. operator is typed as FilterOperator (the known set) and value is a
// plain string or null for operators that need no value (isChecked, isNotChecked).
export type SnapshotViewFilter = {
  id: string;
  propertyId: string;
  operator: FilterOperator;
  value: string | null;
};

export type SnapshotViewSort = {
  propertyId: string;
  direction: 'asc' | 'desc';
};

export type SnapshotView = {
  id: string;
  databasePageId: string;
  name: string;
  kind: 'table' | 'board' | 'list';
  groupPropertyId: string | null;
  // Always an array on the wire; [] when no filters are set. Parsed server-side so the client
  // never has to deserialise a nested JSON string.
  filters: SnapshotViewFilter[];
  sort: SnapshotViewSort | null;
  sortKey: string;
  version: number;
  updatedAt: number;
};

export type Snapshot = {
  workspaceId: string;
  pages: SnapshotPage[];
  blocks: SnapshotBlock[];
  properties: SnapshotProperty[];
  values: SnapshotValue[];
  views: SnapshotView[];
};

// Builds the snapshot payload for a workspace: one query per entity type, all in sort order, so
// the client can group without sorting.
export async function getSnapshot(db: Db, ctx: Ctx): Promise<Snapshot> {
  const [pageRows, blockRows, propRows, valueRows, viewRows] = await Promise.all([
    listPages(db, ctx),
    listBlocks(db, ctx),
    listProperties(db, ctx),
    listValues(db, ctx),
    listViews(db, ctx),
  ]);
  return {
    workspaceId: ctx.workspaceId,
    pages: pageRows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      sortKey: row.sortKey,
      kind: (row.kind as 'page' | 'database' | 'row') ?? 'page',
      version: row.version,
      updatedAt: row.updatedAt,
    })),
    blocks: blockRows.map((row) => ({
      id: row.id,
      pageId: row.pageId,
      type: row.type,
      text: row.text,
      // Stored as 0/1 by SQLite, but a boolean on the wire so the client never has to remember which.
      checked: row.checked === 1,
      props: row.props,
      sortKey: row.sortKey,
      version: row.version,
      updatedAt: row.updatedAt,
    })),
    properties: propRows.map((row) => ({
      id: row.id,
      databasePageId: row.databasePageId,
      name: row.name,
      type: row.type,
      // Parse options from JSON so the client gets a typed array, never a raw string.
      options: parseOptions(row.options),
      sortKey: row.sortKey,
      version: row.version,
      updatedAt: row.updatedAt,
    })),
    values: valueRows.map((row) => ({
      rowPageId: row.rowPageId,
      propertyId: row.propertyId,
      value: row.value,
      version: row.version,
      updatedAt: row.updatedAt,
    })),
    views: viewRows.map((row) => ({
      id: row.id,
      databasePageId: row.databasePageId,
      name: row.name,
      kind: row.kind as 'table' | 'board' | 'list',
      groupPropertyId: row.groupPropertyId ?? null,
      // Parse filters and sort from JSON so the client gets typed objects, never raw strings.
      filters: parseViewFilters(row.filters),
      sort: parseViewSort(row.sort),
      sortKey: row.sortKey,
      version: row.version,
      updatedAt: row.updatedAt,
    })),
  };
}

// Parses the stored JSON filters string into a typed array. Falls back to [] on parse error so a
// corrupted row does not break the entire snapshot.
function parseViewFilters(raw: string): SnapshotViewFilter[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SnapshotViewFilter[];
  } catch {
    return [];
  }
}

// Parses the stored JSON sort string into a typed object, or null when no sort is set or the stored
// value cannot be parsed.
function parseViewSort(raw: string | null): SnapshotViewSort | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as SnapshotViewSort;
  } catch {
    return null;
  }
}

// A strong ETag for the workspace's current state, computed from cheap aggregates rather than by
// hashing the payload: for each entity the row count, the sum of every row's version and the newest
// updated_at. Any insert, update or delete moves at least one of the three, so a view filter change
// changes the ETag as surely as a page rename does, and it costs one query per entity.
// The p4- prefix versions the format: a client holding a p3- ETag from before views existed cannot
// match one of these and so gets a full snapshot rather than a 304 with stale content.
// Future: as further sibling entities land (Phase 5+), aggregate each of them and fold the results in
// here, and bump the prefix again so old ETags cannot match.
export async function computeSnapshotEtag(db: Db, ctx: Ctx): Promise<string> {
  const [pageAgg, blockAgg, propAgg, valueAgg, viewAgg] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)`,
        versionSum: sql<number>`coalesce(sum(version), 0)`,
        updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
      })
      .from(pages)
      .where(eq(pages.workspaceId, ctx.workspaceId)),
    db
      .select({
        count: sql<number>`count(*)`,
        versionSum: sql<number>`coalesce(sum(version), 0)`,
        updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
      })
      .from(blocks)
      .where(eq(blocks.workspaceId, ctx.workspaceId)),
    db
      .select({
        count: sql<number>`count(*)`,
        versionSum: sql<number>`coalesce(sum(version), 0)`,
        updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
      })
      .from(properties)
      .where(eq(properties.workspaceId, ctx.workspaceId)),
    db
      .select({
        count: sql<number>`count(*)`,
        versionSum: sql<number>`coalesce(sum(version), 0)`,
        updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
      })
      .from(propertyValues)
      .where(eq(propertyValues.workspaceId, ctx.workspaceId)),
    db
      .select({
        count: sql<number>`count(*)`,
        versionSum: sql<number>`coalesce(sum(version), 0)`,
        updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
      })
      .from(views)
      .where(eq(views.workspaceId, ctx.workspaceId)),
  ]);
  const empty = { count: 0, versionSum: 0, updatedAt: 0 };
  const p = pageAgg[0] ?? empty;
  const b = blockAgg[0] ?? empty;
  const pr = propAgg[0] ?? empty;
  const v = valueAgg[0] ?? empty;
  const vw = viewAgg[0] ?? empty;
  return `"p4-${p.count}-${p.versionSum}-${p.updatedAt}-${b.count}-${b.versionSum}-${b.updatedAt}-${pr.count}-${pr.versionSum}-${pr.updatedAt}-${v.count}-${v.versionSum}-${v.updatedAt}-${vw.count}-${vw.versionSum}-${vw.updatedAt}"`;
}
