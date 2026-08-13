// Applies the seed template to a workspace. Called on first sign-in (from GET /api/me) rather than
// at deploy time, so every new workspace - today's one and any future account's - gets a populated
// first run from the same code path.
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { pages, type PageRow } from '../db/schema';
import { newId } from '../lib/ids';
import type { Ctx } from '../repo/context';
import { countPages } from '../repo/pages';
import { SEED_PAGES, type SeedPage } from './template';

// D1 allows at most 100 bound parameters per query and a page row binds 9, so multi-row inserts are
// chunked at 10 rows. Chunking is safe because every chunk goes into the same batch.
const ROWS_PER_INSERT = 10;

// Flattens the template into page rows, minting a fresh uuid for every page and a fractional
// sort_key per sibling group so the tree renders in template order.
function buildRows(ctx: Ctx, now: number): PageRow[] {
  const rows: PageRow[] = [];

  const walk = (nodes: SeedPage[], parentId: string | null) => {
    let previousKey: string | null = null;
    for (const node of nodes) {
      const sortKey = generateKeyBetween(previousKey, null);
      previousKey = sortKey;
      const id = newId();
      rows.push({
        id,
        workspaceId: ctx.workspaceId,
        parentId,
        title: node.title,
        icon: node.icon,
        sortKey,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (node.children) walk(node.children, id);
    }
  };

  walk(SEED_PAGES, null);
  return rows;
}

// Populates a workspace from the template. Idempotent per workspace: a workspace that already has
// content is left alone, because ids are minted per call so there is nothing to match rows against.
// Returns the number of pages created.
export async function seedWorkspace(db: Db, ctx: Ctx): Promise<number> {
  if ((await countPages(db, ctx)) > 0) return 0;

  const rows = buildRows(ctx, Date.now());
  const statements: Statement[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    statements.push(db.insert(pages).values(rows.slice(i, i + ROWS_PER_INSERT)));
  }
  // Future: later phases seed blocks and databases too; add their statements to this same batch so
  // a seeded workspace is never half-populated.
  await runBatch(db, statements);
  return rows.length;
}
