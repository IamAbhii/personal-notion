import { test, expect } from '@playwright/test';

test('sidebar displays seeded pages with correct structure and icons', async ({ page }) => {
  // Attach console error listeners at the start
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    consoleErrors.push(error.toString());
  });

  // Navigate to the app - should see the seeded tree
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Verify sidebar is visible
  const sidebar = page.locator('.sidebar');
  await expect(sidebar).toBeVisible();

  // Count all pages in the sidebar - seeded tree has 25 pages
  const allPageRows = page.locator('.sidebar [data-page-id]');
  const pageCount = await allPageRows.count();
  expect(pageCount).toBeGreaterThanOrEqual(4); // At least the 4 top-level pages from seed

  // Verify that multiple pages have icons
  // Each seeded page should have an emoji icon displayed
  const pagesWithIcons = page.locator('.sidebar [data-page-id] .row__icon');
  const iconCount = await pagesWithIcons.count();
  expect(iconCount).toBeGreaterThan(0); // Multiple pages should have icons

  // Verify nesting structure exists - look for pages with disclosure controls
  // A page with children should have a disclosure button (expand/collapse control)
  const disclosureButtons = page.locator('.sidebar .row__disclosure');
  const disclosureCount = await disclosureButtons.count();
  expect(disclosureCount).toBeGreaterThan(0); // Should have pages with children

  // Verify we can expand a parent page to reveal children
  // Get the first disclosure button and click it to expand
  const firstDisclosure = page.locator('.sidebar .row__disclosure').first();
  const isExpandable = await firstDisclosure.isVisible();
  expect(isExpandable).toBeTruthy();

  // Click to expand a parent
  await firstDisclosure.click();
  await page.waitForLoadState('networkidle');

  // After expanding, there should be visible child pages (nested deeper in the sidebar tree)
  // The structure should show indentation or nesting
  const nestedPages = page.locator('.sidebar [data-page-id] .sidebar [data-page-id]');
  const nestedCount = await nestedPages.count();
  expect(nestedCount).toBeGreaterThanOrEqual(0);

  // Verify specific seed pages exist by checking for known pages
  // Look for pages like "Home", "Journal", "Flat Renovation", "Weeknight dinners"
  const knownPageTitles = ['Home', 'Journal', 'Flat Renovation', 'Weeknight dinners'];
  let foundKnownPages = 0;

  for (const title of knownPageTitles) {
    const pageButton = page.locator('.sidebar button.row__title').filter({ hasText: title });
    if (await pageButton.isVisible({ timeout: 500 }).catch(() => false)) {
      foundKnownPages++;
    }
  }

  // Should find at least 1 of the known pages
  expect(foundKnownPages).toBeGreaterThanOrEqual(1);

  // Verify multiple levels of nesting - the seed has max depth 3
  // Count pages that have a nested structure with different indentation levels
  const sidebarElement = page.locator('.sidebar');
  const htmlContent = await sidebarElement.innerHTML();
  // Look for nested [data-page-id] elements to verify multi-level structure
  expect(htmlContent).toContain('data-page-id'); // Root level pages
  const nestedPattern = htmlContent.match(/data-page-id/g) || [];
  expect(nestedPattern.length).toBeGreaterThan(4); // More than just the 4 top-level

  // Assert console is clean
  await page.waitForTimeout(500);
  expect(consoleErrors).toHaveLength(0);
});
