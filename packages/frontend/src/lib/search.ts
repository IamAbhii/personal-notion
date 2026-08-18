import type { PageKind, PageRecord } from '../api/types';

/** One result from a workspace quick-find search. */
export interface SearchResult {
  pageId: string;
  title: string;
  kind: PageKind;
  /**
   * For row pages: the title of the parent database, shown as context so the user knows which
   * database the row belongs to without opening it.
   */
  parentTitle?: string;
}

/**
 * Searches the workspace page list by title using case-insensitive substring matching.
 * Prefix matches are ranked above mid-string matches so the most likely target comes first.
 * Within each rank tier the results are sorted alphabetically by title.
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

  const lower = q.toLowerCase();

  // Build a quick id-to-title lookup for parent-name context on row results.
  const titleById = new Map<string, string>(pages.map((p) => [p.id, p.title]));

  const hits: Array<SearchResult & { rank: number }> = [];

  for (const page of pages) {
    const titleLower = page.title.toLowerCase();
    const idx = titleLower.indexOf(lower);
    if (idx === -1) continue;

    // Rank 0 = query appears at the start of the title (prefix match, most relevant).
    // Rank 1 = query appears elsewhere in the title.
    const rank = idx === 0 ? 0 : 1;

    const parentTitle =
      page.kind === 'row' && page.parentId != null ? titleById.get(page.parentId) : undefined;

    hits.push({ pageId: page.id, title: page.title, kind: page.kind, parentTitle, rank });
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title);
  });

  return hits;
}
