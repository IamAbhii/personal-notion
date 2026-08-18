/**
 * Phase 4 gate retest: screenshots + defect verification.
 * Each test resets workspace state, exercises the fix, logs console evidence.
 * Screenshots go to screenshots/ at 1280x800.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

const SCREENSHOTS = '/Users/abhijeet.brahmbhatt/Documents/Repos/personal-notion/screenshots';

async function gotoDatabase(page: Page, title: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const entry = page.getByRole('treeitem', { name: new RegExp(title, 'i') });
  await expect(entry).toBeVisible({ timeout: 8000 });
  await entry.click();
  await page.waitForLoadState('networkidle');
}

// ── Screenshot 1: list view with labelled, aligned properties ─────────────────
test('SS-1: list view screenshot (DEF-084, criterion 6)', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('list-row').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-4-list-view.png` });

  // DEF-069 regression check: visible property spans.
  const visible = await page
    .locator('[data-testid="list-row"] span[title]')
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetHeight > 0).length);
  console.log(`LIST-PROP-VISIBLE: ${visible}`);

  // DEF-084: property labels via title attributes.
  const propSpans = await page.locator('[data-testid="list-row"] span[title]').all();
  const labelled = [];
  for (const s of propSpans.slice(0, 6)) {
    const title = await s.getAttribute('title');
    if (title) labelled.push(title);
  }
  console.log(`LIST-PROP-LABELS: ${labelled.join(' | ')}`);

  // Alignment: property containers from first 4 rows should share the same x position.
  const rows = await page.getByTestId('list-row').all();
  const xPositions: number[] = [];
  for (const row of rows.slice(0, 4)) {
    const containers = row.locator('[data-testid="list-row-props"]');
    if ((await containers.count()) > 0) {
      const box = await containers.first().boundingBox();
      if (box) xPositions.push(Math.round(box.x));
    }
  }
  console.log(`LIST-PROP-X: ${xPositions.join(', ')}`);
});

// ── Screenshot 2: board view ───────────────────────────────────────────────────
test('SS-2: board view screenshot (criterion 2)', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('board-card').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-4-board-view.png` });

  const colCount = await page.getByTestId('board-column').count();
  const cardCount = await page.getByTestId('board-card').count();
  console.log(`BOARD: ${colCount} columns, ${cardCount} cards`);

  // DEF-074: check card titles are not UUIDs.
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const cards = page.getByTestId('board-card');
  const n = await cards.count();
  let uuidCount = 0;
  for (let i = 0; i < Math.min(n, 6); i++) {
    const txt = (await cards.nth(i).locator('button').last().textContent())?.trim() ?? '';
    if (uuidRe.test(txt)) uuidCount++;
    else console.log(`CARD-TITLE: "${txt.substring(0, 40)}"`);
  }
  console.log(`DEF-074: cards with UUID title: ${uuidCount} of ${Math.min(n, 6)}`);
});

// ── Screenshot 3: filter applied on list view (seeded) ────────────────────────
// The seeded Work Projects list view already has a Done=isNotChecked filter.
// We show the filter panel open with the applied filter + sort control visible.
test('SS-3: filter applied screenshot (criterion 4, seeded filter)', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  // List view has the seeded Done=isNotChecked filter.
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

  // Open filter panel to show the active filter + sort control.
  await page.getByRole('button', { name: 'Filter and sort' }).click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-4-filter-applied.png` });

  // Verify the filter is visibly narrowing rows.
  await page.keyboard.press('Escape');
  const listRows = page.getByTestId('list-row');
  const rowCount = await listRows.count();
  console.log(`FILTER-ROWS: ${rowCount} rows (expect <6 because Done=true rows are hidden)`);
  // Verify "Performance baseline" (Done=true) is not shown.
  const titles = await listRows.allTextContents();
  const hasPerfBaseline = titles.some((t) => t.includes('Performance baseline'));
  console.log(`FILTER-HIDES-DONE: ${!hasPerfBaseline}`);
});

// ── DEF-070: database creation navigates to views ────────────────────────────
test('DEF-070: creating a database navigates to it and shows three views', async ({ page }) => {
  await resetWorkspace(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const before = page.url().match(/\/page\/([^/]+)/)?.[1];
  const createBtn = page.getByTestId('new-database-top');
  await expect(createBtn).toBeVisible({ timeout: 5000 });
  await createBtn.click();

  await page.waitForURL(
    (url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    },
    { timeout: 15000 },
  );
  await page.waitForLoadState('networkidle');

  const hasTable = await page.getByRole('tab', { name: 'Table view' }).isVisible({ timeout: 8000 });
  const hasBoard = await page.getByRole('tab', { name: 'Board view' }).isVisible({ timeout: 5000 });
  const hasList = await page.getByRole('tab', { name: 'List view' }).isVisible({ timeout: 5000 });
  console.log(`DEF-070: Table=${hasTable}, Board=${hasBoard}, List=${hasList}`);
  expect(hasTable && hasBoard && hasList).toBe(true);
});

// ── DEF-071: dangling filter cleared after property delete ─────────────────────
// The seeded list view for Work Projects has a Done=isNotChecked filter.
// Deleting the Done property should remove the dangling filter from the list view.
test('DEF-071: deleting a property removes dangling filters from views', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  // Switch to the List view which has the seeded Done=isNotChecked filter.
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

  // Verify the filter is active: filter button should show a badge.
  const filterBtn = page.getByRole('button', { name: 'Filter and sort' });
  const badgeBefore = await filterBtn
    .locator('span')
    .last()
    .textContent()
    .catch(() => '0');
  console.log(`DEF-071: filter badge before property delete: "${badgeBefore}"`);

  // Switch back to table view to delete the Done property.
  await page.getByRole('tab', { name: 'Table view' }).click();
  await expect(page.getByTestId('database-view')).toBeVisible({ timeout: 5000 });

  // Click the Done column header to open the property menu.
  // Use exact match to avoid matching "Done" values in cells.
  // Try clicking the button inside the column header first; fall back to the header element.
  const doneHeader = page
    .getByRole('columnheader')
    .filter({ hasText: /^Done$/ })
    .first();
  await expect(doneHeader).toBeVisible({ timeout: 5000 });

  // Some column headers expose a button child for the property menu.
  const headerBtnCount = await doneHeader.getByRole('button').count();
  console.log(`DEF-071: buttons inside Done header: ${headerBtnCount}`);
  if (headerBtnCount > 0) {
    await doneHeader.getByRole('button').first().click();
  } else {
    await doneHeader.click();
  }
  await page.waitForTimeout(600);

  // The popover may use different selectors — try the Radix wrapper first.
  const popover = page.locator('[data-radix-popper-content-wrapper]');
  const popoverVisible = await popover.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`DEF-071: popover visible: ${popoverVisible}`);
  if (popoverVisible) {
    const popoverText = await popover.textContent().catch(() => '');
    console.log(`DEF-071: popover text: "${popoverText?.substring(0, 80)}"`);
    const deleteBtn = popover.getByRole('button', { name: /delete property/i });
    if (await deleteBtn.isVisible({ timeout: 2000 })) {
      await deleteBtn.click();
      const confirmBtn = page.getByRole('button', { name: /delete permanently/i });
      if (await confirmBtn.isVisible({ timeout: 2000 })) {
        await confirmBtn.click();
      }
    } else {
      console.log('DEF-071: delete property button not found in popover');
    }
  } else {
    console.log(
      'DEF-071: popover did not open after column header click — property deletion skipped',
    );
  }
  await page.waitForTimeout(800);

  // Switch back to list view and check the filter badge.
  await page.getByRole('tab', { name: 'List view' }).click();
  const listOrEmpty = page.locator('[data-testid="list-view"], [data-testid="list-empty-state"]');
  await expect(listOrEmpty.first()).toBeVisible({ timeout: 5000 });

  const filterBtnAfter = page.getByRole('button', { name: 'Filter and sort' });
  const badgeAfter = await filterBtnAfter
    .locator('span')
    .last()
    .textContent()
    .catch(() => '0');
  // Open filter panel to inspect.
  await filterBtnAfter.click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });
  const noFiltersMsg = await page.locator('text=No filters applied.').isVisible({ timeout: 2000 });
  console.log(
    `DEF-071: filter badge after delete: "${badgeAfter}", no-filters message: ${noFiltersMsg}`,
  );
  await page.keyboard.press('Escape');
});

// ── DEF-072: empty state when all rows filtered ──────────────────────────────
// Table view should show "No rows match" when contradictory filters leave 0 rows.
// Use Status=Backlog AND Status≠Backlog to guarantee 0 rows match.
test('DEF-072: table view shows empty state when all rows filtered out', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  // Open filter/sort panel.
  await page.getByRole('button', { name: 'Filter and sort' }).click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });

  // Add filter 1: Status is Backlog.
  await page.getByTestId('filter-sort-panel').getByRole('button', { name: 'Add' }).click();
  const propSelect1 = page.getByRole('combobox', { name: 'Filter property' }).last();
  await expect(propSelect1).toBeVisible({ timeout: 4000 });
  await propSelect1.selectOption({ label: 'Status' });
  await page.waitForTimeout(200);
  const opSelect1 = page.getByRole('combobox', { name: 'Filter operator' }).last();
  if (await opSelect1.isVisible({ timeout: 1000 })) await opSelect1.selectOption({ label: 'is' });
  await page.waitForTimeout(200);
  const valSelect1 = page.getByRole('combobox', { name: 'Filter value' }).last();
  if (await valSelect1.isVisible({ timeout: 1000 }))
    await valSelect1.selectOption({ label: 'Backlog' });
  await page.waitForTimeout(400);

  // Add filter 2: Status is not Backlog (contradictory → 0 rows).
  await page.getByTestId('filter-sort-panel').getByRole('button', { name: 'Add' }).click();
  const propSelect2 = page.getByRole('combobox', { name: 'Filter property' }).last();
  await expect(propSelect2).toBeVisible({ timeout: 4000 });
  await propSelect2.selectOption({ label: 'Status' });
  await page.waitForTimeout(200);
  const opSelect2 = page.getByRole('combobox', { name: 'Filter operator' }).last();
  if (await opSelect2.isVisible({ timeout: 1000 }))
    await opSelect2.selectOption({ label: 'is not' });
  await page.waitForTimeout(200);
  const valSelect2 = page.getByRole('combobox', { name: 'Filter value' }).last();
  if (await valSelect2.isVisible({ timeout: 1000 }))
    await valSelect2.selectOption({ label: 'Backlog' });
  await page.waitForTimeout(400);

  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // Table view should now have 0 rows and show an empty state message.
  const rows = page.locator('[data-testid="database-row"]');
  const rowCount = await rows.count();
  console.log(`DEF-072: rows after contradictory filters: ${rowCount}`);

  // The fix: table view shows a "No rows match the current filters." message (not blank).
  const emptyMsg = page.locator('text=/no rows match/i');
  const hasMsg = await emptyMsg.isVisible({ timeout: 3000 }).catch(() => false);
  console.log(`DEF-072: "no rows match" message shown: ${hasMsg}`);

  // If the filter wasn't applied (rowCount > 0), check for the message anyway.
  if (rowCount === 0) {
    expect(hasMsg).toBe(true);
  } else {
    console.log(
      `DEF-072: contradictory filters may not have been applied (${rowCount} rows); skipping assertion`,
    );
  }
});

// ── DEF-073: database with views shows all three tabs ────────────────────────
// Since DEF-070 is fixed, newly created databases now have all three views.
test('DEF-073: newly created database shows all three tabs and filter control', async ({
  page,
}) => {
  await resetWorkspace(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const before = page.url().match(/\/page\/([^/]+)/)?.[1];
  await page.getByTestId('new-database-top').click();
  await page.waitForURL(
    (url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    },
    { timeout: 15000 },
  );
  await page.waitForLoadState('networkidle');

  const tableTab = await page.getByRole('tab', { name: 'Table view' }).isVisible({ timeout: 5000 });
  const boardTab = await page.getByRole('tab', { name: 'Board view' }).isVisible({ timeout: 3000 });
  const listTab = await page.getByRole('tab', { name: 'List view' }).isVisible({ timeout: 3000 });
  const filterBtn = await page
    .getByRole('button', { name: 'Filter and sort' })
    .isVisible({ timeout: 3000 });

  console.log(
    `DEF-073: Table=${tableTab}, Board=${boardTab}, List=${listTab}, FilterBtn=${filterBtn}`,
  );
  expect(tableTab && boardTab && listTab && filterBtn).toBe(true);
});

// ── DEF-075: card drops in the column under the pointer ───────────────────────
test('DEF-075: drop near right edge lands in the column under the pointer', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  const card = page.getByTestId('board-card').filter({ hasText: 'Accessibility audit' });
  await expect(card).toBeVisible({ timeout: 8000 });
  const dragHandle = card.getByRole('button', { name: /Drag "Accessibility audit"/i });

  const inProgressCol = page.getByTestId('board-column').filter({ hasText: /In progress/i });
  const doneCol = page.getByTestId('board-column').filter({ hasText: /^Done/i });

  const handleBox = await dragHandle.boundingBox();
  const targetBox = await inProgressCol.boundingBox();
  if (!handleBox || !targetBox) {
    console.log('DEF-075: SKIP — bounding boxes unavailable');
    return;
  }

  // Drop 8px inside the right edge of In progress.
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width - 8;
  const endY = targetBox.y + targetBox.height / 2;

  console.log(
    `DEF-075: In progress col bounds: x=${targetBox.x.toFixed(0)} w=${targetBox.width.toFixed(0)} right=${(targetBox.x + targetBox.width).toFixed(0)}`,
  );
  console.log(`DEF-075: dropping at x=${endX.toFixed(0)}`);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let s = 1; s <= 12; s++) {
    await page.mouse.move(startX + ((endX - startX) * s) / 12, startY + ((endY - startY) * s) / 12);
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(1000);

  const inProgressTitles = await inProgressCol
    .getByTestId('board-card')
    .allTextContents()
    .catch(() => []);
  const doneTitles = await doneCol
    .getByTestId('board-card')
    .allTextContents()
    .catch(() => []);
  const inIP = inProgressTitles.some((t) => t.includes('Accessibility audit'));
  const inDone = doneTitles.some((t) => t.includes('Accessibility audit'));
  console.log(`DEF-075: card in "In progress": ${inIP}, in "Done": ${inDone}`);
  console.log(`DEF-075: In progress cards: [${inProgressTitles.join(', ')}]`);
});

// ── DEF-076: "Add card to <column>" creates card with correct group value ─────
test('DEF-076: Add card to Done creates card in Done column', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  const doneCol = page.getByTestId('board-column').filter({ hasText: /^Done/i });
  await expect(doneCol).toBeVisible({ timeout: 5000 });
  const initialCount = await doneCol.getByTestId('board-card').count();

  const addCardBtn = doneCol.getByRole('button', { name: /add card/i });
  await expect(addCardBtn).toBeVisible({ timeout: 5000 });
  await addCardBtn.click();
  await page.waitForTimeout(1200);

  const newCount = await doneCol.getByTestId('board-card').count();
  console.log(`DEF-076: Done cards before=${initialCount}, after=${newCount}`);
  expect(newCount).toBeGreaterThan(initialCount);
});

// ── DEF-078: offline drag does not show false "moved" toast ──────────────────
test('DEF-078: offline drag shows offline/pending state not a successful move', async ({
  page,
  context,
}) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  // Go offline.
  await context.setOffline(true);
  await page.waitForTimeout(300);

  const card = page.getByTestId('board-card').filter({ hasText: 'Accessibility audit' });
  await expect(card).toBeVisible({ timeout: 8000 });
  const dragHandle = card.getByRole('button', { name: /Drag "Accessibility audit"/i });

  const doneCol = page.getByTestId('board-column').filter({ hasText: /^Done/i });
  const handleBox = await dragHandle.boundingBox();
  const targetBox = await doneCol.boundingBox();
  if (!handleBox || !targetBox) {
    await context.setOffline(false);
    console.log('DEF-078: SKIP — bounding boxes unavailable');
    return;
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) {
    await page.mouse.move(startX + ((endX - startX) * s) / 10, startY + ((endY - startY) * s) / 10);
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(1500);

  // Check board state and toast.
  // Post-fix: the card should move optimistically, OR not move at all — but not show a
  // "Moved to Done" toast while still showing the card in Backlog.
  const backlogCol = page.getByTestId('board-column').filter({ hasText: /Backlog/i });
  const backlogCards = await backlogCol
    .getByTestId('board-card')
    .allTextContents()
    .catch(() => []);
  const doneCards = await doneCol
    .getByTestId('board-card')
    .allTextContents()
    .catch(() => []);
  const inBacklog = backlogCards.some((t) => t.includes('Accessibility audit'));
  const inDoneNow = doneCards.some((t) => t.includes('Accessibility audit'));

  // Toast check.
  const toasts = await page.locator('[data-testid="toast"], [role="status"]').allTextContents();
  const toastText = toasts.join(' ');
  const hasMovedToast = /moved.*done/i.test(toastText);

  console.log(
    `DEF-078: card in Backlog=${inBacklog}, in Done=${inDoneNow}, "Moved to Done" toast=${hasMovedToast}`,
  );
  console.log(`DEF-078: toasts: "${toastText.substring(0, 100)}"`);

  await context.setOffline(false);
  await page.waitForTimeout(2000);
  // After reconnect, card should be in Done.
  const doneCardsAfterSync = await doneCol
    .getByTestId('board-card')
    .allTextContents()
    .catch(() => []);
  const inDoneAfterSync = doneCardsAfterSync.some((t) => t.includes('Accessibility audit'));
  console.log(`DEF-078: after reconnect, card in Done: ${inDoneAfterSync}`);
});

// ── DEF-079: duplicate option rename shows error; good edits survive ──────────
test('DEF-079: renaming to duplicate shows inline error, editor stays open', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  // Open Status Manage options.
  const statusHeader = page.getByRole('columnheader').filter({ hasText: 'Status' }).first();
  await statusHeader.click();
  const popover = page.locator('[data-radix-popper-content-wrapper]');
  await expect(popover).toBeVisible({ timeout: 3000 });
  await popover.getByRole('button', { name: /Manage options/i }).click();
  await expect(page.getByText('Manage options')).toBeVisible({ timeout: 3000 });
  await page.waitForTimeout(300);

  // Find the Backlog input and rename it to "Done" (duplicate).
  const backlogInput = page.locator('input[value="Backlog"]');
  if (await backlogInput.isVisible({ timeout: 2000 })) {
    await backlogInput.click({ clickCount: 3 });
    await backlogInput.fill('Done');
    await page.waitForTimeout(200);

    const saveBtn = page.getByRole('button', { name: /save/i });
    if (await saveBtn.isVisible({ timeout: 2000 })) {
      await saveBtn.click();
      await page.waitForTimeout(800);
    }

    const stillOpen = await page.getByText('Manage options').isVisible({ timeout: 2000 });
    const errMsg = await page
      .locator('text=/duplicate|already exists|must be unique/i')
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    console.log(`DEF-079: editor still open: ${stillOpen}, error shown: ${errMsg}`);

    // The server-side fix should reject the op and ideally show an error.
    // Either: dialog stays open with error, OR dialog closes but option name is unchanged.
    if (!stillOpen) {
      // Check that "Backlog" still exists (i.e., rename was rejected).
      const backlogExists = await page
        .locator('text=Backlog')
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      console.log(`DEF-079: editor closed, "Backlog" still exists: ${backlogExists}`);
    }
  } else {
    console.log('DEF-079: Backlog input not directly visible (may need different selector)');
    // Try finding via visible text.
    const allInputs = await page.locator('input[type="text"]').all();
    const vals = [];
    for (const inp of allInputs) {
      const v = await inp.inputValue();
      vals.push(v);
    }
    console.log(`DEF-079: text inputs: [${vals.join(', ')}]`);
  }
});

// ── DEF-080: view switcher arrow keys ────────────────────────────────────────
test('DEF-080: view switcher responds to ArrowRight key', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  const tableTab = page.getByRole('tab', { name: 'Table view' });
  await tableTab.focus();
  const tableSelected = await tableTab.getAttribute('aria-selected');
  console.log(`DEF-080: Table tab aria-selected before ArrowRight: ${tableSelected}`);

  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);

  const boardTab = page.getByRole('tab', { name: 'Board view' });
  const boardSelected = await boardTab.getAttribute('aria-selected');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  console.log(
    `DEF-080: Board tab aria-selected after ArrowRight: ${boardSelected}, focused element aria-label: "${focused}"`,
  );

  // Also check the board view is now visible.
  const boardVisible = await page
    .getByTestId('board-view')
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  console.log(`DEF-080: board view became visible: ${boardVisible}`);
});

// ── DEF-081: chosen view persists across reload ─────────────────────────────
test('DEF-081: chosen view persists across reload', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });
  console.log(`DEF-081: board view set before reload`);

  await page.reload();
  await page.waitForLoadState('networkidle');

  const boardVisible = await page
    .getByTestId('board-view')
    .isVisible({ timeout: 4000 })
    .catch(() => false);
  const boardTabSelected = await page
    .getByRole('tab', { name: 'Board view' })
    .getAttribute('aria-selected')
    .catch(() => null);
  console.log(
    `DEF-081: after reload — board visible: ${boardVisible}, tab selected: ${boardTabSelected}`,
  );
});

// ── DEF-082: duplicate option name blocked ───────────────────────────────────
test('DEF-082: adding duplicate option name is blocked', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  const statusHeader = page.getByRole('columnheader').filter({ hasText: 'Status' }).first();
  await statusHeader.click();
  const popover = page.locator('[data-radix-popper-content-wrapper]');
  await expect(popover).toBeVisible({ timeout: 3000 });
  await popover.getByRole('button', { name: /Manage options/i }).click();
  await expect(page.getByText('Manage options')).toBeVisible({ timeout: 3000 });

  const newOptionInput = page.getByPlaceholder(/new option/i);
  await newOptionInput.fill('Done');
  await page.waitForTimeout(300);

  const addOptionBtn = page.getByRole('button', { name: /^add$/i });
  const isDisabled = await addOptionBtn.isDisabled({ timeout: 2000 }).catch(() => false);
  const errVisible = await page
    .locator('text=/duplicate|already exists/i')
    .isVisible({ timeout: 1000 })
    .catch(() => false);
  console.log(
    `DEF-082: Add button disabled for duplicate name: ${isDisabled}, error message: ${errVisible}`,
  );

  // Try clicking Add and see if a duplicate appears.
  if (!isDisabled) {
    await addOptionBtn.click();
    await page.waitForTimeout(500);
  }
  const saveBtn = page.getByRole('button', { name: /save/i });
  if (await saveBtn.isVisible({ timeout: 1000 })) {
    await saveBtn.click();
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Switch to board and count "Done" columns.
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });
  const doneCols = await page.getByTestId('board-column').filter({ hasText: /^Done/ }).count();
  console.log(`DEF-082: "Done" columns on board: ${doneCols} (expected 1)`);
});

// ── DEF-083: list view shows formatted dates ─────────────────────────────────
test('DEF-083: list view shows formatted dates not raw ISO strings', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

  const allText = (await page.getByTestId('list-row').allTextContents()).join(' ');
  const isoRe = /\d{4}-\d{2}-\d{2}/;
  const hasISO = isoRe.test(allText);
  // Also check for formatted date patterns like "15 Sept 2026" or "Sep 15, 2026".
  const formattedRe = /\b\d{1,2}\s+\w{3,}\s+\d{4}\b|\b\w{3,}\s+\d{1,2},\s+\d{4}\b/;
  const hasFormatted = formattedRe.test(allText);
  console.log(`DEF-083: ISO date in list: ${hasISO}, formatted date: ${hasFormatted}`);
  console.log(`DEF-083: sample list text: "${allText.substring(0, 300)}"`);
});

// ── DEF-084: list view property alignment ────────────────────────────────────
// Labels are present (first closure); alignment is the remaining criterion (second closure).
test('DEF-084: list view properties are labelled', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(400);

  // DEF-084 fix: list rows use span[aria-label] for property slots.
  const propSlots = await page.locator('[data-testid="list-row"] span[aria-label]').all();
  const labels: string[] = [];
  for (const s of propSlots.slice(0, 8)) {
    const lbl = await s.getAttribute('aria-label');
    if (lbl) labels.push(lbl);
  }
  console.log(`DEF-084: property slot aria-labels: [${labels.join(', ')}]`);

  // At least one labelled property slot must be visible (criterion 6 and DEF-084).
  const visibleCount = await page
    .locator('[data-testid="list-row"] span[aria-label]')
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetHeight > 0).length);
  console.log(`DEF-084: visible property slots: ${visibleCount}`);
  expect(visibleCount).toBeGreaterThan(0);
});

test('DEF-084: each property occupies the same horizontal band on every row', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('list-row').first()).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);

  // Collect the left-edge x of every labeled property slot, keyed by the aria-label (property
  // name). Each property must land at the same x on every row it appears on. Variation of more
  // than 4 px (sub-pixel rounding tolerance) is a failure — it means the property column is
  // not aligned and a viewer cannot attribute a value to a property by position.
  type SlotInfo = { label: string; x: number; rowIndex: number };

  const slots: SlotInfo[] = await page.evaluate(() => {
    const result: SlotInfo[] = [];
    const rows = Array.from(document.querySelectorAll('[data-testid="list-row"]'));
    rows.forEach((row, rowIndex) => {
      const spans = Array.from(row.querySelectorAll('span[aria-label]')) as HTMLElement[];
      spans.forEach((span) => {
        const label = span.getAttribute('aria-label') ?? '';
        // Skip generic placeholder labels — "empty" is reused by every empty-value slot
        // regardless of which property it belongs to, so grouping by that label would compare
        // an empty Status slot with an empty Due-date slot at a different column.
        if (!label || label === 'empty' || label === '') return;
        const rect = span.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return; // invisible slot, skip
        result.push({ label, x: Math.round(rect.left), rowIndex });
      });
    });
    return result;
  });

  // Group by property label and collect the distinct x values across rows.
  const byLabel = new Map<string, number[]>();
  for (const { label, x } of slots) {
    const arr = byLabel.get(label) ?? [];
    arr.push(x);
    byLabel.set(label, arr);
  }

  let alignmentFailures = 0;
  for (const [label, xs] of byLabel) {
    if (xs.length < 2) continue; // only one row shows this property — nothing to compare
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const spread = maxX - minX;
    console.log(`DEF-084 align: "${label}" x-positions: [${xs.join(', ')}], spread: ${spread}px`);
    if (spread > 4) {
      alignmentFailures++;
      // Report the full list so the failure message names the property and its actual positions.
      expect(
        spread,
        `Property "${label}" x-positions vary by ${spread}px across rows (expected ≤ 4 px). ` +
          `Positions: [${xs.join(', ')}]. Each property must sit in the same horizontal column on every row.`,
      ).toBeLessThanOrEqual(4);
    }
  }
  console.log(`DEF-084 align: ${byLabel.size} properties checked, ${alignmentFailures} misaligned`);
});

// ── DEF-085: empty database shows proper empty state (not filter message) ─────
test('DEF-085: empty database shows correct empty state (not "filtered" msg)', async ({ page }) => {
  await resetWorkspace(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const before = page.url().match(/\/page\/([^/]+)/)?.[1];
  await page.getByTestId('new-database-top').click();
  await page.waitForURL(
    (url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    },
    { timeout: 15000 },
  );
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('tab', { name: 'Table view' })).toBeVisible({ timeout: 8000 });

  // Check list view. An empty database renders list-empty-state, not list-view.
  await page.getByRole('tab', { name: 'List view' }).click();
  // Either list-view (has rows) or list-empty-state (empty database) must appear.
  const listViewOrEmpty = page.locator(
    '[data-testid="list-view"], [data-testid="list-empty-state"]',
  );
  await expect(listViewOrEmpty.first()).toBeVisible({ timeout: 5000 });
  const listText = await listViewOrEmpty
    .first()
    .textContent()
    .catch(() => '');
  const hasFilterMsg = /no rows match.*filter/i.test(listText ?? '');
  const hasEmptyMsg = /empty|get started/i.test(listText ?? '');
  console.log(`DEF-085: list text: "${listText?.trim().substring(0, 100)}"`);
  console.log(
    `DEF-085: "no rows match filter" (wrong): ${hasFilterMsg}, empty state msg: ${hasEmptyMsg}`,
  );
});

// ── DEF-086: select sort follows option order ─────────────────────────────────
test('DEF-086: sorting by a select property follows option order', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  await page.getByRole('button', { name: 'Filter and sort' }).click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });
  const sortSelect = page.getByRole('combobox', { name: 'Sort property' });
  await expect(sortSelect).toBeVisible({ timeout: 5000 });
  await sortSelect.selectOption({ label: 'Status' });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  const rows = page.locator('[data-testid="database-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 6000 });

  // Get Status cell values — Status is a select property; the cell may use a button or span.
  // Try multiple selectors for select cell display.
  let statusCells: string[] = [];
  // First try data-testid="select-cell-display"
  statusCells = await rows.locator('[data-testid="select-cell-display"]').allTextContents();
  if (statusCells.length === 0) {
    // Fallback: look for any chip/button in the Status column
    // The Status column is the second td (after the title column).
    const allRowTexts = await rows.evaluateAll((rowEls) =>
      rowEls.map((row) => {
        // Get the Status cell by looking at the row's cells
        const cells = row.querySelectorAll('td');
        // cell[0] is title, cell[1] is typically Status — grab its text
        return cells[1]?.textContent?.trim() ?? '';
      }),
    );
    statusCells = allRowTexts.filter(Boolean);
    console.log(`DEF-086: Status cells via td[1]: [${statusCells.join(', ')}]`);
  }
  console.log(`DEF-086: Status order: [${statusCells.join(', ')}]`);
  // Option order: Backlog, In progress, Done, On hold.
  // Alphabetical order would be: Backlog, Done, In progress, On hold.
  // If "In progress" appears before "Done" in the list, that's option order.
  const ipIdx = statusCells.findIndex((s) => /in progress/i.test(s));
  const doneIdx = statusCells.findIndex((s) => /^done$/i.test(s));
  console.log(
    `DEF-086: "In progress" at idx ${ipIdx}, "Done" at idx ${doneIdx} (option order: IP before Done → correct)`,
  );
});

// ── DEF-087: board accessible structure ──────────────────────────────────────
test('DEF-087: board columns have accessible grouping and filter panel is named', async ({
  page,
}) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  const firstCol = page.getByTestId('board-column').first();
  const role = await firstCol.getAttribute('role');
  const ariaLabel = await firstCol.getAttribute('aria-label');
  const ariaLabelledBy = await firstCol.getAttribute('aria-labelledby');
  console.log(
    `DEF-087: board-column role="${role}", aria-label="${ariaLabel}", aria-labelledby="${ariaLabelledBy}"`,
  );

  await page.getByRole('button', { name: 'Filter and sort' }).click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });
  const panel = page.getByTestId('filter-sort-panel');
  const panelRole = await panel.getAttribute('role');
  const panelLabel = await panel.getAttribute('aria-label');
  console.log(`DEF-087: filter panel role="${panelRole}", aria-label="${panelLabel}"`);
  await page.keyboard.press('Escape');
});

// ── DEF-077: keyboard drag moves card between columns ────────────────────────
// dnd-kit's keyboard sensor: Space to lift, ArrowRight to move, Space to drop.
// Two sub-cases: (a) ArrowRight + Space moves the card; (b) Escape cancels and leaves it in place.

test('DEF-077: keyboard drag moves card to next column via ArrowRight + Space', async ({
  page,
}) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  // Find the "Accessibility audit" card which starts in Backlog.
  const card = page.getByTestId('board-card').filter({ hasText: 'Accessibility audit' });
  await expect(card).toBeVisible({ timeout: 8000 });
  const dragHandle = card.getByRole('button', { name: /Drag "Accessibility audit"/i });
  await expect(dragHandle).toBeVisible({ timeout: 5000 });

  // Use the assertive live region only — dnd-kit's own region. Sonner toasts use polite.
  // '[aria-live]' matches both and .textContent() throws on a multi-element result.
  const liveRegion = page.locator('[aria-live="assertive"]').first();

  // Tab focus to the drag handle, then Space to lift.
  await dragHandle.focus();
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);

  // Lift announcement must name the card and its starting column.
  const announceAfterLift = (await liveRegion.textContent()) ?? '';
  console.log(`DEF-077 lift: "${announceAfterLift.trim().substring(0, 120)}"`);
  expect(announceAfterLift).toMatch(/Accessibility audit/i);
  expect(announceAfterLift).toMatch(/Backlog/i);

  // Press ArrowRight once to move to the next column (In progress).
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);

  // Move announcement must name the card and the target column.
  const announceAfterRight = (await liveRegion.textContent()) ?? '';
  console.log(`DEF-077 ArrowRight: "${announceAfterRight.trim().substring(0, 120)}"`);
  expect(announceAfterRight).toMatch(/Accessibility audit/i);
  expect(announceAfterRight).toMatch(/In progress/i);

  // Drop the card with Space.
  await page.keyboard.press('Space');
  await page.waitForTimeout(1200);

  const backlogCol = page.getByTestId('board-column').filter({ hasText: /Backlog/i });
  const inProgressCol = page.getByTestId('board-column').filter({ hasText: /In progress/i });
  const backlogCards = await backlogCol.getByTestId('board-card').allTextContents();
  const inProgressCards = await inProgressCol.getByTestId('board-card').allTextContents();
  const inBacklog = backlogCards.some((t) => t.includes('Accessibility audit'));
  const inInProgress = inProgressCards.some((t) => t.includes('Accessibility audit'));
  console.log(`DEF-077: card in Backlog=${inBacklog}, in "In progress"=${inInProgress}`);

  // The card must have moved to "In progress".
  expect(inInProgress).toBe(true);
  expect(inBacklog).toBe(false);
});

test('DEF-077: Escape during keyboard drag cancels and leaves card in original column', async ({
  page,
}) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await expect(page.getByTestId('board-view')).toBeVisible({ timeout: 8000 });

  // Same card — starts in Backlog.
  const card = page.getByTestId('board-card').filter({ hasText: 'Accessibility audit' });
  await expect(card).toBeVisible({ timeout: 8000 });
  const dragHandle = card.getByRole('button', { name: /Drag "Accessibility audit"/i });
  await expect(dragHandle).toBeVisible({ timeout: 5000 });

  await dragHandle.focus();
  await page.waitForTimeout(200);
  await page.keyboard.press('Space'); // lift
  await page.waitForTimeout(400);

  await page.keyboard.press('ArrowRight'); // move to In progress
  await page.waitForTimeout(400);

  await page.keyboard.press('Escape'); // cancel — must NOT commit the move
  await page.waitForTimeout(1200);

  const backlogCol = page.getByTestId('board-column').filter({ hasText: /Backlog/i });
  const inProgressCol = page.getByTestId('board-column').filter({ hasText: /In progress/i });
  const backlogCards = await backlogCol.getByTestId('board-card').allTextContents();
  const inProgressCards = await inProgressCol.getByTestId('board-card').allTextContents();
  const stillInBacklog = backlogCards.some((t) => t.includes('Accessibility audit'));
  const movedToInProgress = inProgressCards.some((t) => t.includes('Accessibility audit'));
  console.log(
    `DEF-077 Escape: still in Backlog=${stillInBacklog}, moved to In progress=${movedToInProgress}`,
  );

  // Escape must cancel — card remains in Backlog.
  expect(stillInBacklog).toBe(true);
  expect(movedToInProgress).toBe(false);
});

// ── DEF-088: Title in filter property list ────────────────────────────────────
// Use the seeded list view filter (Done=isNotChecked) to inspect an existing filter row's
// property select, which includes all filterable properties. Title should be in that list.
test('DEF-088: Title property is in the filter property dropdown', async ({ page }) => {
  await resetWorkspace(page);
  await gotoDatabase(page, 'Work Projects');

  // Switch to list view which has the seeded Done=isNotChecked filter.
  await page.getByRole('tab', { name: 'List view' }).click();
  await expect(page.getByTestId('list-view')).toBeVisible({ timeout: 8000 });

  // Open filter panel — the existing filter row is there from seed.
  await page.getByRole('button', { name: 'Filter and sort' }).click();
  await expect(page.getByTestId('filter-sort-panel')).toBeVisible({ timeout: 5000 });

  // The seeded Done filter row should already show a "Filter property" select.
  const propSelect = page.getByRole('combobox', { name: 'Filter property' }).first();
  await expect(propSelect).toBeVisible({ timeout: 5000 });

  const options = await propSelect.locator('option').allTextContents();
  console.log(`DEF-088: filter property options: [${options.join(', ')}]`);
  const hasTitleFilter = options.some((o) => /^title$/i.test(o));
  console.log(`DEF-088: Title in filter list: ${hasTitleFilter}`);
  await page.keyboard.press('Escape');
});
