import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

test('delete a page with children; verify confirmation dialog shows affected pages and deletion cascades', async ({
  page,
}) => {
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

  // Navigate to the app
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const timestamp = Date.now();
  const parentName = `Delete Parent ${timestamp}`;
  const childName1 = `Delete Child 1 ${timestamp}`;
  const childName2 = `Delete Child 2 ${timestamp}`;

  // Create a parent page at the top level
  const createTopLevelButton = page.getByRole('button', { name: 'Add a top-level page' });
  await expect(createTopLevelButton).toBeVisible();

  // Capture the current page ID before clicking
  const pageIdBeforeMatch = page.url().match(/\/page\/([^/]+)/);
  expect(pageIdBeforeMatch).toBeTruthy();
  const pageIdBefore = pageIdBeforeMatch![1];

  await createTopLevelButton.click();

  // Wait for navigation to a DIFFERENT page
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/page\/([^/]+)/);
    return !!m && m[1] !== pageIdBefore;
  });
  await page.waitForLoadState('networkidle');

  // Extract the parent page ID
  const parentPageIdMatch = page.url().match(/\/page\/([^/]+)/);
  expect(parentPageIdMatch).toBeTruthy();
  const parentPageId = parentPageIdMatch![1];

  // Rename the parent page
  const parentSidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${parentPageId}"]`);
  await expect(parentSidebarRow).toBeVisible();
  const parentRenameButton = parentSidebarRow.locator('[data-testid="page-rename"]'); // rename action
  await expect(parentRenameButton).toBeVisible();
  await parentRenameButton.click();

  const parentRenameInput = parentSidebarRow.getByRole('textbox');
  await expect(parentRenameInput).toBeVisible();
  await parentRenameInput.clear();
  await parentRenameInput.fill(parentName);
  await parentRenameInput.press('Enter');

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify parent page is visible in sidebar
  const parentInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: parentName });
  await expect(parentInSidebar).toBeVisible();

  // Now create the first child by clicking the "Add a page inside" button
  const parentRowRefreshed = page.locator(
    `[data-testid="sidebar"] [data-page-id="${parentPageId}"]`,
  );
  await expect(parentRowRefreshed).toBeVisible();

  const addChildButton1 = parentRowRefreshed.locator('[data-testid="page-add-child"]');
  await expect(addChildButton1).toBeVisible();
  await addChildButton1.click();

  // Navigate to the new child page
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Get the new child page ID
  const child1PageIdMatch = page.url().match(/\/page\/([^/]+)/);
  expect(child1PageIdMatch).toBeTruthy();
  const childPageId1 = child1PageIdMatch![1];

  // Rename the first child
  const childSidebarRow1 = page.locator(`[data-testid="sidebar"] [data-page-id="${childPageId1}"]`);
  await expect(childSidebarRow1).toBeVisible();
  const childRenameButton1 = childSidebarRow1.locator('[data-testid="page-rename"]');
  await expect(childRenameButton1).toBeVisible();
  await childRenameButton1.click();

  const childRenameInput1 = childSidebarRow1.getByRole('textbox');
  await expect(childRenameInput1).toBeVisible();
  await childRenameInput1.clear();
  await childRenameInput1.fill(childName1);
  await childRenameInput1.press('Enter');

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify first child is in sidebar
  const childInSidebar1 = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: childName1 });
  await expect(childInSidebar1).toBeVisible();

  // Create a second child by again clicking the parent's add-child button
  const parentRowRefreshed2 = page.locator(
    `[data-testid="sidebar"] [data-page-id="${parentPageId}"]`,
  );
  await expect(parentRowRefreshed2).toBeVisible();

  const addChildButton2 = parentRowRefreshed2.locator('[data-testid="page-add-child"]');
  await expect(addChildButton2).toBeVisible();
  await addChildButton2.click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Get the new child page ID
  const child2PageIdMatch = page.url().match(/\/page\/([^/]+)/);
  expect(child2PageIdMatch).toBeTruthy();
  const childPageId2 = child2PageIdMatch![1];

  // Rename the second child
  const child2SidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${childPageId2}"]`);
  await expect(child2SidebarRow).toBeVisible();
  const child2RenameButton = child2SidebarRow.locator('[data-testid="page-rename"]');
  await expect(child2RenameButton).toBeVisible();
  await child2RenameButton.click();

  const child2RenameInput = child2SidebarRow.getByRole('textbox');
  await expect(child2RenameInput).toBeVisible();
  await child2RenameInput.clear();
  await child2RenameInput.fill(childName2);
  await child2RenameInput.press('Enter');

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify both children are in sidebar
  const childInSidebar2 = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: childName2 });
  await expect(childInSidebar2).toBeVisible();

  // Now delete the parent page - find the delete button via its stable data-testid
  const parentRowBeforeDelete = page.locator(
    `[data-testid="sidebar"] [data-page-id="${parentPageId}"]`,
  );
  await expect(parentRowBeforeDelete).toBeVisible();

  const deleteButtonParent = parentRowBeforeDelete.locator('[data-testid="page-delete"]');
  await expect(deleteButtonParent).toBeVisible();
  await deleteButtonParent.click();

  // Wait for the confirmation dialog to appear with [role="dialog"]
  const confirmDialog = page.locator('[role="dialog"]');
  await expect(confirmDialog).toBeVisible();

  // The dialog should show it's deleting the parent and mention the children
  const dialogTitle = page.locator('[role="dialog"] h2').first();
  const dialogTitleText = await dialogTitle.textContent();
  expect(dialogTitleText).toContain(parentName);

  // Confirm the deletion - look for the "Delete permanently" button scoped to dialog
  const confirmButton = confirmDialog.getByRole('button', { name: /Delete permanently/i });
  await expect(confirmButton).toBeVisible();
  await confirmButton.click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify the parent page is no longer in the sidebar
  const parentNotInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: parentName });
  await expect(parentNotInSidebar).not.toBeVisible();

  // Verify the child pages are also no longer in the sidebar (cascade delete)
  const child1NotInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: childName1 });
  await expect(child1NotInSidebar).not.toBeVisible();

  const child2NotInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: childName2 });
  await expect(child2NotInSidebar).not.toBeVisible();

  // Test cancelling a delete - create another test page and cancel its deletion
  const timestamp2 = Date.now();
  const testPageName = `Cancel Delete ${timestamp2}`;

  // Create a test page at top level
  await createTopLevelButton.click();
  await page.waitForLoadState('networkidle');

  const testPageIdMatch = page.url().match(/\/page\/([^/]+)/);
  expect(testPageIdMatch).toBeTruthy();
  const testPageId = testPageIdMatch![1];

  // Rename it
  const testSidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${testPageId}"]`);
  await expect(testSidebarRow).toBeVisible();
  const testRenameButton = testSidebarRow.locator('[data-testid="page-rename"]');
  await expect(testRenameButton).toBeVisible();
  await testRenameButton.click();

  const testRenameInput = testSidebarRow.getByRole('textbox');
  await expect(testRenameInput).toBeVisible();
  await testRenameInput.clear();
  await testRenameInput.fill(testPageName);
  await testRenameInput.press('Enter');

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify it's in the sidebar
  const testPageInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: testPageName });
  await expect(testPageInSidebar).toBeVisible();

  // Try to delete it but cancel
  const testSidebarRowBeforeDelete = page.locator(
    `[data-testid="sidebar"] [data-page-id="${testPageId}"]`,
  );
  const testDeleteButton = testSidebarRowBeforeDelete.locator('[data-testid="page-delete"]');
  await expect(testDeleteButton).toBeVisible();
  await testDeleteButton.click();

  // Confirmation dialog appears
  const cancelDialog = page.locator('[role="dialog"]');
  await expect(cancelDialog).toBeVisible();

  // Click cancel button - scope to the dialog
  const cancelButton = cancelDialog.getByRole('button', { name: /Cancel/i });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Verify the page is still in the sidebar (delete was cancelled)
  const testPageStillInSidebar = page
    .locator('[data-testid="sidebar"]')
    .locator('[data-testid="page-row-title"]')
    .filter({ hasText: testPageName });
  await expect(testPageStillInSidebar).toBeVisible();

  // Assert console is clean
  await page.waitForTimeout(500);
  expect(consoleErrors).toHaveLength(0);
});
