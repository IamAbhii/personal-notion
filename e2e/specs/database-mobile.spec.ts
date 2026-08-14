/**
 * Phase 3 — mobile layout and touch target checks for the database surfaces.
 *
 * Mobile-specific tests (those that use tap() or check touch targets) run only in the
 * mobile-chrome project (Pixel 5, 393x851). They are skipped in the desktop chromium project via
 * test.skip({ isMobile }) — isMobile is true only when the project preset is a mobile device.
 *
 * The 320px overflow test creates its own narrow viewport via page.setViewportSize and can run in
 * any project.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Database surfaces — 320px overflow', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('database landing page has no horizontal overflow at 320px', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Narrow to 320px — the absolute minimum we must support.
    await page.setViewportSize({ width: 320, height: 640 });
    // Give the page a moment to reflow.
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const { scrollWidth, clientWidth } = document.documentElement;
      return { scrollWidth, clientWidth, overflows: scrollWidth > clientWidth };
    });

    expect(overflow.overflows).toBe(false);
  });
});

test.describe('Database surfaces — mobile touch', () => {
  // Skip this whole group in the desktop chromium project. isMobile is true only in the
  // mobile-chrome project (Pixel 5 device preset).
  test.skip(({ isMobile }) => !isMobile, 'Mobile-only tests — run in mobile-chrome project');

  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('sidebar opens via the mobile navigation toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // On mobile the sidebar is a drawer. The toggle has aria-label="Open navigation".
    const menuBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.tap();
    await page.waitForLoadState('networkidle');

    // After opening, the sidebar should be visible.
    const sidebar = page.getByTestId('sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('can create a database by tapping the "New database" button on mobile', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open the sidebar drawer.
    const menuBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.tap();
    await page.waitForLoadState('networkidle');

    const before = page.url().match(/\/page\/([^/]+)/)?.[1];

    // Tap "New database" in the sidebar footer.
    const newDbBtn = page.getByTestId('new-database-bottom');
    await expect(newDbBtn).toBeVisible();
    await newDbBtn.tap();

    await page.waitForURL(
      (url) => {
        const m = url.pathname.match(/\/page\/([^/]+)/);
        return !!m && m[1] !== before;
      },
      { timeout: 10000 },
    );
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('database-view')).toBeVisible();
  });

  test('sidebar page-row touch targets are at least 48px high', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar.
    const menuBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.tap();
    await page.waitForLoadState('networkidle');

    const pageTitles = page.getByTestId('sidebar').getByTestId('page-row-title');
    const count = await pageTitles.count();

    const undersize: Array<{ title: string; height: number; width: number }> = [];
    for (let i = 0; i < Math.min(count, 8); i++) {
      const el = pageTitles.nth(i);
      const box = await el.boundingBox();
      if (box && box.height < 48) {
        const title = (await el.textContent()) ?? `row ${i}`;
        undersize.push({ title, height: box.height, width: box.width });
      }
    }

    expect(undersize).toHaveLength(0);
  });

  test('the "Add row" button on the database view is at least 48px tall', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open sidebar and navigate to Work Projects.
    const menuBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.tap();
    await page.waitForLoadState('networkidle');

    const workProjectsLink = page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' });
    await expect(workProjectsLink).toBeVisible({ timeout: 5000 });
    await workProjectsLink.tap();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('database-view')).toBeVisible();

    const addRowBtn = page.getByTestId('add-row-btn');
    const box = await addRowBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(48);
  });

  test('no horizontal overflow at 320px via setViewportSize', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to a database page so the table view is rendered.
    const menuBtn = page.getByRole('button', { name: 'Open navigation' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.tap();
    await page.waitForLoadState('networkidle');

    const workProjectsLink = page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' });
    await expect(workProjectsLink).toBeVisible({ timeout: 5000 });
    await workProjectsLink.tap();
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('database-view')).toBeVisible();

    // Narrow to 320px and check overflow.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForTimeout(300);

    const overflow = await page.evaluate(() => {
      const { scrollWidth, clientWidth } = document.documentElement;
      return { scrollWidth, clientWidth, overflows: scrollWidth > clientWidth };
    });

    // If the table overflows horizontally at 320px the overflow.x-auto wrapper should contain it
    // — i.e. the document itself must not overflow.
    expect(overflow.overflows).toBe(false);
  });
});
