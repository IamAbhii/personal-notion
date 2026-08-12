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
    expect(rowIndent(2)).toBeGreaterThan(rowIndent(1));
  });

  it('caps the indent so a deeply nested row keeps room for its icon and title', () => {
    expect(rowIndent(20)).toBe(rowIndent(MAX_INDENT_DEPTH));
    expect(rowIndent(26)).toBe(rowIndent(MAX_INDENT_DEPTH));
  });

  it('leaves at least 60px for the title at the narrowest supported viewport (320px)', () => {
    // At 320px the drawer is max-w-[85vw] = 272px. Sidebar has px-3.5 (28px total) padding, so
    // inner width is 244px. Fixed row elements consume 134px (expand 48 + icon 20 + mobile
    // action 48 + three gaps 12 + paddingRight 6). Title space = 244 - maxIndent - 134.
    const maxIndent = rowIndent(MAX_INDENT_DEPTH);
    const drawerInnerWidth = 244; // 272px - 28px sidebar padding
    const fixedRowElements = 134; // expand + icon + action + gaps + paddingRight
    const titleSpace = drawerInnerWidth - maxIndent - fixedRowElements;
    expect(titleSpace).toBeGreaterThanOrEqual(60);
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
