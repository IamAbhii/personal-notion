// Repository-level tests for the page tree: create, read, rename, delete with cascade, fractional
// ordering, and the tenancy filter that keeps one workspace out of another's rows.
import { describe, expect, it } from 'vitest';
import {
  countPages,
  createPage,
  deletePage,
  getPage,
  listPages,
  updatePage,
} from '../src/repo/pages';
import { createAccount } from './helpers';

describe('pages repository', () => {
  it('creates a page and reads it back', async () => {
    const { db, ctx } = await createAccount();
    const page = await createPage(db, ctx, { title: 'Groceries', icon: '🛒' });

    const stored = await getPage(db, ctx, page.id);
    expect(stored).toMatchObject({
      id: page.id,
      workspaceId: ctx.workspaceId,
      title: 'Groceries',
      icon: '🛒',
      parentId: null,
      version: 1,
    });
  });

  it('renames a page and bumps its version', async () => {
    const { db, ctx } = await createAccount();
    const page = await createPage(db, ctx, { title: 'Untitled' });

    const renamed = await updatePage(db, ctx, page.id, { title: 'Reading list', icon: '📚' });

    expect(renamed?.title).toBe('Reading list');
    expect(renamed?.icon).toBe('📚');
    expect(renamed?.version).toBe(2);
    expect(renamed?.updatedAt).toBeGreaterThanOrEqual(page.updatedAt);
  });

  it('deletes a page and cascades to children and grandchildren', async () => {
    const { db, ctx } = await createAccount();
    const root = await createPage(db, ctx, { title: 'Projects' });
    const child = await createPage(db, ctx, { title: 'Flat', parentId: root.id });
    const grandchild = await createPage(db, ctx, { title: 'Lighting', parentId: child.id });
    const sibling = await createPage(db, ctx, { title: 'Recipes' });

    const removed = await deletePage(db, ctx, root.id);

    expect(removed.sort()).toEqual([root.id, child.id, grandchild.id].sort());
    expect(await getPage(db, ctx, child.id)).toBeUndefined();
    expect(await getPage(db, ctx, grandchild.id)).toBeUndefined();
    expect(await getPage(db, ctx, sibling.id)).toBeDefined();
  });

  it('orders pages by fractional sort_key in creation order', async () => {
    const { db, ctx } = await createAccount();
    const first = await createPage(db, ctx, { title: 'First' });
    const second = await createPage(db, ctx, { title: 'Second' });
    const third = await createPage(db, ctx, { title: 'Third' });

    const listed = await listPages(db, ctx);
    expect(listed.map((page) => page.id)).toEqual([first.id, second.id, third.id]);
    expect(first.sortKey < second.sortKey).toBe(true);
    expect(second.sortKey < third.sortKey).toBe(true);

    // A page moved between two others is one write on one row, not a renumbering of its siblings.
    const moved = await updatePage(db, ctx, third.id, { sortKey: 'a0V' });
    expect(moved?.sortKey).toBe('a0V');
  });

  it('cannot reach another workspace pages', async () => {
    const mine = await createAccount({ email: 'owner@example.com' });
    const theirs = await createAccount({ email: 'someone@example.com' });
    const theirPage = await createPage(theirs.db, theirs.ctx, { title: 'Secret' });

    expect(await getPage(mine.db, mine.ctx, theirPage.id)).toBeUndefined();
    expect(await listPages(mine.db, mine.ctx)).toHaveLength(0);
    expect(
      await updatePage(mine.db, mine.ctx, theirPage.id, { title: 'Hijacked' }),
    ).toBeUndefined();
    expect(await deletePage(mine.db, mine.ctx, theirPage.id)).toEqual([]);

    // Their row is untouched.
    expect((await getPage(theirs.db, theirs.ctx, theirPage.id))?.title).toBe('Secret');
    expect(await countPages(theirs.db, theirs.ctx)).toBe(1);
  });
});
