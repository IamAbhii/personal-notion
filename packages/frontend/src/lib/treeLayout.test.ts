import { describe, expect, it } from 'vitest';
import { MAX_INDENT_DEPTH, collapseBreadcrumb, rowIndent } from './treeLayout';
import { makePage } from '../test/fixtures';

// The sidebar tree is 271px wide and the top bar is one line high, while pages nest to any depth.
// These are the limits that keep a 20-deep row readable (DEF-009).

/** A root-to-page chain `depth` levels deep, the shape the breadcrumb receives. */
function chainOfDepth(depth: number) {
  return Array.from({ length: depth }, (_unused, index) =>
    makePage({
      id: `p-${index}`,
      title: `Level ${index}`,
      parentId: index ? `p-${index - 1}` : null,
    }),
  );
}

describe('rowIndent', () => {
  it('indents each of the first levels further than the last', () => {
    expect(rowIndent(1)).toBeGreaterThan(rowIndent(0));
    expect(rowIndent(3)).toBeGreaterThan(rowIndent(2));
  });

  it('caps the indent so a deeply nested row keeps room for its icon and title', () => {
    expect(rowIndent(20)).toBe(rowIndent(MAX_INDENT_DEPTH));
    expect(rowIndent(26)).toBe(rowIndent(MAX_INDENT_DEPTH));
    // The tree is 271px wide; the disclosure, icon and a readable title need well over 100px of it.
    expect(rowIndent(26)).toBeLessThan(140);
  });
});

describe('collapseBreadcrumb', () => {
  it('leaves a short chain whole', () => {
    const items = collapseBreadcrumb(chainOfDepth(3));

    expect(items).toHaveLength(3);
    expect(items.every((item) => item.kind === 'page')).toBe(true);
  });

  it('collapses the middle of a deep chain to a bounded number of crumbs', () => {
    const items = collapseBreadcrumb(chainOfDepth(26));

    expect(items).toHaveLength(4);
    expect(items.filter((item) => item.kind === 'gap')).toHaveLength(1);
  });

  it('keeps the root and the current page, which is what says where the user is', () => {
    const items = collapseBreadcrumb(chainOfDepth(26));
    const titles = items.flatMap((item) => (item.kind === 'page' ? [item.page.title] : []));

    expect(titles[0]).toBe('Level 0');
    expect(titles[titles.length - 1]).toBe('Level 25');
  });

  it('names the pages it hid, so nothing is lost silently', () => {
    const items = collapseBreadcrumb(chainOfDepth(26));
    const gap = items.find((item) => item.kind === 'gap');

    expect(gap?.kind === 'gap' && gap.hidden).toHaveLength(23);
  });
});
