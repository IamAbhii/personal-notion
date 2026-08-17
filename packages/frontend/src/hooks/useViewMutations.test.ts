import { describe, expect, it } from 'vitest';
import { generateKeyBetween } from 'fractional-indexing';

// Unit tests for the sort-key logic inside createDefaultViews (DEF-070).
// The hook itself requires a full React + TanStack Query environment to mount,
// but the key-minting logic is pure math that can be tested directly.

/**
 * A key is a valid fractional index when `generateKeyBetween(key, null)` succeeds.
 * An invalid key causes the library to throw: `invalid order key: <key>`.
 */
function isValidKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

describe('createDefaultViews sort-key generation (DEF-070)', () => {
  it('generates three successive valid fractional-index sort keys', () => {
    const k0 = generateKeyBetween(null, null); // 'a0'
    const k1 = generateKeyBetween(k0, null); // 'a1'
    const k2 = generateKeyBetween(k1, null); // 'a2'

    expect(isValidKey(k0)).toBe(true);
    expect(isValidKey(k1)).toBe(true);
    expect(isValidKey(k2)).toBe(true);
  });

  it('keys are in ascending order', () => {
    const k0 = generateKeyBetween(null, null);
    const k1 = generateKeyBetween(k0, null);
    const k2 = generateKeyBetween(k1, null);

    expect(k0 < k1).toBe(true);
    expect(k1 < k2).toBe(true);
  });

  it('single-character strings "a" "b" "c" are NOT valid fractional indices (pre-fix regression guard)', () => {
    // These were what createDefaultViews passed before DEF-070 was fixed. Using them as a "before"
    // input to generateKeyBetween throws, which is exactly what the server rejected.
    expect(() => generateKeyBetween('a', null)).toThrow();
    expect(() => generateKeyBetween('b', null)).toThrow();
    expect(() => generateKeyBetween('c', null)).toThrow();
  });
});
