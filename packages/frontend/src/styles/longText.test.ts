import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// A 500-character title is layout, not markup: nothing in the DOM says whether it wraps. The tests
// run with CSS off, so the rules that bound it are asserted against the stylesheet itself (DEF-008).

// The suite is run both from the package and from the repo root, and import.meta.url is not a file
// URL under Vite, so the stylesheet is found by trying both relative paths.
const candidates = ['src/styles/app.css', 'packages/frontend/src/styles/app.css'].map((path) =>
  resolve(process.cwd(), path),
);
const css = readFileSync(
  candidates.find((path) => existsSync(path))!,
  'utf8',
);

/** The declarations inside one rule, so a property is not matched from a neighbouring block. */
function ruleBody(selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `no rule for ${selector}`).not.toBeNull();
  return match![1]!;
}

describe('a very long title', () => {
  it('wraps in the page header, including a title with no spaces to break at', () => {
    // 500 characters at 42px is around 14,000px on one line; the column is 860px and does not scroll.
    expect(ruleBody('.page__title')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(ruleBody('.page__title-button')).toMatch(/overflow-wrap:\s*anywhere/);
    // The button is inline by default, which would let it exceed the column it sits in.
    expect(ruleBody('.page__title-button')).toMatch(/max-width:\s*100%/);
  });

  it('is clipped in the breadcrumb rather than widening the top bar', () => {
    expect(ruleBody('.breadcrumb__label')).toMatch(/text-overflow:\s*ellipsis/);
    expect(ruleBody('.breadcrumb__label')).toMatch(/max-width:/);
  });

  it('cannot make the breadcrumb wrap out of the fixed-height top bar', () => {
    expect(ruleBody('.breadcrumb')).toMatch(/flex-wrap:\s*nowrap/);
    expect(ruleBody('.breadcrumb')).toMatch(/overflow:\s*hidden/);
  });
});
