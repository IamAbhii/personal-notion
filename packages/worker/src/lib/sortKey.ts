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
