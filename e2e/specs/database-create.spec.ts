/**
 * Phase 3 — database creation, sidebar appearance, seeded databases.
 *
 * Covers:
 * - Creating a database from the sidebar; it appears in the sidebar with a database marker and
 *   opens as the table view (success criterion 7).
 * - The seeded "Work Projects" (6 properties) and "Book Tracker" (6 properties) databases render
 *   all of their property columns — the check that would catch a stale-seed problem.
 * - Row pages are excluded from the sidebar tree.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Database creation and sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('creates a top-level database from the sidebar button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Capture current URL page id before creating the database.
    const before = page.url().match(/\/page\/([^/]+)/)?.[1];

    // Click the top-level "Add a top-level database" button.
    const createBtn = page.getByTestId('new-database-top');
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Wait for navigation to the new database page.
    await page.waitForURL((url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    });
    await page.waitForLoadState('networkidle');

    // URL must be a valid workspace-scoped page route.
    expect(page.url()).toMatch(/\/w\/[^/]+\/page\/[^/]+/);

    // The database view must be visible, not the block editor.
    await expect(page.getByTestId('database-view')).toBeVisible();

    // The sidebar must show the new entry with a database-marker icon overlay.
    const newPageId = page.url().match(/\/page\/([^/]+)/)![1];
    const sidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${newPageId}"]`);
    await expect(sidebarRow).toBeVisible();
    await expect(sidebarRow.getByTestId('database-marker')).toBeVisible();

    // The new database starts with its default "Untitled" title.
    await expect(page.getByTestId('page-title')).toContainText('Untitled');
  });

  test('creates a database via the bottom "New database" button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const before = page.url().match(/\/page\/([^/]+)/)?.[1];

    await page.getByTestId('new-database-bottom').click();

    await page.waitForURL((url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    });
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId('database-view')).toBeVisible();
  });

  test('seeded "Work Projects" database renders all six property columns', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and click "Work Projects" in the sidebar.
    const workProjectsLink = page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' });
    await expect(workProjectsLink).toBeVisible();
    await workProjectsLink.click();
    await page.waitForLoadState('networkidle');

    // The table view must be visible.
    const dbView = page.getByTestId('database-view');
    await expect(dbView).toBeVisible();

    // All six property columns must appear in the header.
    const expectedProps = ['Status', 'Tags', 'Due date', 'Done', 'Effort (days)', 'Spec'];
    for (const name of expectedProps) {
      await expect(dbView.getByRole('columnheader').filter({ hasText: name })).toBeVisible();
    }

    // At least three seeded rows must be present.
    const rows = dbView.getByTestId('database-row');
    await expect(rows).toHaveCount(3);
  });

  test('seeded "Book Tracker" database renders all six property columns', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const bookTrackerLink = page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Book Tracker' });
    await expect(bookTrackerLink).toBeVisible();
    await bookTrackerLink.click();
    await page.waitForLoadState('networkidle');

    const dbView = page.getByTestId('database-view');
    await expect(dbView).toBeVisible();

    // All six property columns must appear in the header.
    const expectedProps = ['Status', 'Topics', 'Link', 'Finished', 'Rating', 'Notes'];
    for (const name of expectedProps) {
      await expect(dbView.getByRole('columnheader').filter({ hasText: name })).toBeVisible();
    }

    // Three seeded rows must be present.
    const rows = dbView.getByTestId('database-row');
    await expect(rows).toHaveCount(3);
  });

  test('row pages do not appear in the sidebar tree', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Work Projects to confirm rows exist.
    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    const dbView = page.getByTestId('database-view');
    await expect(dbView.getByTestId('database-row').first()).toBeVisible();

    // Read the title of the first row.
    const firstRowTitle = await dbView
      .getByTestId('row-title-cell')
      .first()
      .locator('span')
      .last()
      .textContent();
    expect(firstRowTitle).toBeTruthy();

    // That title must not appear as a separate entry in the sidebar tree.
    const sidebarTitles = page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: firstRowTitle! });
    await expect(sidebarTitles).toHaveCount(0);
  });

  test('seeded database shows database-marker icon in the sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Work Projects should have the database marker in the sidebar.
    const workProjectsRow = page
      .getByTestId('sidebar')
      .locator('[data-page-id]')
      .filter({ has: page.getByTestId('page-row-title').filter({ hasText: 'Work Projects' }) });

    await expect(workProjectsRow.getByTestId('database-marker')).toBeVisible();
  });
});
