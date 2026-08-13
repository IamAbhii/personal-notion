// The whole workspace in one read: what the client stores locally to work offline, and the only read
// the app needs on cold start.
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { pages } from '../db/schema';
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

export type Snapshot = {
  workspaceId: string;
  pages: SnapshotPage[];
};

// Builds the snapshot payload for a workspace.
// Future: later phases add `blocks`, `databases`, `properties`, `rows` and `views` as sibling keys
// here, each read with its own query and each carrying its own version.
export async function getSnapshot(db: Db, ctx: Ctx): Promise<Snapshot> {
  const rows = await listPages(db, ctx);
  return {
    workspaceId: ctx.workspaceId,
    pages: rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      title: row.title,
      icon: row.icon,
      sortKey: row.sortKey,
      version: row.version,
      updatedAt: row.updatedAt,
    })),
  };
}

// A strong ETag for the workspace's current state, computed from cheap aggregates rather than by
// hashing the payload: row count, the sum of every row's version and the newest updated_at. Any
// insert, update or delete moves at least one of the three, and it costs one query instead of the
// CPU budget a hash of the whole snapshot would spend.
// Future: as sibling entities land, aggregate each of them and fold the results in here, so the
// ETag covers the whole snapshot and not just pages.
export async function computeSnapshotEtag(db: Db, ctx: Ctx): Promise<string> {
  const rows = await db
    .select({
      count: sql<number>`count(*)`,
      versionSum: sql<number>`coalesce(sum(version), 0)`,
      updatedAt: sql<number>`coalesce(max(updated_at), 0)`,
    })
    .from(pages)
    .where(eq(pages.workspaceId, ctx.workspaceId));
  const agg = rows[0] ?? { count: 0, versionSum: 0, updatedAt: 0 };
  return `"p1-${agg.count}-${agg.versionSum}-${agg.updatedAt}"`;
}
