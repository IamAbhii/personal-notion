import { describe, expect, it } from 'vitest';
import {
  ancestorChain,
  buildPageTree,
  childrenOf,
  descendantIds,
  sortKeyBetween,
  sortKeyForNewChild,
} from './pageTree';
import { fixturePages, makePage } from '../test/fixtures';

describe('buildPageTree', () => {
  it('nests children under their parent to any depth', () => {
    const tree = buildPageTree(fixturePages);

    expect(tree.map((node) => node.page.id)).toEqual(['p-journal', 'p-reading']);
    expect(tree[0]?.children.map((node) => node.page.id)).toEqual(['p-trips']);
    expect(tree[0]?.children[0]?.children.map((node) => node.page.id)).toEqual(['p-lisbon']);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('orders siblings by sortKey, not by array order', () => {
    const pages = [
      makePage({ id: 'c', title: 'C', sortKey: 'a3' }),
      makePage({ id: 'a', title: 'A', sortKey: 'a1' }),
      makePage({ id: 'b', title: 'B', sortKey: 'a2' }),
    ];

    expect(buildPageTree(pages).map((node) => node.page.title)).toEqual(['A', 'B', 'C']);
  });

  it('breaks a duplicate sibling sortKey on the id, as the server does', () => {
    const pages = [
      makePage({ id: 'p-c', title: 'C', sortKey: 'a1' }),
      makePage({ id: 'p-a', title: 'A', sortKey: 'a1' }),
    ];

    expect(buildPageTree(pages).map((node) => node.page.title)).toEqual(['A', 'C']);
    expect(childrenOf(pages, null).map((page) => page.title)).toEqual(['A', 'C']);
  });

  it('treats a page whose parent is missing as a root', () => {
    const pages = [makePage({ id: 'orphan', title: 'Orphan', parentId: 'gone' })];

    expect(buildPageTree(pages).map((node) => node.page.id)).toEqual(['orphan']);
  });
});

describe('sort keys', () => {
  it('places a new child after the last existing sibling', () => {
    const key = sortKeyForNewChild(fixturePages, null);
    const existing = childrenOf(fixturePages, null).map((page) => page.sortKey);

    expect(existing.every((sortKey) => sortKey < key)).toBe(true);
  });

  it('never repeats a key already reserved by a create in flight (DEF-007)', () => {
    // Ten clicks land before the first result is applied, so the page list never changes between
    // them; only the reservations keep the keys apart.
    const reserved: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      reserved.push(sortKeyForNewChild(fixturePages, null, reserved));
    }

    expect(new Set(reserved).size).toBe(10);
    expect(reserved).toEqual([...reserved].sort());
  });

  it('places a key strictly between two neighbours', () => {
    const between = sortKeyBetween('a1', 'a2');

    expect(between > 'a1').toBe(true);
    expect(between < 'a2').toBe(true);
  });

  it('keeps a new page between its neighbours after a reorder', () => {
    const first = makePage({ id: 'first', title: 'First', sortKey: 'a0' });
    const last = makePage({ id: 'last', title: 'Last', sortKey: 'a1' });
    const middle = makePage({
      id: 'middle',
      title: 'Middle',
      sortKey: sortKeyBetween(first.sortKey, last.sortKey),
    });

    const order = buildPageTree([last, first, middle]).map((node) => node.page.id);
    expect(order).toEqual(['first', 'middle', 'last']);
  });
});

describe('descendantIds', () => {
  it('collects every nested page at any depth', () => {
    expect(descendantIds(fixturePages, 'p-journal')).toEqual(['p-trips', 'p-lisbon']);
    expect(descendantIds(fixturePages, 'p-reading')).toEqual([]);
  });
});

describe('ancestorChain', () => {
  it('returns the root-to-page chain', () => {
    expect(ancestorChain(fixturePages, 'p-lisbon').map((page) => page.title)).toEqual([
      'Journal',
      'Trips',
      'Lisbon',
    ]);
  });
});
