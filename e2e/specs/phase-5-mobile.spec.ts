/**
 * Phase 5 — mobile tests for the theme toggle and the search button.
 *
 * Driven by the mobile-chrome Playwright project (Pixel 5: 393x851, hasTouch).
 * Uses tap() rather than click() to exercise the touch path.
 *
 * Coverage:
 * - The theme toggle is visible and reachable inside the sidebar drawer on mobile.
 * - The sidebar footer (containing the toggle) is within the viewport when the drawer is open.
 * - The search button in the mobile topbar opens the quick-find dialog via tap.
 * - No horizontal overflow at 320px with the quick-find dialog open.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

const SCREENSHOTS = '/Users/abhijeet.brahmbhatt/Documents/Repos/personal-notion/screenshots';

test.describe('Phase 5 — mobile search and theme (Pixel 5)', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // ── Theme toggle reachable in sidebar drawer ──────────────────────────────
  // This test pins the regression from phase 5: the sidebar needed h-dvh so that the footer
  // (and the theme toggle inside it) stays within the viewport and is not scrolled off.
  test('theme toggle is visible inside the sidebar drawer on mobile', async ({ page }) => {
    // Open the sidebar drawer.
    const openNavBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(openNavBtn).toBeVisible({ timeout: 5000 });
    await openNavBtn.tap();
    await page.waitForTimeout(300);

    // The sidebar must be visible (the drawer slid in).
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 5000 });

    // Find the theme toggle button inside the sidebar.
    const themeToggle = page.getByRole('button', {
      name: /switch to (dark|light) theme/i,
    });
    await expect(themeToggle).toBeVisible({ timeout: 5000 });

    // The toggle's bounding box must be within the visible viewport, not scrolled off below.
    const box = await themeToggle.boundingBox();
    const viewportSize = page.viewportSize();
    console.log(
      `MOBILE-TOGGLE: box y=${box?.y?.toFixed(0)} bottom=${(box ? box.y + box.height : 0).toFixed(0)}, viewport height=${viewportSize?.height}`,
    );
    expect(box).toBeTruthy();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewportSize!.height + 1); // +1 for sub-pixel rounding

    // Touch target: both dimensions must be at least 48px.
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    console.log(
      `MOBILE-TOGGLE: size ${box!.width.toFixed(0)}x${box!.height.toFixed(0)} (both must be ≥48px)`,
    );

    // Screenshot as evidence (mobile viewport, so device dimensions, not 1280x800).
    await page.screenshot({ path: `${SCREENSHOTS}/phase-5-mobile-sidebar-theme.png` });
  });

  // ── Theme toggle works via tap ────────────────────────────────────────────
  test('theme toggle: tap toggles data-theme on mobile', async ({ page }) => {
    // Open sidebar drawer.
    await page.getByRole('button', { name: 'Open navigation' }).tap();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: 5000 });

    const initialTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log(`MOBILE-THEME: initial data-theme="${initialTheme}"`);

    const themeToggle = page.getByRole('button', {
      name: /switch to (dark|light) theme/i,
    });
    await expect(themeToggle).toBeVisible({ timeout: 5000 });
    await themeToggle.tap();
    await page.waitForTimeout(200);

    const newTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    console.log(`MOBILE-THEME: data-theme after tap="${newTheme}"`);
    expect(newTheme).not.toBe(initialTheme);
  });

  // ── Search button in mobile topbar opens quick-find via tap ──────────────
  test('mobile topbar: search button opens quick-find via tap', async ({ page }) => {
    // The mobile topbar search button is always visible on mobile — no drawer needed.
    // exact: true distinguishes the topbar "Search" button (aria-label="Search") from the
    // sidebar "Search pages" button which is hidden/inert but still in the DOM.
    const searchBtn = page.getByRole('button', { name: 'Search', exact: true });
    await expect(searchBtn).toBeVisible({ timeout: 5000 });

    // Touch target.
    const box = await searchBtn.boundingBox();
    console.log(
      `MOBILE-SEARCH: search button size ${box?.width?.toFixed(0)}x${box?.height?.toFixed(0)}`,
    );
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);

    await searchBtn.tap();
    await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('quickfind-input')).toBeFocused();
  });

  // ── No horizontal overflow at 320px with quick-find open ──────────────────
  test('no horizontal overflow at 320px with quick-find open', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });

    // Open quick-find via the search button in the topbar (exact: true to avoid matching
    // the sidebar "Search pages" button which is still in the DOM but inert/hidden).
    const searchBtn = page.getByRole('button', { name: 'Search', exact: true });
    await expect(searchBtn).toBeVisible({ timeout: 5000 });
    await searchBtn.click();
    await expect(page.getByTestId('quickfind-dialog')).toBeVisible({ timeout: 5000 });

    // Type a query to show results.
    await page.getByTestId('quickfind-input').fill('journal');
    await page.waitForTimeout(100);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(
      `NO-OVERFLOW-320: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`,
    );
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  });
});
