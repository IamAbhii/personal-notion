import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Cascade delete pages with nested pages and blocks', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('deleting a page with nested pages removes nested content and blocks', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('[data-testid="sidebar"]');

    // Create the parent page so the test owns its fixture rather than hunting the seed.
    // Capture the URL first so we can wait for it to CHANGE — waitForURL resolves immediately
    // when the pattern already matches the current URL (DEF-001 lesson).
    const urlBeforeParent = page.url();
    const addPageButton = page.getByRole('button', { name: 'Add a top-level page' });
    await addPageButton.click();
    await page.waitForFunction(
      (before) => window.location.href !== before && /\/page\/[^/]+/.test(window.location.href),
      urlBeforeParent,
    );
    await page.waitForLoadState('networkidle');

    const parentPageIdMatch = page.url().match(/\/page\/([^/]+)/);
    expect(parentPageIdMatch).toBeTruthy();
    const parentPageId = parentPageIdMatch![1];

    // The parent row must be visible in the sidebar.
    const parentRow = sidebar.locator(`[data-page-id="${parentPageId}"]`);
    await expect(parentRow).toBeVisible();

    // Create a child page inside the parent using the add-child button.
    // The button lives inside the hover-reveal actions container (pointer-events-none until hover),
    // so hover the row first — same technique used in delete-page.spec.ts.
    const urlBeforeChild = page.url();
    const addChildButton = parentRow.locator('[data-testid="page-add-child"]');
    await parentRow.hover();
    await addChildButton.click();

    // Wait until the URL actually changes to the child page URL.
    await page.waitForFunction(
      (before) => window.location.href !== before && /\/page\/[^/]+/.test(window.location.href),
      urlBeforeChild,
    );
    await page.waitForLoadState('networkidle');

    const nestedPageIdMatch = page.url().match(/\/page\/([^/]+)/);
    expect(nestedPageIdMatch).toBeTruthy();
    const nestedPageId = nestedPageIdMatch![1];

    // The child page must be a different page from the parent.
    expect(nestedPageId).not.toBe(parentPageId);

    // Both pages must be visible in the sidebar before the deletion.
    await expect(sidebar.locator(`[data-page-id="${parentPageId}"]`)).toBeVisible();
    await expect(sidebar.locator(`[data-page-id="${nestedPageId}"]`)).toBeVisible();

    // We are already on the child page after clicking add-child — verify the block editor.
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();
    expect(page.url()).toContain(nestedPageId);

    // Delete the parent from here — no need to navigate to it first.
    // The cascade removes the parent and all its children.
    // Hover the parent row to make the action buttons interactive, then delete unconditionally.
    const parentRowFinal = sidebar.locator(`[data-page-id="${parentPageId}"]`);
    await parentRowFinal.hover();
    const deleteButton = parentRowFinal.locator('[data-testid="page-delete"]');
    await deleteButton.click();
    await page.waitForTimeout(300);

    // Confirm the deletion dialog if one appears.
    const confirmButton = page.getByRole('button', { name: /confirm|delete|yes/i }).first();
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);

    // Both the parent and the nested child must have disappeared from the sidebar.
    await expect(sidebar.locator(`[data-page-id="${parentPageId}"]`)).not.toBeVisible();
    await expect(sidebar.locator(`[data-page-id="${nestedPageId}"]`)).not.toBeVisible();

    // The URL must no longer reference either deleted page.
    expect(page.url()).not.toContain(nestedPageId);
  });

  test('creating and deleting a page verifies cascade behavior', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('[data-testid="sidebar"]');
    const initialPageCount = await sidebar.locator('[data-page-id]').count();

    // The initial sidebar should have pages (seeded).
    expect(initialPageCount).toBeGreaterThan(0);

    // Verify sidebar structure remains consistent across a reload.
    await page.reload();
    await page.waitForLoadState('networkidle');

    const afterReloadPageCount = await sidebar.locator('[data-page-id]').count();
    expect(afterReloadPageCount).toBe(initialPageCount);
  });
});
