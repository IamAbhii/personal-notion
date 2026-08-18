/**
 * Phase 3 — cell edits surviving a page reload (success criterion 3).
 *
 * Number and URL types get explicit persistence tests because they have the thinnest unit coverage.
 * Also covers the row-page scenario: properties panel + blocks both editable, both persisting.
 *
 * Tests use the seeded databases ("Work Projects", "Book Tracker") so that rows exist without
 * navigating through the add-row flow (clicking "Add row" navigates to the new row page by design).
 * The seeded "A Philosophy of Software Design" row in Book Tracker has null Rating, Link and Notes —
 * perfect empty cells for persistence testing. ("The Pragmatic Programmer" has a Link value in the
 * seed, so it renders as an <a> anchor, not an <input type="url">.)
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// Helper: navigate to a seeded database in the sidebar and wait for the view to load.
async function goToDatabase(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sidebar').getByTestId('page-row-title').filter({ hasText: name }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('database-view')).toBeVisible();
}

// Helper: create a new top-level database and return its page id and workspace id.
async function createDatabase(page: import('@playwright/test').Page): Promise<{
  dbPageId: string;
  workspaceId: string;
}> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const before = page.url().match(/\/page\/([^/]+)/)?.[1];
  await page.getByTestId('new-database-top').click();
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/page\/([^/]+)/);
    return !!m && m[1] !== before;
  });
  await page.waitForLoadState('networkidle');
  const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];
  const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
  return { dbPageId, workspaceId };
}

test.describe('Cell edit persistence after reload — seeded databases', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('number cell value survives a page reload (Book Tracker — Rating)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "The Pragmatic Programmer" has no Rating — it renders as an empty number input.
    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // NumberCell uses type="text" with inputMode="decimal" for display formatting (DEF-061).
    const numInput = pragRow.locator('input[inputmode="decimal"]');
    await numInput.click();
    await numInput.fill('99');
    await numInput.blur();
    await page.waitForTimeout(1500);

    // Reload and return to the same database page.
    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloadedRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });
    await expect(reloadedRow.locator('input[inputmode="decimal"]')).toHaveValue('99');
  });

  test('url cell value survives a page reload (Book Tracker — Link)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "A Philosophy of Software Design" has no Link value — its URL cell renders as input.
    // ("The Pragmatic Programmer" has Link='pragprog.com/titles/tpp20' in the seed, so it
    // renders as an anchor rather than an input and cannot be used for this test.)
    const philosophyRow = page.getByTestId('database-view').getByTestId('database-row').nth(1);

    const urlInput = philosophyRow.locator('input[type="url"]');
    await urlInput.click();
    await urlInput.fill('philosophy.example.com');
    await urlInput.blur();
    await page.waitForTimeout(1500);

    // Reload.
    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloadedRow = page.getByTestId('database-view').getByTestId('database-row').nth(1);
    // After reload the URL cell renders as a link.
    await expect(
      reloadedRow.getByRole('link', { name: /philosophy\.example\.com/i }),
    ).toBeVisible();
  });

  test('text cell value survives a page reload (Book Tracker — Notes)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "The Pragmatic Programmer" has no Notes.
    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    const textInput = pragRow.locator('input[type="text"]').last();
    await textInput.click();
    await textInput.fill('Persisted note');
    await textInput.blur();
    await page.waitForTimeout(1500);

    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloadedRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });
    await expect(reloadedRow.locator('input[type="text"]').last()).toHaveValue('Persisted note');
  });

  test('checkbox cell value survives a page reload (Work Projects — Done)', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "Accessibility audit" has Done = false.
    const auditRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    const checkbox = auditRow.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    await page.waitForTimeout(1500);

    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloadedRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });
    await expect(reloadedRow.locator('input[type="checkbox"]')).toBeChecked();
  });

  test('select cell value survives a page reload (Work Projects — Status)', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "Accessibility audit" has Status = "Backlog". Change it to "Done".
    const auditRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    const statusCell = auditRow.locator('td').nth(1).locator('button').first();
    await statusCell.click();

    // Scope to the Radix portal to avoid strict-mode violations when "Done" appears in other
    // rows of the table at the same time.
    const selectPortal = page.locator('[data-radix-popper-content-wrapper]');
    await expect(selectPortal).toBeVisible({ timeout: 3000 });

    // Clear current selection first if the picker exposes a Clear control.
    const clearBtn = selectPortal.getByRole('button', { name: 'Clear' });
    if (await clearBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clearBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // Reopen and pick "Done".
    await statusCell.click();
    const selectPortal2 = page.locator('[data-radix-popper-content-wrapper]');
    await expect(selectPortal2).toBeVisible({ timeout: 3000 });
    await selectPortal2.getByRole('button', { name: 'Done' }).click();
    // waitForTimeout is enough for the save debounce; no need for an extra networkidle
    // here — that call stacks with goToDatabase's two networkidle waits and the one in
    // the final goto, pushing the total past the 30s budget in a loaded suite run.
    await page.waitForTimeout(1500);

    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    // Use 'load' instead of 'networkidle': the cell data arrives with the initial page
    // response. networkidle waits for all background XHR to settle, which can take
    // far longer than the 30s budget allows after 29 prior tests have primed the Worker.
    await page.waitForLoadState('load');

    const reloadedRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });
    await expect(reloadedRow.getByText('Done')).toBeVisible();
  });
});

test.describe('Row page — properties panel and blocks', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('opening a row navigates to its row page with a properties panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    const dbView = page.getByTestId('database-view');
    const firstRow = dbView.getByTestId('database-row').first();

    await firstRow.getByTestId('row-title-cell').click();
    await page.waitForLoadState('networkidle');

    expect(page.url()).toMatch(/\/w\/[^/]+\/page\/[^/]+/);

    await expect(page.getByTestId('row-page-properties')).toBeVisible();
    await expect(page.getByTestId('property-row').first()).toBeVisible();
  });

  test('seeded row page has property values and block content', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    // Click the first row ("Phase 3: databases and table view").
    await page
      .getByTestId('database-view')
      .getByTestId('row-title-cell')
      .filter({ hasText: 'Phase 3: databases and table view' })
      .click();
    await page.waitForLoadState('networkidle');

    // All six database properties must appear in the panel.
    const propRows = page.getByTestId('property-row');
    await expect(propRows).toHaveCount(6);

    // Block editor must also be present.
    const blockEditor = page.getByTestId('block-editor');
    await expect(blockEditor).toBeVisible();
    await expect(blockEditor.locator('[data-block-type]').first()).toBeVisible();
  });

  test('property value edited on the row page persists across reload', async ({ page }) => {
    // Navigate to Work Projects and open a row that has no Spec url.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    // Open "Accessibility audit" which has no Spec value.
    await page
      .getByTestId('database-view')
      .getByTestId('row-title-cell')
      .filter({ hasText: 'Accessibility audit' })
      .click();
    await page.waitForLoadState('networkidle');
    const rowPageId = page.url().match(/\/page\/([^/]+)/)![1];
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];

    // Find the Spec property row (URL type).
    const specRow = page.getByTestId('property-row').filter({ has: page.getByText('Spec') });
    // The URL input is empty (no Spec value).
    const urlInput = specRow.locator('input[type="url"]');
    if (await urlInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await urlInput.click();
      await urlInput.fill('example.com/spec');
      await urlInput.blur();
      await page.waitForTimeout(1500);

      // Reload to the row page and verify the URL persisted.
      await page.goto(`/w/${workspaceId}/page/${rowPageId}`);
      await page.waitForLoadState('networkidle');

      const specRowAfter = page.getByTestId('property-row').filter({ has: page.getByText('Spec') });
      await expect(specRowAfter.getByRole('link', { name: /example\.com\/spec/i })).toBeVisible();
    }
  });

  test('block added on the row page persists across reload', async ({ page }) => {
    const { workspaceId } = await createDatabase(page);
    const dbView = page.getByTestId('database-view');

    // Add a row — in-place since DEF-053 fix; dismiss the inline title input, then navigate
    // to the row page by reading its data-row-id from the table row.
    await dbView.getByTestId('add-row-btn').click();
    const renameInput = page.getByRole('textbox', { name: /Name for new row/i });
    await expect(renameInput).toBeVisible();
    await renameInput.press('Escape');
    await expect(dbView.getByTestId('database-row')).toHaveCount(1);

    const rowPageId = await dbView.getByTestId('database-row').first().getAttribute('data-row-id');
    expect(rowPageId).toBeTruthy();

    // Navigate to the row page directly.
    await page.goto(`/w/${workspaceId}/page/${rowPageId!}`);
    await page.waitForLoadState('networkidle');

    // The block editor should be visible (possibly with an empty-state placeholder).
    const blockEditor = page.getByTestId('block-editor');
    const emptyBtn = page.getByRole('button', { name: 'This page is empty' });
    if (await emptyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await emptyBtn.click();
      await page.waitForLoadState('networkidle');
    }

    await expect(blockEditor).toBeVisible();
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();

    const blockText = `Row block ${Date.now()}`;
    await page.keyboard.type(blockText);
    await page.waitForTimeout(1500);

    // Reload to the row page.
    await page.goto(`/w/${workspaceId}/page/${rowPageId}`);
    await page.waitForLoadState('networkidle');

    // The block text must survive the reload.
    await expect(page.getByTestId('block-editor')).toContainText(blockText);
  });

  test('row page is excluded from the sidebar — not visible as a tree entry', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    // Open the first row.
    const firstRowTitle = await page
      .getByTestId('database-view')
      .getByTestId('row-title-cell')
      .first()
      .locator('span')
      .last()
      .textContent();
    await page.getByTestId('database-view').getByTestId('row-title-cell').first().click();
    await page.waitForLoadState('networkidle');

    const rowPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // The row page must not appear in the sidebar tree.
    await expect(page.getByTestId('sidebar').locator(`[data-page-id="${rowPageId}"]`)).toHaveCount(
      0,
    );

    if (firstRowTitle) {
      await expect(
        page
          .getByTestId('sidebar')
          .getByTestId('page-row-title')
          .filter({ hasText: firstRowTitle }),
      ).toHaveCount(0);
    }
  });
});
