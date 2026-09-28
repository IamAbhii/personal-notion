/**
 * Phase 7 mobile tests for the toggleList block.
 *
 * Runs under the `mobile-chrome` Playwright project (Pixel 5 preset, 393×851, hasTouch).
 * Covers the mobile obligations for Phase 7:
 *   - Layout at 320px — no horizontal overflow
 *   - Touch target sizes — chevron and interactive elements ≥ 48px
 *   - Tap gestures (not click) for toggle open/close
 *   - Toggle block is usable at phone viewport widths
 *
 * NOTE (DEF-108): All three tests in this file pass when run in isolation
 * (`npm run test:e2e --project=mobile-chrome`). In the full combined suite they fail with
 * ERR_CONNECTION_REFUSED because the wrangler dev server crashes before the mobile-chrome
 * project starts, after ~11 minutes of the chromium project run. The failures here are
 * blocked by DEF-108 and are not product defects in this spec.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

/** Helper: open slash menu on mobile (tap-based). */
async function openSlashMenuMobile(page: Parameters<typeof resetWorkspace>[0]) {
  const blockEditor = page.locator('[data-testid="block-editor"]');
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await firstBlock.tap();
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await page.keyboard.type('/');
  await page.waitForTimeout(400);
}

/** Helper: insert a toggleList block via the slash menu on mobile. */
async function insertToggleBlockMobile(page: Parameters<typeof resetWorkspace>[0]) {
  await openSlashMenuMobile(page);
  await page.keyboard.type('toggle');
  await page.waitForTimeout(400);
  const menuItem = page
    .locator('[data-testid="slash-menu-item"]')
    .filter({ hasText: 'Toggle list' })
    .first();
  await expect(menuItem).toBeVisible();
  await menuItem.tap();
  await page.waitForTimeout(400);
}

test.describe('toggleList block — mobile (Phase 7)', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('no horizontal overflow at 320px with a toggle present', async ({ page }) => {
    // Override to 320px narrow viewport for this specific test
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlockMobile(page);
    await page.keyboard.type('Narrow Toggle Header');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child at 320px');
    await page.waitForTimeout(300);

    // Assert no horizontal overflow
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // The toggle block must be visible
    const toggleBlock = page.locator('[data-block-type="toggleList"]');
    await expect(toggleBlock).toBeVisible();
  });

  test('chevron touch target is at least 48×48px', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlockMobile(page);
    await page.keyboard.type('Touch Target Header');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child');
    await page.waitForTimeout(300);

    const chevron = page.locator('[data-testid="block-toggle-arrow"]').first();
    const box = await chevron.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(48);
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });

  test('tap on chevron collapses and expands toggle on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlockMobile(page);
    await page.keyboard.type('Mobile Toggle');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Mobile Child');
    await page.waitForTimeout(300);

    const chevron = page.locator('[data-testid="block-toggle-arrow"]').first();
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();

    // Initially open
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(childrenContainer).toBeVisible();

    // Tap to collapse
    await chevron.tap();
    await page.waitForTimeout(300);
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await expect(childrenContainer).not.toBeVisible();

    // Tap to expand
    await chevron.tap();
    await page.waitForTimeout(300);
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(childrenContainer).toBeVisible();
  });
});
