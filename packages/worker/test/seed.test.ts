// Tests for the seed template: it populates a workspace with a nested, icon-bearing tree, is
// idempotent per workspace, and can be applied to two workspaces without collision. Also asserts
// the completeness criteria required by Phase 5: every block type, every property type, all three
// view kinds, at least one filtered view, at least one sorted view, and a valid board groupBy.
import { describe, expect, it } from 'vitest';
import { listBlocks } from '../src/repo/blocks';
import { listPages } from '../src/repo/pages';
import { listProperties } from '../src/repo/properties';
import { listViews } from '../src/repo/views';
import { seedWorkspace } from '../src/seed/seedWorkspace';
import { BLOCK_TYPES, PROPERTY_TYPES } from '../src/sync/ops';
import { createAccount } from './helpers';

describe('seedWorkspace', () => {
  it('creates a nested tree at least three levels deep, every page with an icon', async () => {
    const owner = await createAccount();
    const created = await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);

    expect(created).toBe(pages.length);
    expect(pages.length).toBeGreaterThan(10);
    // Row pages (kind='row') are accessed from the table view and do not carry sidebar icons.
    // Every other page must have a non-empty icon so the sidebar tree is fully populated.
    const nonRowPages = pages.filter((page) => page.kind !== 'row');
    expect(nonRowPages.every((page) => page.icon && page.icon.length > 0)).toBe(true);
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

    // Blocks read in template order within a page: find a content page whose template starts with a
    // heading (the seed has several) and verify its first stored block matches. The global sort
    // order across pages is not tested here because multiple pages share the same first sort_key.
    const headingFirst = blocks.find((b) => b.type.startsWith('heading'));
    expect(headingFirst).toBeTruthy();
    const pageBlocks = blocks.filter((b) => b.pageId === headingFirst!.pageId);
    expect(pageBlocks[0]?.type).toMatch(/^heading/);
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

  // Completeness gate: if any property type, view kind, filter or sort is missing from the seed,
  // this test will fail before a user ever sees the workspace — catching a regression immediately.
  it('seeds every property type across its databases', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const props = await listProperties(owner.db, owner.ctx);

    const seededTypes = new Set(props.map((p) => p.type));
    // Every one of the seven property types must appear at least once.
    for (const type of PROPERTY_TYPES) {
      expect(seededTypes.has(type), `missing property type: ${type}`).toBe(true);
    }
  });

  it('seeds all three view kinds, at least one filtered view, and at least one sorted view', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);

    const kinds = new Set(allViews.map((v) => v.kind));
    expect(kinds.has('table'), 'missing table view').toBe(true);
    expect(kinds.has('board'), 'missing board view').toBe(true);
    expect(kinds.has('list'), 'missing list view').toBe(true);

    // A view carries a filter when its filters column parses to a non-empty array.
    const hasFilter = allViews.some((v) => {
      const parsed: unknown[] = JSON.parse(v.filters);
      return parsed.length > 0;
    });
    expect(hasFilter, 'no view has a filter').toBe(true);

    // A view carries a sort when its sort column is non-null.
    const hasSort = allViews.some((v) => v.sort !== null);
    expect(hasSort, 'no view has a sort').toBe(true);
  });

  it('board views group by a select property that exists on their database', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allViews = await listViews(owner.db, owner.ctx);
    const allProps = await listProperties(owner.db, owner.ctx);

    const boardViews = allViews.filter((v) => v.kind === 'board');
    // There must be at least one board view.
    expect(boardViews.length).toBeGreaterThan(0);

    for (const view of boardViews) {
      // Every board view must have a groupPropertyId pointing to a real select property.
      expect(view.groupPropertyId, `board view "${view.name}" has no groupPropertyId`).toBeTruthy();
      const groupProp = allProps.find((p) => p.id === view.groupPropertyId);
      expect(
        groupProp,
        `board view "${view.name}" groupPropertyId does not match any property`,
      ).toBeTruthy();
      expect(
        groupProp?.type,
        `board view "${view.name}" groups by "${groupProp?.type}" instead of "select"`,
      ).toBe('select');
    }
  });

  // Regression guard for DEF-102: every non-row page must have at least one block so the workspace
  // never shows "This page is empty" on first launch, and every top-level page area must have enough
  // content to read as inhabited. Thresholds are set from the actual seed with headroom, so the test
  // is meaningful — a future empty page will fail it immediately.
  it('every non-row page has at least one block, and every top-level area has at least three', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const allPages = await listPages(owner.db, owner.ctx);
    const allBlocks = await listBlocks(owner.db, owner.ctx);

    const blockCountByPage = new Map<string, number>();
    for (const block of allBlocks) {
      blockCountByPage.set(block.pageId, (blockCountByPage.get(block.pageId) ?? 0) + 1);
    }

    // Every kind='page' must have at least one block — the empty-page placeholder must never appear
    // in the seeded workspace on first launch. kind='database' pages show their rows and views
    // rather than blocks, so they are excluded. kind='row' pages are optional; some rows carry
    // prose and some carry only property values.
    const contentPages = allPages.filter((p) => p.kind === 'page');
    for (const page of contentPages) {
      expect(
        blockCountByPage.get(page.id) ?? 0,
        `page "${page.title}" has no blocks`,
      ).toBeGreaterThanOrEqual(1);
    }

    // Top-level page areas (parentId=null, kind='page') are the sidebar entries a new user clicks
    // first. They must have at least three blocks so they read as inhabited, not as stubs.
    const topLevelPages = allPages.filter((p) => p.kind === 'page' && p.parentId === null);
    expect(topLevelPages.length, 'no top-level pages found').toBeGreaterThan(0);
    for (const page of topLevelPages) {
      expect(
        blockCountByPage.get(page.id) ?? 0,
        `top-level page "${page.title}" has fewer than 3 blocks`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('seeds enough distinctly-titled items for search to narrow meaningfully', async () => {
    const owner = await createAccount();
    await seedWorkspace(owner.db, owner.ctx);
    const pages = await listPages(owner.db, owner.ctx);

    // Quick-find searches titles of pages, databases and rows. Each title must be unique so a
    // partial query returns an unambiguous list. Duplicate titles would make search results
    // indistinguishable to a user.
    const titles = pages.map((p) => p.title.trim().toLowerCase());
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size, 'duplicate page/row titles found in the seed').toBe(titles.length);

    // The workspace should have enough titled items that typing a few characters narrows the list.
    // Databases (kind='database') and standalone pages (kind='page') are the primary search targets.
    const searchablePages = pages.filter((p) => p.kind === 'page' || p.kind === 'database');
    expect(searchablePages.length).toBeGreaterThanOrEqual(10);
  });
});
