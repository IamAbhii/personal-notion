// Tests for the seed template: it populates a workspace with a nested, icon-bearing tree, is
// idempotent per workspace, and can be applied to two workspaces without collision.
import { describe, expect, it } from 'vitest';
import { listPages } from '../src/repo/pages';
import { seedWorkspace } from '../src/seed/seedWorkspace';
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

  it('does not duplicate content when called twice', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const afterFirst = await listPages(owner.db, owner.ctx);

    const createdAgain = await seedWorkspace(owner.db, owner.ctx);

    expect(createdAgain).toBe(0);
    const afterSecond = await listPages(owner.db, owner.ctx);
    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(afterSecond.map((page) => page.id)).toEqual(afterFirst.map((page) => page.id));
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
