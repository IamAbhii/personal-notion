// The whole workspace in one read: what the client stores locally to work offline, and the only read
// the app needs on cold start.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blocks, pages, properties, propertyValues } from '../db/schema';
import { listBlocks } from './blocks';
import type { Ctx } from './context';
import { listPages } from './pages';
import { listProperties, parseOptions } from './properties';
import { listValues } from './propertyValues';
import type { SelectOption } from '../sync/ops';

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

export type Snapshot = {
  workspaceId: string;
  pages: SnapshotPage[];
  blocks: SnapshotBlock[];
  properties: SnapshotProperty[];
  values: SnapshotValue[];
};

// Builds the snapshot payload for a workspace: one query per entity type, all in sort order, so
// the client can group without sorting.
// Future: Phase 4 adds a `views` sibling key here for persisted view settings (per-database,
// per-view layout and filter state). The view switcher and per-view settings land there.
export async function getSnapshot(db: Db, ctx: Ctx): Promise<Snapshot> {
  const [pageRows, blockRows, propRows, valueRows] = await Promise.all([
    listPages(db, ctx),
    listBlocks(db, ctx),
    listProperties(db, ctx),
    listValues(db, ctx),
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
  };
}

// A strong ETag for the workspace's current state, computed from cheap aggregates rather than by
// hashing the payload: for each entity the row count, the sum of every row's version and the newest
// updated_at. Any insert, update or delete moves at least one of the three, so a property rename
// changes the ETag as surely as a page rename does, and it costs one query per entity.
// The p3- prefix versions the format: a client holding a p2- ETag from before databases existed
// cannot match one of these and so gets a full snapshot rather than a 304 with stale content.
// Future: as further sibling entities land (Phase 4 views), aggregate each of them and fold the
// results in here, and bump the prefix again so old ETags cannot match.
export async function computeSnapshotEtag(db: Db, ctx: Ctx): Promise<string> {
  const [pageAgg, blockAgg, propAgg, valueAgg] = await Promise.all([
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
  ]);
  const empty = { count: 0, versionSum: 0, updatedAt: 0 };
  const p = pageAgg[0] ?? empty;
  const b = blockAgg[0] ?? empty;
  const pr = propAgg[0] ?? empty;
  const v = valueAgg[0] ?? empty;
  return `"p3-${p.count}-${p.versionSum}-${p.updatedAt}-${b.count}-${b.versionSum}-${b.updatedAt}-${pr.count}-${pr.versionSum}-${pr.updatedAt}-${v.count}-${v.versionSum}-${v.updatedAt}"`;
}
