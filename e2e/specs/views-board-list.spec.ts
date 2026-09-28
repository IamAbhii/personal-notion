/**
 * Phase 4 — Views (board, list), filters, sorts and card drag (criteria 1–6, 8).
 *
 * All tests use the seeded "Work Projects" database which has three views (Table, Board, List),
 * is grouped by the "Status" select property on the board, and has a "Done" filter on the list
 * view.  Book Tracker is used for additional filter/sort coverage.
 *
 * The reset hook calls POST /api/workspaces/:id/test/reset before each test so page ids are
 * fresh and state accumulated by a prior test does not bleed through.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// ── Navigation helpers ────────────────────────────────────────────────────────

/** Navigate to the seeded database by clicking its sidebar entry. */
async function gotoDatabase(page: Page, title: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('treeitem', { name: new RegExp(title, 'i') }).click();
  await page.waitForLoadState('networkidle');
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Phase 4 — view switcher and board', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // Criterion 1: each database switches between table, board and list; all views show the same rows.
  test('view switcher moves between table, board and list — all show the same rows', async ({
    page,
  }) => {
    await gotoDatabase(page, 'Work Projects');

    // Collect titles visible in the TABLE view.
    await expect(page.getByRole('tab', { name: 'Table view' })).toBeVisible();
    // Table view rows are <tr data-testid="database-row">.
    const tableRows = page.locator('[data-testid="database-row"]');
    // Work Projects has 6 seeded rows (3 original + 3 Phase 4 additions).
    await expect(tableRows).toHaveCount(6, { timeout: 8000 });
    const tableTitles = await tableRows
      .locator('[data-testid="row-title-cell"]')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()).filter(Boolean));

    // Switch to BOARD view and verify every table title appears as a card.
    // A count match alone is insufficient: three views could show three different sets of rows.
    await page.getByRole('tab', { name: 'Board view' }).click();
    await expect(page.getByTestId('board-view')).toBeVisible();
    // Board cards count must equal table row count.
    await expect(page.getByTestId('board-card')).toHaveCount(6, { timeout: 8000 });
    // Every table title must appear as a board card (span.truncate holds the title text).
    for (const title of tableTitles) {
      await expect(page.getByTestId('board-card').filter({ hasText: title })).toBeVisible({
        timeout: 5000,
      });
    }

    // Switch to LIST view and verify all list titles are a subset of table titles.
    await page.getByRole('tab', { name: 'List view' }).click();
    await expect(page.getByTestId('list-view')).toBeVisible();
    // List view has a Done=isNotChecked filter so it shows fewer rows than the table.
    const listRows = page.getByTestId('list-row');
    await expect(listRows.first()).toBeVisible();
    // Extract titles from the flex-1 span (the title span inside each list row).
    const listTitles = await listRows
      .locator('span.flex-1')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()).filter(Boolean));
    // Every list row title must be one of the table row titles (list is a filtered subset).
    for (const title of listTitles) {
      expect(tableTitles).toContain(title);
    }

    // Switch back to TABLE — confirming all three directions are lossless.
    await page.getByRole('tab', { name: 'Table view' }).click();
    await expect(page.getByTestId('database-view')).toBeVisible();
  });

  // Criterion 2: board has one column per select option + uncategorised, cards show titles.
  test('board groups rows by Status — one column per option, cards show titles', async ({
    page,
  }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'Board view' }).click();
    await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

    const columns = page.getByTestId('board-column');
    // Work Projects has 4 Status options (Backlog, In progress, Done, On hold) + no-status rows
    // → at least 4 columns.
    const colCount = await columns.count();
    expect(colCount).toBeGreaterThanOrEqual(4);

    // Every card shows a non-empty title.
    const cards = page.getByTestId('board-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
    for (let i = 0; i < cardCount; i++) {
      const titleText = await cards.nth(i).locator('button').last().textContent();
      expect(titleText?.trim().length).toBeGreaterThan(0);
    }
  });

  // Criterion 3 (high-value): drag card to another column — property changes, visible in table,
  // survives reload.
  test('drag card to another column changes the property value — survives reload', async ({
    page,
  }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'Board view' }).click();
    await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

    // Find the "Accessibility audit" card which starts in Backlog.
    const card = page.getByTestId('board-card').filter({ hasText: 'Accessibility audit' });
    await expect(card).toBeVisible({ timeout: 8000 });

    // The dnd-kit drag listeners are on the drag handle button inside each card.
    const dragHandle = card.getByRole('button', { name: /Drag "Accessibility audit"/i });
    await expect(dragHandle).toBeVisible({ timeout: 5000 });

    // Find the "In progress" column.
    const inProgressCol = page.getByTestId('board-column').filter({ hasText: /In progress/i });
    await expect(inProgressCol).toBeVisible({ timeout: 5000 });

    // Drag: press on the drag handle, step through multiple moves to trigger the PointerSensor's
    // distance activation (4px), then release over the target column centre.
    const handleBox = await dragHandle.boundingBox();
    const targetBox = await inProgressCol.boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();

    const startX = handleBox!.x + handleBox!.width / 2;
    const startY = handleBox!.y + handleBox!.height / 2;
    const endX = targetBox!.x + targetBox!.width / 2;
    const endY = targetBox!.y + targetBox!.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await page.mouse.move(
        startX + ((endX - startX) * step) / 10,
        startY + ((endY - startY) * step) / 10,
      );
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(800);

    // Card should now appear in the "In progress" column.
    const inProgressColumn = page.getByTestId('board-column').filter({ hasText: /In progress/i });
    await expect(
      inProgressColumn.getByTestId('board-card').filter({ hasText: 'Accessibility audit' }),
    ).toBeVisible({ timeout: 6000 });

    // Switch to table view to confirm the property was written.
    await page.getByRole('tab', { name: 'Table view' }).click();
    await expect(page.getByTestId('database-view')).toBeVisible();
    // The Status cell for "Accessibility audit" row should show "In progress".
    const row = page
      .locator('[data-testid="database-row"]')
      .filter({ hasText: 'Accessibility audit' });
    await expect(row).toBeVisible({ timeout: 6000 });
    // The row should contain the "In progress" select chip somewhere in its cells.
    await expect(row).toContainText(/In progress/i, { timeout: 6000 });

    // Reload and assert the value persists.
    await page.reload();
    await page.waitForLoadState('networkidle');
    // After reload the default view is table; check the status again.
    const rowAfterReload = page
      .locator('[data-testid="database-row"]')
      .filter({ hasText: 'Accessibility audit' });
    await expect(rowAfterReload).toContainText(/In progress/i, { timeout: 8000 });
  });

  // Criterion 5: board grouping property and chosen view persist across a reload.
  // DEF-081 fixed view-tab persistence: the chosen view is now stored and restored on reload.
  test('board view and grouping persist after reload (criterion 5)', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'Board view' }).click();
    await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });
    // Confirm at least one column appears before reload.
    await expect(page.getByTestId('board-column').first()).toBeVisible({ timeout: 5000 });

    // Reload — the board view should be restored automatically (DEF-081 fixed).
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Board view should be visible without manually re-clicking the tab.
    await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });
    // Board tab should be selected.
    const boardTab = page.getByRole('tab', { name: 'Board view' });
    await expect(boardTab).toHaveAttribute('aria-selected', 'true', { timeout: 5000 });
    // Columns still appear — grouping property (Status) persists across the reload.
    await expect(page.getByTestId('board-column').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Phase 4 — criterion 5: sort persists across reload', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // Criterion 5: sort setting survives a page reload, per-view.
  test('sort by Title survives a reload (criterion 5)', async ({ page }) => {
    await gotoDatabase(page, 'Book Tracker');

    // Apply a sort on Title.
    await page.getByRole('button', { name: 'Filter and sort' }).click();
    await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });
    const sortSelect = page.getByRole('combobox', { name: 'Sort property' });
    await expect(sortSelect).toBeVisible({ timeout: 5000 });
    await sortSelect.selectOption({ label: 'Title' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Record the title order before reload.
    const rows = page.locator('[data-testid="database-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 6000 });
    const titlesBefore = await rows
      .locator('[data-testid="row-title-cell"]')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()).filter(Boolean));

    // Reload.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(rows.first()).toBeVisible({ timeout: 8000 });

    // Title order should be the same (sort survived reload).
    const titlesAfter = await rows
      .locator('[data-testid="row-title-cell"]')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()).filter(Boolean));
    expect(titlesAfter).toEqual(titlesBefore);
    // Confirm the order is alphabetically sorted.
    const sorted = [...titlesAfter].sort((a, b) => a.localeCompare(b));
    expect(titlesAfter).toEqual(sorted);
  });
});

