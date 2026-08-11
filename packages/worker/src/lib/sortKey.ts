// Fractional index helpers. A sort_key is only meaningful if the fractional-indexing library can
// parse it: an unparseable key stored in a row makes every later key generation for that parent
// throw, which is why keys are validated on the way in and tolerated defensively on the way out.
import { generateKeyBetween } from 'fractional-indexing';

// True when key is a fractional index the library can extend. There is no exported validator, so
// the check is "can a key be generated after it", which is exactly the operation that must not throw
// later.
export function isValidSortKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

// The next key after last (null for the first child). Any unparseable value is treated as no key at
// all rather than throwing: a row with a bad sort_key predates the validation added for DEF-003 and
// must not be able to block creation.
export function nextKeyAfter(last: string | null): string {
  if (last !== null && !isValidSortKey(last)) return generateKeyBetween(null, null);
  return generateKeyBetween(last, null);
}

// Anything ordered by a fractional index: pages among their siblings, blocks within a page.
export type Ordered = { id: string; sortKey: string };

// The total order for ordered rows: sort_key first, then id as the tiebreak. The tiebreak is what
// makes duplicate keys harmless rather than impossible (DEF-016): two concurrent requests that append
// with no sortKey each compute their key from the state they read, so they can legitimately mint the
// same one, and serialising every write to prevent that would cost throughput on all of them. Since id
// is a stable uuid, every reader - the SQL ORDER BY, the applier's notion of "last", and the client -
// resolves the collision to the same order.
export function compareOrder(a: Ordered, b: Ordered): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

// The greatest row under compareOrder among those with a usable key, or null when there is none.
// Invalid stored keys are skipped: a poisoned row must not block later creates under the same parent
// (DEF-003), and such a key sorts arbitrarily so it is no use as an upper bound.
export function lastInOrder(rows: Iterable<Ordered>): Ordered | null {
  let last: Ordered | null = null;
  for (const row of rows) {
    if (!isValidSortKey(row.sortKey)) continue;
    if (last === null || compareOrder(row, last) > 0) last = row;
  }
  return last;
}
