import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('create a page from sidebar and verify it appears with correct URL', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Find and click the create top-level page button (aria-label="Add a top-level page")
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

  // Verify the URL contains the workspace-scoped page identifier
  // The URL should match the pattern /w/<workspaceId>/page/<pageId>
  const currentUrl = page.url();
  expect(currentUrl).toMatch(/\/w\/[^/]+\/page\/[^/]+/);

  // Extract the page ID and verify it's different from the starting page
  const pageIdMatch = currentUrl.match(/\/page\/([^/]+)/);
  expect(pageIdMatch).toBeTruthy();
  const newPageId = pageIdMatch![1];
  expect(newPageId).not.toBe(pageIdBefore);

  // Verify the new page appears in the sidebar with "Untitled" name
  // Select by the aria-label of the rename button to ensure we're finding the right button
  const newPageRenameButton = page.getByRole('button', { name: 'Rename Untitled' }).first();
  await expect(newPageRenameButton).toBeVisible();

  // Also verify the page title is visible in the page header
  const pageHeader = page.locator('h1.page__title');
  await expect(pageHeader).toContainText('Untitled');

  // Assert console is clean
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (error) => {
    consoleErrors.push(error.toString());
  });

  await page.waitForTimeout(500);
  expect(consoleErrors).toHaveLength(0);
});
