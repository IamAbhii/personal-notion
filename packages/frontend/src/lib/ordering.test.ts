import { describe, expect, it } from 'vitest';
import { bySortKeyThenId } from './ordering';

// Duplicate sort keys really occur: two concurrent appends can compute the same key, and the server
// resolves the tie by id. The client must resolve it the same way rather than relying on the
// stability of Array.prototype.sort over whatever order the snapshot happened to arrive in.

describe('bySortKeyThenId', () => {
  it('orders by the fractional key first', () => {
    expect(bySortKeyThenId({ id: 'z', sortKey: 'a0' }, { id: 'a', sortKey: 'a1' })).toBeLessThan(0);
    expect(bySortKeyThenId({ id: 'a', sortKey: 'a1' }, { id: 'z', sortKey: 'a0' })).toBeGreaterThan(
      0,
    );
  });

  it('breaks a tie on the id, the way the server does', () => {
    expect(
      bySortKeyThenId({ id: 'aaa', sortKey: 'a1' }, { id: 'bbb', sortKey: 'a1' }),
    ).toBeLessThan(0);
    expect(
      bySortKeyThenId({ id: 'bbb', sortKey: 'a1' }, { id: 'aaa', sortKey: 'a1' }),
    ).toBeGreaterThan(0);
  });

  it('reports the same record as equal to itself', () => {
    expect(bySortKeyThenId({ id: 'a', sortKey: 'a1' }, { id: 'a', sortKey: 'a1' })).toBe(0);
  });
});