test.describe('Phase 4 — filters and sorts', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // Criterion 4: checkbox isNotChecked filter — uses the pre-seeded list view filter.
  // The seeded list view for Work Projects has a Done=isNotChecked filter that hides the
  // "Performance baseline" row (which has Done=true).
  test('seeded list view filter hides done rows (isNotChecked)', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'List view' }).click();
    await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

    const listRows = page.getByTestId('list-row');
    const listTitles = await listRows.allTextContents();
    // "Performance baseline" has Done=true → filtered out.
    expect(listTitles.some((t) => t.includes('Performance baseline'))).toBe(false);
    // At least one row remains.
    expect(listTitles.length).toBeGreaterThan(0);
  });

  // Criterion 4: select "is" filter narrows rows.
  test('select "is" filter narrows rows to the matching status', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');

    // Open the filter/sort panel.  The trigger button has aria-label="Filter and sort".
    await page.getByRole('button', { name: 'Filter and sort' }).click();
    await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });

    // Click the "Add" button in the Filters section.
    const addBtn = page.getByTestId('filter-sort-panel').getByRole('button', { name: 'Add' });
    await addBtn.click();

    // Set property = Status.
    const propSelect = page.getByRole('combobox', { name: 'Filter property' }).first();
    await expect(propSelect).toBeVisible({ timeout: 5000 });
    await propSelect.selectOption({ label: 'Status' });

    // Operator "is" is the first legal op for a select type — should already be selected.
    const opSelect = page.getByRole('combobox', { name: 'Filter operator' }).first();
    await opSelect.selectOption({ label: 'is' });

    // Pick "In progress" as the filter value.
    const valSelect = page.getByRole('combobox', { name: 'Filter value' }).first();
    await expect(valSelect).toBeVisible({ timeout: 5000 });
    await valSelect.selectOption({ label: 'In progress' });

    // Close the popover.
    await page.keyboard.press('Escape');

    // Table should now show only the "Phase 3: databases and table view" row.
    const rows = page.locator('[data-testid="database-row"]');
    await expect(rows).toHaveCount(1, { timeout: 8000 });
    await expect(rows.first()).toContainText('Phase 3');
  });

  // Criterion 4: sort orders rows by title ascending.
  test('sort by Title ascending orders the rows', async ({ page }) => {
    await gotoDatabase(page, 'Book Tracker');

    // Open filter/sort panel.
    await page.getByRole('button', { name: 'Filter and sort' }).click();
    await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });

    // Set sort property to Title.
    const sortSelect = page.getByRole('combobox', { name: 'Sort property' });
    await expect(sortSelect).toBeVisible({ timeout: 5000 });
    await sortSelect.selectOption({ label: 'Title' });

    // Close panel.
    await page.keyboard.press('Escape');

    // Read row titles and verify ascending order.
    const rows = page.locator('[data-testid="database-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 6000 });
    const titles = await rows
      .locator('[data-testid="row-title-cell"]')
      .allTextContents()
      .then((ts) => ts.map((t) => t.trim()).filter(Boolean));
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    expect(titles).toEqual(sorted);
  });

  // Criterion 5: filter survives a page reload.
  test('filter survives a page reload', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');

    // Add a Status=In progress filter.
    await page.getByRole('button', { name: 'Filter and sort' }).click();
    await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });

    const addBtn = page.getByTestId('filter-sort-panel').getByRole('button', { name: 'Add' });
    await addBtn.click();

    const propSelect = page.getByRole('combobox', { name: 'Filter property' }).first();
    await expect(propSelect).toBeVisible({ timeout: 5000 });
    await propSelect.selectOption({ label: 'Status' });

    const opSelect = page.getByRole('combobox', { name: 'Filter operator' }).first();
    await opSelect.selectOption({ label: 'is' });

    const valSelect = page.getByRole('combobox', { name: 'Filter value' }).first();
    await expect(valSelect).toBeVisible({ timeout: 5000 });
    await valSelect.selectOption({ label: 'In progress' });

    await page.keyboard.press('Escape');

    // Confirm filter is active (1 row).
    const rows = page.locator('[data-testid="database-row"]');
    await expect(rows).toHaveCount(1, { timeout: 8000 });

    // Wait for the filter save to reach the server before reloading. Under batch load the
    // debounced sync POST may still be in-flight after Escape; a premature reload loses the
    // filter and causes a ~0.6% intermittent failure (DEF-104).
    await page.waitForLoadState('networkidle');

    // Reload and verify filter persists — still only 1 row matches Status=In progress.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const rowsAfter = page.locator('[data-testid="database-row"]');
    await expect(rowsAfter).toHaveCount(1, { timeout: 8000 });
    await expect(rowsAfter.first()).toContainText('Phase 3');
  });
});

