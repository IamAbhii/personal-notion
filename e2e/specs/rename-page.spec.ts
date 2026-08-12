import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('rename a page from sidebar and verify name updates in both sidebar and page header', async ({
  page,
}) => {
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

  // Create a new page first
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

  // Verify the page appears in sidebar as "Untitled"
  const newPageUntitledButton = page.getByRole('button', { name: 'Rename Untitled' }).first();
  await expect(newPageUntitledButton).toBeVisible();

  // Rename the page in the sidebar - use data-page-id to target the correct row (within sidebar only)
  const sidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${pageId}"]`);
  await expect(sidebarRow).toBeVisible();
  // Target the rename action button via its stable data-testid
  const sidebarRenameButton = sidebarRow.locator('[data-testid="page-rename"]').first();
  await expect(sidebarRenameButton).toBeVisible();
  await sidebarRenameButton.click();

  // Get the rename input - it appears in the sidebar row after clicking the rename button
  const renameInput = sidebarRow.getByRole('textbox');
  await expect(renameInput).toBeVisible();

  // Type a new name
  const timestamp = Date.now();
  const originalName = `Rename Test ${timestamp}`;
  await renameInput.clear();
  await renameInput.fill(originalName);
  await renameInput.press('Enter');

  // Wait for the input to disappear and the mutation to complete
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);

  // Verify the new name appears in the sidebar
  const pageInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: originalName });
  await expect(pageInSidebar).toBeVisible();

  // Verify the name appears in the page header
  const pageHeader = page.locator('[data-testid="page-title"]');
  await expect(pageHeader).toContainText(originalName);

  // Now rename it again from the page header to verify the change propagates
  // Target the button within the page header specifically to avoid ambiguity with sidebar button
  const pageHeaderSection = page.locator('[data-testid="page-header"]');
  const pageHeaderRenameButton = pageHeaderSection.getByRole('button', {
    name: `Rename ${originalName}`,
  });
  await expect(pageHeaderRenameButton).toBeVisible();
  await pageHeaderRenameButton.click();

  const headerSection = page.locator('[data-testid="page-header"]');
  const headerRenameInput = headerSection.getByLabel(`New name for ${originalName}`);
  await expect(headerRenameInput).toBeVisible();

  const newName = `Renamed ${timestamp}`;
  await headerRenameInput.clear();
  await headerRenameInput.fill(newName);
  await headerRenameInput.press('Enter');

  await page.waitForLoadState('networkidle');

  // Verify the new name appears in the sidebar
  const renamedPageInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: newName });
  await expect(renamedPageInSidebar).toBeVisible();

  // Verify the new name appears in the page header
  const pageHeader2 = page.locator('[data-testid="page-title"]');
  await expect(pageHeader2).toContainText(newName);

  // Verify old name is gone from sidebar
  const oldPageInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: originalName });
  await expect(oldPageInSidebar).not.toBeVisible();

  // Assert console is clean
  await page.waitForTimeout(500);
  expect(consoleErrors).toHaveLength(0);
});
