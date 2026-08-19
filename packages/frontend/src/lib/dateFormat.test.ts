import { describe, expect, it } from 'vitest';
import { parseDateString, formatDateString } from './dateFormat';

describe('parseDateString', () => {
  it('returns undefined for null', () => {
    expect(parseDateString(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(parseDateString(undefined)).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(parseDateString('')).toBeUndefined();
  });

  it('parses a valid YYYY-MM-DD string into a Date at local midnight', () => {
    const d = parseDateString('2026-09-15');
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(8); // 0-indexed
    expect(d!.getDate()).toBe(15);
  });

  it('returns undefined when the string does not have three dash-separated parts', () => {
    // This covers the `parts.length !== 3` early return (line 8 of dateFormat.ts).
    expect(parseDateString('not-a-valid-iso')).toBeUndefined();
    expect(parseDateString('20260915')).toBeUndefined();
  });

  it('returns undefined when the parts are non-numeric (NaN path)', () => {
    // 'abc-def-ghi' has 3 dash-separated parts so it passes the length check; Number('abc')
    // is NaN so new Date(NaN, …) is invalid. This covers the Number.isNaN branch (line 13).
    expect(parseDateString('abc-def-ghi')).toBeUndefined();
  });
});

describe('formatDateString', () => {
  it('formats a valid date in "D Mon YYYY" style', () => {
    const s = formatDateString('2026-09-01');
    expect(s).toMatch(/2026/);
    expect(s).toMatch(/Sep/i);
    expect(s).toMatch(/1/);
  });

  it('returns an empty string for invalid input', () => {
    expect(formatDateString(null)).toBe('');
    expect(formatDateString('bad')).toBe('');
  });
});