test.describe('Phase 4 — list view', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // Criterion 6: list view shows each row's title and at least one property.
  test('list view shows row titles', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'List view' }).click();
    await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

    // At least one list row is visible.
    const listRows = page.getByTestId('list-row');
    const rowCount = await listRows.count();
    expect(rowCount).toBeGreaterThan(0);

    // Every row shows a non-empty title.
    for (let i = 0; i < rowCount; i++) {
      const title = await listRows.nth(i).textContent();
      expect(title?.trim().length).toBeGreaterThan(0);
    }
  });

  // Criterion 6: assert property values are visible alongside titles in the list view.
  // DEF-069 was fixed by using sm:flex. DEF-084 then redesigned the list row to show labelled,
  // aligned property slots using aria-label on the property container span (not span[title]).
  // This test uses the updated DOM structure.
  test('list view shows at least one property value per row (criterion 6)', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');
    await page.getByRole('tab', { name: 'List view' }).click();
    await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

    const listRows = page.getByTestId('list-row');
    await expect(listRows.first()).toBeVisible({ timeout: 8000 });

    // The ListView now renders property values in spans with aria-label={prop.name} inside a
    // container with class "hidden sm:flex" (visible at sm+ = 640px+). At 1280x800 this is
    // visible. Each property slot is a span[aria-label] containing both a label span and a value
    // span. Check that at least one of these outer property spans has positive offsetHeight.
    const propSlotSpans = page.locator('[data-testid="list-row"] span[aria-label]');
    const visiblePropCount = await propSlotSpans.evaluateAll(
      (els) => els.filter((el) => (el as HTMLElement).offsetHeight > 0).length,
    );
    // Criterion 6: at least one labelled property slot must be visible alongside a row title.
    expect(visiblePropCount).toBeGreaterThan(0);
  });
});
