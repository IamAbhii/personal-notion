import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('changes persist after browser reload', async ({ page }) => {
  // Attach console error listeners at the start, before any navigation
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    consoleErrors.push(error.toString());
  });

  // Navigate to the app
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Create a new page
  const createButton = page.getByRole('button', { name: 'Add a top-level page' });
  await expect(createButton).toBeVisible();

  // Capture the current page ID before clicking
  const pageIdBeforeMatch = page.url().match(/\/page\/([^/]+)/);
  expect(pageIdBeforeMatch).toBeTruthy();
  const pageIdBefore = pageIdBeforeMatch![1];

  await createButton.click();

  // Wait for navigation to a DIFFERENT page
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/page\/([^/]+)/);
    return !!m && m[1] !== pageIdBefore;
  });
  await page.waitForLoadState('networkidle');

  // Extract the page ID from the URL to target the specific page unambiguously
  const pageIdMatch = page.url().match(/\/page\/([^/]+)/);
  expect(pageIdMatch).toBeTruthy();
  const pageId = pageIdMatch![1];

  // Assert that the created page is new (different from the seed page we started with)
  expect(pageId).not.toBe(pageIdBefore);

  // Rename the page to make it identifiable - use sidebar rename with data-page-id (within sidebar only)
  const sidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${pageId}"]`);
  await expect(sidebarRow).toBeVisible();
  // Target the rename action button via its stable data-testid.
  // The desktop actions container is pointer-events-none until the row is hovered;
  // hover the row first so the buttons become pointer-interactive.
  const sidebarRenameButton = sidebarRow.locator('[data-testid="page-rename"]').first();
  await expect(sidebarRenameButton).toBeVisible();
  await sidebarRow.hover();
  await sidebarRenameButton.click();

  const timestamp = Date.now();
  const pageName = `Persist Test ${timestamp}`;
  const renameInput = sidebarRow.getByRole('textbox');
  await expect(renameInput).toBeVisible();
  await renameInput.clear();
  await renameInput.fill(pageName);
  await renameInput.press('Enter');

  // Wait for the input to disappear and the mutation to complete
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Verify page appears in sidebar
  const newPageInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: pageName });
  await expect(newPageInSidebar).toBeVisible();

  // Reload the page
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Verify the page still appears in sidebar after reload
  const pageAfterReload = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: pageName });
  await expect(pageAfterReload).toBeVisible();

  // Verify URL structure is preserved
  const urlAfterReload = page.url();
  expect(urlAfterReload).toMatch(/\/w\/[^/]+\/page\/[^/]+/);
  // URLs should match structure even if content differs
  expect(urlAfterReload).toContain('/w/');
  expect(urlAfterReload).toContain('/page/');

  // Verify the page header also shows the renamed title
  const pageHeader = page.locator('[data-testid="page-title"]');
  await expect(pageHeader).toContainText(pageName);

  // Assert console is clean
  await page.waitForTimeout(500);
  expect(consoleErrors).toHaveLength(0);
});
