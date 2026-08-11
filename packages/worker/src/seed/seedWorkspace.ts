// Applies the seed template to a workspace. Called on first sign-in (from GET /api/me) rather than
// at deploy time, so every new workspace - today's one and any future account's - gets a populated
// first run from the same code path.
import { generateKeyBetween } from 'fractional-indexing';
import type { Db } from '../db/client';
import { runBatch, type Statement } from '../db/batch';
import { blocks, pages, type BlockRow, type PageRow } from '../db/schema';
import { newId } from '../lib/ids';
import type { Ctx } from '../repo/context';
import { countPages } from '../repo/pages';
import { SEED_PAGES, type SeedPage } from './template';

// D1 allows at most 100 bound parameters per query and a page row binds 9, so multi-row inserts are
// chunked at 10 rows. Chunking is safe because every chunk goes into the same batch.
const ROWS_PER_INSERT = 10;
// A block row binds 11 parameters, so its chunks are smaller.
const BLOCK_ROWS_PER_INSERT = 9;

// Flattens the template into page rows and block rows, minting a fresh uuid for every row and a
// fractional sort_key per sibling group, so the tree renders in template order and each page's blocks
// read in the order the template lists them.
function buildRows(ctx: Ctx, now: number): { pageRows: PageRow[]; blockRows: BlockRow[] } {
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

// The insert statements that populate a workspace from the template, plus how many pages they
// create. Exposed as statements rather than only as a write so a caller that has other work to do
// atomically - the test reset, which clears the workspace first - can put it all in one batch.
// Pages first, then their blocks, all in one batch, so a seeded workspace is never half-populated.
// Future: a later phase seeds databases and views too; add their statements here.
export function buildSeedStatements(
  db: Db,
  ctx: Ctx,
  now: number,
): { statements: Statement[]; pageCount: number; blockCount: number } {
  const { pageRows, blockRows } = buildRows(ctx, now);
  const statements: Statement[] = [];
  for (let i = 0; i < pageRows.length; i += ROWS_PER_INSERT) {
    statements.push(db.insert(pages).values(pageRows.slice(i, i + ROWS_PER_INSERT)));
  }
  for (let i = 0; i < blockRows.length; i += BLOCK_ROWS_PER_INSERT) {
    statements.push(db.insert(blocks).values(blockRows.slice(i, i + BLOCK_ROWS_PER_INSERT)));
  }
  return { statements, pageCount: pageRows.length, blockCount: blockRows.length };
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
