/** Anything the snapshot orders: pages and blocks both carry a fractional key and an id. */
export interface Ordered {
  id: string;
  sortKey: string;
}

/**
 * The one ordering used everywhere the client sorts pages or blocks: fractional key first, then id.
 *
 * The id tiebreak matters because duplicate sort keys really do occur - two concurrent appends can
 * compute the same key - and the server orders by `(sort_key, id)`. Returning 0 on a tie agreed with
 * the server only by accident, through `Array.prototype.sort` being stable and the snapshot arriving
 * in the server's order; a locally created block that tied would sit in insertion order until the
 * next snapshot reshuffled it under the user's cursor. Comparing ids makes the two agree by
 * construction.
 */
export function bySortKeyThenId(a: Ordered, b: Ordered): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
