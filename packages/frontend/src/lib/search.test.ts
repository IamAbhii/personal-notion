import { describe, expect, it } from 'vitest';
import { searchWorkspace } from './search';
import { makePage } from '../test/fixtures';
import type { PageRecord } from '../api/types';

const pages: PageRecord[] = [
  makePage({ id: 'p1', title: 'Meeting Notes', kind: 'page' }),
  makePage({ id: 'p2', title: 'Project Roadmap', kind: 'page' }),
  makePage({ id: 'db1', title: 'Tasks', kind: 'database' }),
  makePage({ id: 'r1', title: 'Fix login bug', kind: 'row', parentId: 'db1' }),
  makePage({ id: 'r2', title: 'Ship new feature', kind: 'row', parentId: 'db1' }),
  makePage({ id: 'p3', title: 'notes about the project', kind: 'page' }),
];

describe('searchWorkspace: empty/no-match cases', () => {
  it('returns [] for an empty query', () => {
    expect(searchWorkspace(pages, '')).toEqual([]);
  });

  it('returns [] for a whitespace-only query', () => {
    expect(searchWorkspace(pages, '   ')).toEqual([]);
  });

  it('returns [] when no page title matches', () => {
    expect(searchWorkspace(pages, 'xyznonexistent')).toEqual([]);
  });
});

describe('searchWorkspace: basic matching', () => {
  it('matches page titles case-insensitively', () => {
    const results = searchWorkspace(pages, 'NOTES');
    const ids = results.map((r) => r.pageId);
    expect(ids).toContain('p1');
    expect(ids).toContain('p3');
  });

  it('matches database titles', () => {
    const results = searchWorkspace(pages, 'tasks');
    expect(results).toHaveLength(1);
    expect(results[0].pageId).toBe('db1');
    expect(results[0].kind).toBe('database');
  });

  it('matches row titles', () => {
    const results = searchWorkspace(pages, 'bug');
    expect(results).toHaveLength(1);
    expect(results[0].pageId).toBe('r1');
    expect(results[0].kind).toBe('row');
  });

  it('result includes the pageId, title, and kind', () => {
    const [result] = searchWorkspace(pages, 'roadmap');
    expect(result.pageId).toBe('p2');
    expect(result.title).toBe('Project Roadmap');
    expect(result.kind).toBe('page');
  });
});

describe('searchWorkspace: ranking', () => {
  it('ranks prefix matches above mid-string matches', () => {
    // "notes" is a prefix of "notes about the project" and a mid-string hit in "Meeting Notes"
    const results = searchWorkspace(pages, 'notes');
    const ids = results.map((r) => r.pageId);
    // 'p3' starts with "notes"; 'p1' contains it in the middle
    expect(ids.indexOf('p3')).toBeLessThan(ids.indexOf('p1'));
  });

  it('sorts alphabetically within the same rank tier', () => {
    // Both "Fix login bug" and "Ship new feature" are rows; neither starts with "feature" or "bug"
    // but searching "e" hits both mid-string; the earlier in the alphabet wins
    const results = searchWorkspace(pages, 'e');
    // All have 'e' in their title; check that relative alphabetical order is maintained within same rank
    const prefixResults = results.filter((r) => r.title.toLowerCase().startsWith('e'));
    const midResults = results.filter((r) => !r.title.toLowerCase().startsWith('e'));
    // All our test pages start with other letters so they should all be mid-string hits
    expect(midResults.length).toBeGreaterThan(0);
    // Within mid-string hits, titles are alphabetically ordered
    for (let i = 1; i < midResults.length; i++) {
      expect(midResults[i - 1].title.localeCompare(midResults[i].title)).toBeLessThanOrEqual(0);
    }
    void prefixResults; // not relevant for this assertion
  });
});

describe('searchWorkspace: row parent context', () => {
  it('includes parentTitle for row pages', () => {
    const [result] = searchWorkspace(pages, 'Fix login');
    expect(result.kind).toBe('row');
    expect(result.parentTitle).toBe('Tasks');
  });

  it('includes undefined parentTitle for non-row pages', () => {
    const [result] = searchWorkspace(pages, 'meeting');
    expect(result.kind).toBe('page');
    expect(result.parentTitle).toBeUndefined();
  });

  it('handles a row with no matching parent gracefully', () => {
    const orphanPages = [
      makePage({ id: 'r99', title: 'Orphan row', kind: 'row', parentId: 'missing' }),
    ];
    const [result] = searchWorkspace(orphanPages, 'orphan');
    expect(result.parentTitle).toBeUndefined();
  });
});

describe('searchWorkspace: navigation requirements', () => {
  it('every result carries the pageId needed for navigation', () => {
    const results = searchWorkspace(pages, 'p');
    for (const result of results) {
      expect(typeof result.pageId).toBe('string');
      expect(result.pageId.length).toBeGreaterThan(0);
    }
  });
});
