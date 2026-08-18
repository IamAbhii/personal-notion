import type { PageKind, PageRecord } from '../api/types';

/** One result from a workspace quick-find search. */
export interface SearchResult {
  pageId: string;
  title: string;
  kind: PageKind;
  /** The page's emoji icon, shown in the result row to match the sidebar and breadcrumb. */
  icon: string;
  /**
   * For row pages: the title of the parent database, shown so the user knows which database the
   * row belongs to. For nested pages: the title of the parent page, so identically-named pages can
   * be told apart. Undefined for top-level pages.
   */
  parentTitle?: string;
}

/**
 * Normalises a string for accent-insensitive, case-insensitive substring matching: converts to NFD
 * form, strips Unicode combining marks (category Mn), and lower-cases the result. This lets "cafe"
 * match "Café" and "istanbul" match "İstanbul".
 */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

/**
 * Searches the workspace page list by title using case-insensitive, accent-insensitive substring
 * matching. Prefix matches are ranked above mid-string matches so the most likely target comes
 * first. Within each rank tier the results are sorted alphabetically by title.
 *
 * Pure and side-effect-free: safe to call on every keystroke without debouncing.
 *
 * Future: when a workspace grows past a few thousand pages, replace this linear O(n) scan with
 * an in-memory inverted index (e.g. FlexSearch or Orama) built once when the snapshot loads and
 * invalidated on each snapshot refresh. The public signature can stay the same; only the body
 * changes.
 *
 * @param pages  The flat page list from the workspace snapshot.
 * @param query  The raw user input string. An empty or whitespace-only query returns [].
 */
export function searchWorkspace(pages: PageRecord[], query: string): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const normQ = normalise(q);

  // Build a quick id-to-title lookup for parent-name context on row and nested page results.
  const titleById = new Map<string, string>(pages.map((p) => [p.id, p.title]));

  const hits: Array<SearchResult & { rank: number }> = [];

  for (const page of pages) {
    const normTitle = normalise(page.title);
    const idx = normTitle.indexOf(normQ);
    if (idx === -1) continue;

    // Rank 0 = query appears at the start of the title (prefix match, most relevant).
    // Rank 1 = query appears elsewhere in the title.
    const rank = idx === 0 ? 0 : 1;

    // Row pages show the parent database; nested pages show the parent page. Top-level pages
    // (parentId is null) receive no context since there is nothing to distinguish.
    const parentTitle = page.parentId != null ? titleById.get(page.parentId) : undefined;

    hits.push({
      pageId: page.id,
      title: page.title,
      kind: page.kind,
      icon: page.icon,
      parentTitle,
      rank,
    });
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title);
  });

  return hits;
}
