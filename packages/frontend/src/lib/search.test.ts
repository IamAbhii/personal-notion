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
    expect(results[0]!.pageId).toBe('db1');
    expect(results[0]!.kind).toBe('database');
  });

  it('matches row titles', () => {
    const results = searchWorkspace(pages, 'bug');
    expect(results).toHaveLength(1);
    expect(results[0]!.pageId).toBe('r1');
    expect(results[0]!.kind).toBe('row');
  });

  it('result includes the pageId, title, kind and icon', () => {
    const result = searchWorkspace(pages, 'roadmap')[0]!;
    expect(result.pageId).toBe('p2');
    expect(result.title).toBe('Project Roadmap');
    expect(result.kind).toBe('page');
    expect(typeof result.icon).toBe('string');
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
      expect(midResults[i - 1]!.title.localeCompare(midResults[i]!.title)).toBeLessThanOrEqual(0);
    }
    void prefixResults; // not relevant for this assertion
  });
});

describe('searchWorkspace: row parent context', () => {
  it('includes parentTitle for row pages', () => {
    const result = searchWorkspace(pages, 'Fix login')[0]!;
    expect(result.kind).toBe('row');
    expect(result.parentTitle).toBe('Tasks');
  });

  it('includes undefined parentTitle for top-level non-row pages', () => {
    const result = searchWorkspace(pages, 'meeting')[0]!;
    expect(result.kind).toBe('page');
    expect(result.parentTitle).toBeUndefined();
  });

  it('handles a row with no matching parent gracefully', () => {
    const orphanPages = [
      makePage({ id: 'r99', title: 'Orphan row', kind: 'row', parentId: 'missing' }),
    ];
    const result = searchWorkspace(orphanPages, 'orphan')[0]!;
    expect(result.parentTitle).toBeUndefined();
  });
});

describe('searchWorkspace: parent context for nested pages', () => {
  it('includes parentTitle for a nested page', () => {
    const nested: PageRecord[] = [
      makePage({ id: 'parent-page', title: 'Weekly Review', kind: 'page' }),
      makePage({
        id: 'child-page',
        title: 'Week 32',
        kind: 'page',
        parentId: 'parent-page',
      }),
    ];
    const result = searchWorkspace(nested, 'Week 32')[0]!;
    expect(result.kind).toBe('page');
    expect(result.parentTitle).toBe('Weekly Review');
  });

  it('does not include parentTitle for top-level pages', () => {
    const result = searchWorkspace(pages, 'roadmap')[0]!;
    expect(result.parentTitle).toBeUndefined();
  });
});

describe('searchWorkspace: Unicode folding', () => {
  it('"cafe" matches "Café notes"', () => {
    const accented: PageRecord[] = [makePage({ id: 'c1', title: 'Café notes', kind: 'page' })];
    const results = searchWorkspace(accented, 'cafe');
    expect(results).toHaveLength(1);
    expect(results[0]!.pageId).toBe('c1');
  });

  it('"istanbul" matches "İstanbul guide"', () => {
    const turkish: PageRecord[] = [makePage({ id: 't1', title: 'İstanbul guide', kind: 'page' })];
    const results = searchWorkspace(turkish, 'istanbul');
    expect(results).toHaveLength(1);
    expect(results[0]!.pageId).toBe('t1');
  });

  it('case-only matches still work alongside accent folding', () => {
    const accented: PageRecord[] = [makePage({ id: 'c2', title: 'Résumé', kind: 'page' })];
    expect(searchWorkspace(accented, 'resume')).toHaveLength(1);
    expect(searchWorkspace(accented, 'Résumé')).toHaveLength(1);
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
