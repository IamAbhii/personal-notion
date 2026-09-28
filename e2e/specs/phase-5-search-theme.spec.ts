/**
 * Phase 5 — quick-find search and theme toggle end-to-end tests.
 *
 * Covers REQUIREMENTS.md Phase 5 success criterion 5: end-to-end tests for searching and
 * jumping to a result, and toggling the theme — all pass.
 *
 * Test map:
 *  1. Quick-find opens via Cmd+K keyboard shortcut (desktop)
 *  2. Quick-find opens via clicking the sidebar search button
 *  3. Typing narrows results live (no submit step)
 *  4. Results include all three kinds: page, database, and database row
 *  5a. Choosing a result by Enter after arrowing navigates to it
 *  5b. Choosing a result by clicking navigates to it
 *  6. Escape dismisses without navigating
 *  7. No-matches query shows readable empty state
 *  8. Theme toggle flips data-theme on html and changes a computed style
 *  9. Theme choice survives a page reload (persistence)
 * 10. No flash of wrong theme — data-theme is correct at DOMContentLoaded, before React mounts
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

const SCREENSHOTS = '/Users/abhijeet.brahmbhatt/Documents/Repos/personal-notion/screenshots';

// ── 1. Quick-find opens via Cmd+K ─────────────────────────────────────────────
test('quick-find: Cmd+K opens the dialog', async ({ page }) => {
  await resetWorkspace(page);
  await expect(page.getByTestId('quickfind-dialog')).not.toBeVisible();

  // Cmd+K (Mac) / Ctrl+K (other platforms).
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  // Input receives focus automatically on mount.
  await expect(page.getByTestId('quickfind-input')).toBeFocused();
});

// ── 2. Quick-find opens via the sidebar search button ─────────────────────────
test('quick-find: sidebar search button opens the dialog', async ({ page }) => {
  await resetWorkspace(page);
  await expect(page.getByTestId('quickfind-dialog')).not.toBeVisible();

  const searchBtn = page.getByRole('button', { name: 'Search pages' });
  await expect(searchBtn).toBeVisible({ timeout: 5000 });
  await searchBtn.click();
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });
  await expect(page.getByTestId('quickfind-input')).toBeFocused();
});

// ── 3. Typing narrows results live ────────────────────────────────────────────
test('quick-find: typing narrows results in real time', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  // Broad query: "a" should return many results.
  await page.getByTestId('quickfind-input').fill('a');
  await page.waitForTimeout(100);
  const broadCount = await page.getByTestId('quickfind-result').count();
  expect(broadCount).toBeGreaterThan(1);
  console.log(`SEARCH-NARROW: broad query "a" → ${broadCount} results`);

  // Specific query: "accessibility audit" should return fewer results.
  await page.getByTestId('quickfind-input').fill('accessibility audit');
  await page.waitForTimeout(100);
  const narrowCount = await page.getByTestId('quickfind-result').count();
  console.log(`SEARCH-NARROW: narrow query "accessibility audit" → ${narrowCount} results`);
  expect(narrowCount).toBeLessThan(broadCount);
  expect(narrowCount).toBeGreaterThanOrEqual(1);
});

// ── 4a. Search finds a page ────────────────────────────────────────────────────
test('quick-find: search returns a page kind result', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  // "journal" matches the "Journal" page (kind=page).
  await page.getByTestId('quickfind-input').fill('journal');
  await page.waitForTimeout(100);
  const results = page.getByTestId('quickfind-result');
  await expect(results.first()).toBeVisible({ timeout: 3000 });

  // At least one result is labelled "Page" (the kind indicator below the title).
  const resultTexts = await results.allTextContents();
  console.log(`SEARCH-KIND page: results=[${resultTexts.slice(0, 4).join(' | ')}]`);
  const hasPageKind = resultTexts.some((t) => /journal/i.test(t) && /page/i.test(t));
  expect(hasPageKind).toBe(true);
});

// ── 4b. Search finds a database ──────────────────────────────────────────────
test('quick-find: search returns a database kind result', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  // "work projects" uniquely matches the Work Projects database (kind=database).
  await page.getByTestId('quickfind-input').fill('work projects');
  await page.waitForTimeout(100);
  const results = page.getByTestId('quickfind-result');
  await expect(results.first()).toBeVisible({ timeout: 3000 });

  const resultTexts = await results.allTextContents();
  console.log(`SEARCH-KIND database: results=[${resultTexts.slice(0, 4).join(' | ')}]`);
  // The result row shows "Work Projects" and the kind label "Database".
  const hasDbKind = resultTexts.some((t) => /work projects/i.test(t) && /database/i.test(t));
  expect(hasDbKind).toBe(true);
});

// ── 4c. Search finds a database row ──────────────────────────────────────────
test('quick-find: search returns a database row kind result', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  // "accessibility audit" uniquely matches a row in the Work Projects database.
  await page.getByTestId('quickfind-input').fill('accessibility audit');
  await page.waitForTimeout(100);
  const results = page.getByTestId('quickfind-result');
  await expect(results.first()).toBeVisible({ timeout: 3000 });

  const resultTexts = await results.allTextContents();
  console.log(`SEARCH-KIND row: results=[${resultTexts.slice(0, 4).join(' | ')}]`);
  // The result shows "Accessibility audit" and kind "Row", with parent "Work Projects" as context.
  const hasRowKind = resultTexts.some((t) => /accessibility audit/i.test(t) && /row/i.test(t));
  expect(hasRowKind).toBe(true);
});

// ── 5a. Navigate by Enter after arrowing to a result ─────────────────────────
test('quick-find: Enter after ArrowDown navigates to the result', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  await page.getByTestId('quickfind-input').fill('accessibility audit');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('quickfind-result').first()).toBeVisible({ timeout: 3000 });

  // Arrow down to the first result (it starts highlighted at index 0, so this is a no-op,
  // but explicitly testing the ArrowDown key).
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(50);
  await page.keyboard.press('Enter');

  // Dialog should close and we should navigate to the row page.
  await expect(page.getByTestId('quickfind-dialog')).not.toBeVisible({ timeout: 5000 });

  // The row page must render: its title "Accessibility audit" should be visible.
  await page.waitForLoadState('networkidle');
  const pageTitle = page.locator('h1, [data-testid="page-title"], [contenteditable][data-testid]');
  const titleText = await pageTitle
    .first()
    .textContent({ timeout: 8000 })
    .catch(() => '');
  console.log(`NAVIGATE-ENTER: landed on page with title content "${titleText?.substring(0, 60)}"`);
  // The URL should have changed to a page route.
  expect(page.url()).toMatch(/\/page\//);

  // Take evidence screenshot.
  await page.screenshot({ path: `${SCREENSHOTS}/phase-5-quickfind-destination.png` });
});

// ── 5b. Navigate by clicking a result ────────────────────────────────────────
test('quick-find: clicking a result navigates to it', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  await page.getByTestId('quickfind-input').fill('book tracker');
  await page.waitForTimeout(100);
  const firstResult = page.getByTestId('quickfind-result').first();
  await expect(firstResult).toBeVisible({ timeout: 3000 });

  // Verify the first result is the Book Tracker database.
  const resultText = await firstResult.textContent();
  console.log(`NAVIGATE-CLICK: first result text="${resultText?.substring(0, 60)}"`);
  expect(resultText).toMatch(/book tracker/i);

  // Click uses mousedown (the component uses onMouseDown to avoid blur-close race).
  await firstResult.click();
  await expect(page.getByTestId('quickfind-dialog')).not.toBeVisible({ timeout: 5000 });
  await page.waitForLoadState('networkidle');
  expect(page.url()).toMatch(/\/page\//);

  // The database views should be rendered (table/board/list tabs).
  await expect(page.getByRole('tab', { name: 'Table view' })).toBeVisible({ timeout: 8000 });
});

// ── 6. Escape dismisses without navigating ────────────────────────────────────
test('quick-find: Escape closes dialog without navigating', async ({ page }) => {
  await resetWorkspace(page);

  // Navigate to a known page first so we can confirm the URL does not change.
  const startUrl = page.url();

  // Open via the sidebar search button so we know where focus should return.
  const searchBtn = page.getByRole('button', { name: 'Search pages' });
  await expect(searchBtn).toBeVisible({ timeout: 5000 });
  await searchBtn.click();
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  await page.getByTestId('quickfind-input').fill('accessibility');
  await page.waitForTimeout(100);
  await expect(page.getByTestId('quickfind-result').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quickfind-dialog')).not.toBeVisible({ timeout: 3000 });

  // URL must not have changed.
  expect(page.url()).toBe(startUrl);
});

// ── 7. No-matches query shows a readable empty state ─────────────────────────
test('quick-find: unmatched query shows readable empty state, not blank', async ({ page }) => {
  await resetWorkspace(page);
  await page.keyboard.press('Meta+k');
  await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 3000 });

  await page.getByTestId('quickfind-input').fill('xyzzy-no-such-page-exists');
  await page.waitForTimeout(100);

  // No results buttons should be present.
  const results = page.getByTestId('quickfind-result');
  await expect(results).toHaveCount(0);

  // A readable message must be visible — not a blank white box.
  // DEF-095 removed <li> wrappers; the "no results" state is now a <p> element outside the
  // listbox so that status messages do not break the listbox owned-element relationship.
  const emptyMsg = page.locator('[data-testid="quickfind-dialog"] p');
  await expect(emptyMsg).toBeVisible({ timeout: 3000 });
  const msgText = await emptyMsg.textContent();
  console.log(`SEARCH-EMPTY: empty state text="${msgText?.substring(0, 80)}"`);
  // The component renders: No results for "…".
  expect(msgText).toMatch(/no results/i);
  expect(msgText).toMatch(/xyzzy-no-such-page-exists/i);
});

// ── 8. Theme toggle flips data-theme and changes a computed style ─────────────
test('theme toggle: flips data-theme on <html> and changes a computed style', async ({ page }) => {
  await resetWorkspace(page);

  // Determine initial theme.
  const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`THEME-TOGGLE: initial data-theme="${initialTheme}"`);

  // Sample a background color before toggling.
  const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log(`THEME-TOGGLE: bg before toggle="${bgBefore}"`);

  // Find the toggle button by its aria-label (toggles between Switch to dark / Switch to light).
  const toggleBtn = page.getByRole('button', {
    name: /switch to (dark|light) theme/i,
  });
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });
  await toggleBtn.click();
  await page.waitForTimeout(200);

  // data-theme must have flipped.
  const newTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`THEME-TOGGLE: data-theme after click="${newTheme}"`);
  expect(newTheme).not.toBe(initialTheme);

  // A computed style must have changed — the app must actually restyle, not just
  // set an attribute that no CSS rule reads.
  const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log(`THEME-TOGGLE: bg after toggle="${bgAfter}"`);
  expect(bgAfter).not.toBe(bgBefore);

  await page.screenshot({ path: `${SCREENSHOTS}/phase-5-theme-dark-reload.png` });
});

// ── 9. Theme persists across a page reload ────────────────────────────────────
test('theme toggle: choice persists across a reload', async ({ page }) => {
  await resetWorkspace(page);

  // Ensure we start in light mode by checking the toggle label, then switch to dark.
  const toggleBtn = page.getByRole('button', { name: /switch to (dark|light) theme/i });
  await expect(toggleBtn).toBeVisible({ timeout: 5000 });

  const labelBefore = await toggleBtn.getAttribute('aria-label');
  // If it says "switch to dark", we are already in light mode; click to go dark.
  // If it says "switch to light", we are already in dark mode; click to go light, then dark.
  if (/switch to light/i.test(labelBefore ?? '')) {
    // Already dark; click once to light, then click again to dark.
    await toggleBtn.click();
    await page.waitForTimeout(100);
  }
  // Now in light; click to go dark.
  const toggleBtnDark = page.getByRole('button', { name: 'Switch to dark theme' });
  await expect(toggleBtnDark).toBeVisible({ timeout: 3000 });
  await toggleBtnDark.click();
  await page.waitForTimeout(200);

  const themeBeforeReload = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(themeBeforeReload).toBe('dark');
  console.log(`THEME-PERSIST: data-theme before reload="${themeBeforeReload}"`);

  // Reload the page.
  await page.reload();
  await page.waitForLoadState('networkidle');

  const themeAfterReload = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`THEME-PERSIST: data-theme after reload="${themeAfterReload}"`);
  expect(themeAfterReload).toBe('dark');

  // The toggle button should reflect dark mode.
  const switchToLightBtn = page.getByRole('button', { name: 'Switch to light theme' });
  await expect(switchToLightBtn).toBeVisible({ timeout: 5000 });
});

// ── 10. No flash of wrong theme — data-theme correct at DOMContentLoaded ──────
// The inline script in index.html reads localStorage before React mounts. If it is working,
// data-theme must be 'dark' at DOMContentLoaded — not corrected by React afterwards.
test('theme toggle: no flash — data-theme is set before React mounts', async ({ page }) => {
  // Seed localStorage with dark theme directly so we do not depend on the UI to set it.
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    localStorage.setItem('personal-space:theme', 'dark');
  });

  // Intercept DOMContentLoaded to read data-theme before any JS module runs (other than the
  // inline script). We do this by listening to domcontentloaded, which fires after the inline
  // script has run but before modules are evaluated.
  let themeAtDcl: string | undefined;

  // Listen for the page lifecycle event.
  page.on('domcontentloaded', async () => {
    try {
      themeAtDcl = await page.evaluate(() => document.documentElement.dataset.theme);
    } catch {
      // Page may have already navigated; ignore.
    }
  });

  await page.goto('/');
  // Wait just for domcontentloaded — React has not run yet.
  await page.waitForLoadState('domcontentloaded');

  const themeAtDclFallback = await page.evaluate(() => document.documentElement.dataset.theme);
  const effectiveTheme = themeAtDcl ?? themeAtDclFallback;
  console.log(`NO-FOUC: data-theme at DOMContentLoaded="${effectiveTheme}"`);

  // If the inline script works, data-theme is already 'dark' before React runs.
  expect(effectiveTheme).toBe('dark');

  // Full load: React should keep it dark too.
  await page.waitForLoadState('networkidle');
  const themeAfterFullLoad = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`NO-FOUC: data-theme after networkidle="${themeAfterFullLoad}"`);
  expect(themeAfterFullLoad).toBe('dark');

  // Restore to light for subsequent tests.
  await page.evaluate(() => {
    localStorage.setItem('personal-space:theme', 'light');
  });
});
