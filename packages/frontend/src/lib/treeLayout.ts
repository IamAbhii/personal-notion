import type { PageRecord } from '../api/types';

// How a tree of unbounded depth is made to fit a fixed-width sidebar and a one-line breadcrumb.
// Pages nest to any depth, so both indentation and the breadcrumb have to degrade rather than grow
// until the title is squeezed to nothing. Kept pure so the limits are unit tested without a DOM.

const INDENT_STEP = 12;
const ROW_INDENT_BASE = 8;
/**
 * Past this depth every row shares one indent. The cap is set so that at the narrowest supported
 * viewport (320px) the sidebar drawer (272px = 85vw) leaves at least 66px for the row title after
 * accounting for disclosure (48px), icon (20px), mobile action button (48px), gaps (12px), and
 * padding-right (6px). Maximum indent = 8 + 3*12 = 44px; title space = 272−28−44−134 = 66px.
 * Future: if the sidebar layout changes (icon size, action button size), recalculate this constant.
 */
export const MAX_INDENT_DEPTH = 3;

/**
 * The left padding of a sidebar row at `depth`, capped so a deeply nested row still has room for its
 * disclosure, icon and title instead of being pushed off the right edge of the panel.
 */
export function rowIndent(depth: number): number {
  return ROW_INDENT_BASE + Math.min(depth, MAX_INDENT_DEPTH) * INDENT_STEP;
}

/** One rendered breadcrumb entry: a page, or the gap standing in for the pages left out. */
export type BreadcrumbItem =
  { kind: 'page'; page: PageRecord } | { kind: 'gap'; hidden: PageRecord[] };

/** The most crumbs shown before the middle collapses into a gap. */
export const MAX_BREADCRUMB_CRUMBS = 4;

/**
 * Collapses the middle of a long ancestor chain so the breadcrumb stays one line: the root, a gap,
 * then the last crumbs including the current page. The current page is what tells the user where
 * they are, so it is never the part dropped.
 */
export function collapseBreadcrumb(
  chain: PageRecord[],
  maxCrumbs: number = MAX_BREADCRUMB_CRUMBS,
): BreadcrumbItem[] {
  if (chain.length <= maxCrumbs) {
    return chain.map((page) => ({ kind: 'page', page }));
  }
  // One slot goes to the root and one to the gap; the rest show the tail ending at the current page.
  const tailCount = maxCrumbs - 2;
  const root = chain[0]!;
  const tail = chain.slice(chain.length - tailCount);
  const hidden = chain.slice(1, chain.length - tailCount);
  return [
    { kind: 'page', page: root },
    { kind: 'gap', hidden },
    ...tail.map((page) => ({ kind: 'page', page }) as BreadcrumbItem),
  ];
}
