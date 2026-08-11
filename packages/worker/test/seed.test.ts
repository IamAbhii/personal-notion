// Tests for the seed template: it populates a workspace with a nested, icon-bearing tree, is
// idempotent per workspace, and can be applied to two workspaces without collision.
import { describe, expect, it } from 'vitest';
import { listBlocks } from '../src/repo/blocks';
import { listPages } from '../src/repo/pages';
import { seedWorkspace } from '../src/seed/seedWorkspace';
import { BLOCK_TYPES } from '../src/sync/ops';
import { createAccount } from './helpers';

describe('seedWorkspace', () => {
  it('creates a nested tree at least three levels deep, every page with an icon', async () => {
    const owner = await createAccount();
    const created = await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);

    expect(created).toBe(pages.length);
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.every((page) => page.icon && page.icon.length > 0)).toBe(true);
    expect(pages.every((page) => page.workspaceId === owner.ctx.workspaceId)).toBe(true);

    // Depth: walk parent links and take the longest chain.
    const byId = new Map(pages.map((page) => [page.id, page]));
    const depthOf = (id: string): number => {
      let depth = 1;
      let parentId = byId.get(id)?.parentId ?? null;
      while (parentId !== null) {
        depth += 1;
        parentId = byId.get(parentId)?.parentId ?? null;
      }
      return depth;
    };
    expect(Math.max(...pages.map((page) => depthOf(page.id)))).toBeGreaterThanOrEqual(3);
  });

  it('seeds page content covering every one of the eleven block types', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);
    const blocks = await listBlocks(owner.db, owner.ctx);

    expect(new Set(blocks.map((block) => block.type))).toEqual(new Set(BLOCK_TYPES));
    // Real-looking content on several pages, not one demo page holding all eleven types.
    const pagesWithBlocks = new Set(blocks.map((block) => block.pageId));
    expect(pagesWithBlocks.size).toBeGreaterThanOrEqual(3);
    // Every block belongs to a seeded page of this workspace.
    const pageIds = new Set(pages.map((page) => page.id));
    expect(blocks.every((block) => pageIds.has(block.pageId))).toBe(true);
    expect(blocks.every((block) => block.workspaceId === owner.ctx.workspaceId)).toBe(true);

    // A to-do list with some items done and some not, so the checkbox state is visible on a first run.
    const todos = blocks.filter((block) => block.type === 'todo');
    expect(todos.some((block) => block.checked === 1)).toBe(true);
    expect(todos.some((block) => block.checked === 0)).toBe(true);

    // The types that carry extras carry them as parseable JSON.
    for (const block of blocks.filter((b) => b.type === 'code' || b.type === 'callout')) {
      expect(block.props).toBeTruthy();
      expect(() => JSON.parse(block.props!)).not.toThrow();
    }
    expect(blocks.some((block) => block.type === 'code' && block.props!.includes('language'))).toBe(
      true,
    );
    expect(blocks.some((block) => block.type === 'callout' && block.props!.includes('emoji'))).toBe(
      true,
    );

    // Blocks read in template order within a page: the first block of a content page is its heading.
    const first = blocks.filter((block) => block.pageId === blocks[0]!.pageId);
    expect(first[0]?.type).toMatch(/^heading/);
  });

  it('does not duplicate content when called twice', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const afterFirst = await listPages(owner.db, owner.ctx);
    const blocksAfterFirst = await listBlocks(owner.db, owner.ctx);

    const createdAgain = await seedWorkspace(owner.db, owner.ctx);

    expect(createdAgain).toBe(0);
    const afterSecond = await listPages(owner.db, owner.ctx);
    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(afterSecond.map((page) => page.id)).toEqual(afterFirst.map((page) => page.id));
    const blocksAfterSecond = await listBlocks(owner.db, owner.ctx);
    expect(blocksAfterSecond.map((block) => block.id)).toEqual(
      blocksAfterFirst.map((block) => block.id),
    );
  });

  it('applies to two workspaces independently, with fresh ids each time', async () => {
    const mine = await createAccount();
    const theirs = await createAccount({ email: 'other@example.com' });

    await seedWorkspace(mine.db, mine.ctx);
    await seedWorkspace(theirs.db, theirs.ctx);

    const minePages = await listPages(mine.db, mine.ctx);
    const theirPages = await listPages(theirs.db, theirs.ctx);
    expect(minePages).toHaveLength(theirPages.length);
    const overlap = minePages.filter((page) => theirPages.some((other) => other.id === page.id));
    expect(overlap).toHaveLength(0);
  });
});
