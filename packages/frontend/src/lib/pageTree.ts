import { generateKeyBetween } from 'fractional-indexing';
import type { PageRecord } from '../api/types';

// Pure tree helpers over the flat page list the snapshot returns. Kept free of React so they are
// cheap to unit test and reusable by the offline queue later.

/** One node of the sidebar tree: a page plus its children, already in sortKey order. */
export interface PageNode {
  page: PageRecord;
  depth: number;
  children: PageNode[];
}

/**
 * Builds the nested tree from the flat page list, ordering siblings by `sortKey`.
 * Pages whose parent is missing are treated as roots so a partial snapshot still renders.
 */
export function buildPageTree(pages: PageRecord[]): PageNode[] {
  const byParent = new Map<string | null, PageRecord[]>();
  const ids = new Set(pages.map((page) => page.id));

  for (const page of pages) {
    const parentId = page.parentId !== null && ids.has(page.parentId) ? page.parentId : null;
    const siblings = byParent.get(parentId);
    if (siblings) siblings.push(page);
    else byParent.set(parentId, [page]);
  }

  const build = (parentId: string | null, depth: number): PageNode[] =>
    (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0))
      .map((page) => ({ page, depth, children: build(page.id, depth + 1) }));

  return build(null, 0);
}

/** The direct children of a parent (null for top level), in `sortKey` order. */
export function childrenOf(pages: PageRecord[], parentId: string | null): PageRecord[] {
  return pages
    .filter((page) => (page.parentId ?? null) === parentId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

/**
 * A fractional key that places a new page after the last existing sibling. Fractional keys mean a
 * later reorder is one op on one row instead of rewriting every sibling's position.
 */
export function sortKeyForNewChild(pages: PageRecord[], parentId: string | null): string {
  const siblings = childrenOf(pages, parentId);
  const last = siblings[siblings.length - 1];
  return generateKeyBetween(last?.sortKey ?? null, null);
}

/** A fractional key strictly between two neighbours, either of which may be absent. */
export function sortKeyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

/** Every page nested under a page, at any depth. Used to say what a delete will take with it. */
export function descendantIds(pages: PageRecord[], pageId: string): string[] {
  const collected: string[] = [];
  const walk = (parentId: string) => {
    for (const page of pages) {
      if (page.parentId === parentId) {
        collected.push(page.id);
        walk(page.id);
      }
    }
  };
  walk(pageId);
  return collected;
}

/** The chain of pages from the root down to `pageId`, inclusive, for the breadcrumb. */
export function ancestorChain(pages: PageRecord[], pageId: string): PageRecord[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const chain: PageRecord[] = [];
  let current = byId.get(pageId);
  while (current) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** The ids of every ancestor of a page, so the sidebar can auto-expand down to the current page. */
export function ancestorIds(pages: PageRecord[], pageId: string): string[] {
  return ancestorChain(pages, pageId)
    .slice(0, -1)
    .map((page) => page.id);
}
