// The whole workspace in one read: what the client stores locally to work offline, and the only read
// the app needs on cold start.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { blocks, pages } from '../db/schema';
import { listBlocks } from './blocks';
import type { Ctx } from './context';
import { listPages } from './pages';

export type SnapshotPage = {
  id: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  sortKey: string;
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

export type Snapshot = {
  workspaceId: string;
  pages: SnapshotPage[];
  blocks: SnapshotBlock[];
};

// Builds the snapshot payload for a workspace: one query for the pages and one for the blocks, both
// already in sort order, so the client can group blocks by pageId without sorting.
// Future: later phases add `databases`, `properties`, `rows` and `views` as sibling keys here, each
// read with its own query and each carrying its own version.
export async function getSnapshot(db: Db, ctx: Ctx): Promise<Snapshot> {
  const [pageRows, blockRows] = await Promise.all([listPages(db, ctx), listBlocks(db, ctx)]);
  return {
    workspaceId: ctx.workspaceId,
    pages: pageRows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      sortKey: row.sortKey,
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
  };
}

// A strong ETag for the workspace's current state, computed from cheap aggregates rather than by
// hashing the payload: for each entity the row count, the sum of every row's version and the newest
// updated_at. Any insert, update or delete moves at least one of the three, so a block edit changes
// the ETag as surely as a page rename does, and it costs one query per entity instead of the CPU
// budget a hash of the whole snapshot would spend.
// The p2- prefix versions the format: a client holding a p1- ETag from before blocks existed cannot
// match one of these and so gets a full snapshot rather than a 304 with stale content.
// Future: as further sibling entities land, aggregate each of them and fold the results in here, and
// bump the prefix again so old ETags cannot match.
export async function computeSnapshotEtag(db: Db, ctx: Ctx): Promise<string> {
  const [pageAgg, blockAgg] = await Promise.all([
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
  ]);
  const empty = { count: 0, versionSum: 0, updatedAt: 0 };
  const p = pageAgg[0] ?? empty;
  const b = blockAgg[0] ?? empty;
  return `"p2-${p.count}-${p.versionSum}-${p.updatedAt}-${b.count}-${b.versionSum}-${b.updatedAt}"`;
}
