/**
 * Phase 3 — table view: adding properties of all seven types, editing cells, adding and deleting
 * rows, and select/multi-select option creation and reuse (success criteria 3, 4, 7).
 *
 * Cell editing tests use the seeded "Work Projects" and "Book Tracker" databases because
 * clicking "Add row" navigates to the new row page by design (createAndOpenRow).  Seeded rows
 * provide a stable baseline after every resetWorkspace and avoid the add-row navigation round-trip
 * for each individual cell type test.
 *
 * The "add and delete row" test uses a fresh database and explicitly navigates back to the
 * database page after the add-row navigation.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// Helper: navigate to the app, create a new top-level database, and return its page id.
async function createDatabase(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const before = page.url().match(/\/page\/([^/]+)/)?.[1];
  await page.getByTestId('new-database-top').click();
  await page.waitForURL((url) => {
    const m = url.pathname.match(/\/page\/([^/]+)/);
    return !!m && m[1] !== before;
  });
  await page.waitForLoadState('networkidle');
  return page.url().match(/\/page\/([^/]+)/)![1];
}

// Helper: open the "Add property" popover and submit a new property.
// The type <select> is not formally associated with its label (no for/id), so getByLabel does not
// match it. Find it directly — it's the only <select> in the form when the popover is open.
async function addProperty(
  page: import('@playwright/test').Page,
  name: string,
  type: string,
): Promise<void> {
  const dbView = page.getByTestId('database-view');
  await dbView.getByTestId('add-property-btn').click();

  const nameInput = page.getByPlaceholder('Property name');
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);

  const typeSelect = page.locator('select').first();
  await expect(typeSelect).toBeVisible();
  await typeSelect.selectOption(type);

  await page.getByRole('button', { name: 'Add' }).last().click();

  // The new column header must appear.
  await expect(dbView.getByRole('columnheader').filter({ hasText: name })).toBeVisible();
}

// Helper: navigate to a seeded database in the sidebar by name.
async function goToDatabase(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sidebar').getByTestId('page-row-title').filter({ hasText: name }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('database-view')).toBeVisible();
}

test.describe('Database table view — adding properties', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('can add properties of all seven types', async ({ page }) => {
    await createDatabase(page);
    const dbView = page.getByTestId('database-view');

    const types: Array<{ name: string; type: string }> = [
      { name: 'My Text', type: 'text' },
      { name: 'My Number', type: 'number' },
      { name: 'My Select', type: 'select' },
      { name: 'My MultiSelect', type: 'multiSelect' },
      { name: 'My Date', type: 'date' },
      { name: 'My Checkbox', type: 'checkbox' },
      { name: 'My URL', type: 'url' },
    ];

    for (const { name, type } of types) {
      await addProperty(page, name, type);
      await expect(dbView.getByRole('columnheader').filter({ hasText: name })).toBeVisible();
    }

    // All seven columns are present.
    for (const { name } of types) {
      await expect(dbView.getByRole('columnheader').filter({ hasText: name })).toBeVisible();
    }
  });

  test('type is shown as fixed-once-created in the add property form', async ({ page }) => {
    await createDatabase(page);
    const dbView = page.getByTestId('database-view');
    await dbView.getByTestId('add-property-btn').click();

    // The label must mention that the type is fixed.
    await expect(page.getByText(/fixed once created/i)).toBeVisible();

    // Close.
    await page.keyboard.press('Escape');
  });
});

test.describe('Database table view — rows', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('can add a row and delete it', async ({ page }) => {
    await createDatabase(page);

    const dbView = page.getByTestId('database-view');

    // Initially no rows in a freshly created empty database.
    await expect(dbView.getByTestId('database-row')).toHaveCount(0);

    // Clicking "New row" creates a row in place and focuses the inline title input (DEF-053).
    await dbView.getByTestId('add-row-btn').click();
    // The inline rename input appears; dismiss it to confirm the row in the table.
    const renameInput = page.getByRole('textbox', { name: /Name for new row/i });
    await expect(renameInput).toBeVisible();
    await renameInput.press('Escape');

    await expect(dbView.getByTestId('database-row')).toHaveCount(1);

    // Open the row action menu and delete the row.
    const rowEl = dbView.getByTestId('database-row').first();
    const actionsBtn = rowEl.getByRole('button', { name: /Actions for/i });
    await actionsBtn.click();

    await page.getByRole('menuitem', { name: /Delete row/i }).click();

    // Confirm the deletion.
    await page.getByRole('button', { name: /Delete permanently/i }).click();
    await page.waitForLoadState('networkidle');

    // The row must be gone.
    await expect(dbView.getByTestId('database-row')).toHaveCount(0);
  });
});

test.describe('Database table view — cell editing', () => {
  // These tests use seeded databases so there are rows available without needing add-row navigation.
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('edits a text cell in the table (Book Tracker — Notes)', async ({ page }) => {
    // "The Pragmatic Programmer" row in Book Tracker has no Notes value.
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // Find the Pragmatic Programmer row.
    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // The Notes column is the last property column — find the text input in that row.
    const textInput = pragRow.locator('input[type="text"]').last();
    await textInput.click();
    await textInput.fill('Test note');
    await textInput.blur();
    await page.waitForLoadState('networkidle');

    await expect(pragRow.locator('input[type="text"]').last()).toHaveValue('Test note');
  });

  test('edits a number cell in the table (Book Tracker — Rating)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // "The Pragmatic Programmer" row has no Rating.
    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // NumberCell uses type="text" with inputMode="decimal" for display formatting (DEF-061).
    const numInput = pragRow.locator('input[inputmode="decimal"]');
    await numInput.click();
    await numInput.fill('4');
    await numInput.blur();
    await page.waitForLoadState('networkidle');

    await expect(numInput).toHaveValue('4');
  });

  test('edits a checkbox cell in the table (Work Projects — Done)', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // "Accessibility audit" row has Done = false.
    const auditRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    const checkbox = auditRow.locator('input[type="checkbox"]');
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  });

  test('edits a url cell in the table (Book Tracker — Link)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // Book Tracker has 3 seeded rows:
    //   0: The Design of Everyday Things  — has Link (renders as anchor, not input)
    //   1: A Philosophy of Software Design — no Link (renders as input[type="url"])
    //   2: The Pragmatic Programmer        — has Link (renders as anchor, not input)
    // Use nth(1) to target the row with an empty Link cell.
    await expect(dbView.getByTestId('database-row')).toHaveCount(3);
    const philosophyRow = dbView.getByTestId('database-row').nth(1);

    const urlInput = philosophyRow.locator('input[type="url"]');
    await urlInput.click();
    await urlInput.fill('example.com');
    await urlInput.blur();
    await page.waitForLoadState('networkidle');

    // After blur the cell renders as a link.
    await expect(philosophyRow.getByRole('link', { name: /example\.com/i })).toBeVisible();
  });

  test('edits a select cell — picks a seeded status option (Work Projects)', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // "Performance baseline" has Status = "Done". Click to open the popover.
    // Work Projects rows in seed order:
    //   0: Phase 3: databases and table view (Status: In progress)
    //   1: Accessibility audit (Status: Backlog)
    //   2: Performance baseline (Status: Done)
    const perfRow = dbView.getByTestId('database-row').nth(2);

    const statusBtn = perfRow.locator('td').nth(1).locator('button').first();
    await statusBtn.click();

    // Scope option buttons to the Radix portal so we don't match the chip in the "Phase 3" row.
    const picker = page.locator('[data-radix-popper-content-wrapper]');
    await expect(picker).toBeVisible({ timeout: 3000 });

    // Click "Backlog" (unambiguous in the picker).
    await picker.getByRole('button', { name: 'Backlog' }).click();
    await page.waitForLoadState('networkidle');

    await expect(perfRow.getByText('Backlog')).toBeVisible();
  });

  test('edits a multiSelect cell — adds a tag (Work Projects)', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // "Performance baseline" has Tags = ["Backend"]. Add "Design".
    const perfRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Performance baseline/i }) });

    // Click the Tags cell trigger. After DEF-066 fix the MultiSelectCell trigger is a
    // div[role="button"], not a <button>. The chip remove controls are <button> siblings inside
    // the div. Use [role="button"] so the locator matches the trigger div and not the chip removes.
    // Clicking at position { x:4, y:4 } lands on the top-left padding of the trigger,
    // away from any chip content (chips are flex-centered).
    const tagsBtn = perfRow.locator('td').nth(2).locator('[role="button"]').first();
    await tagsBtn.click({ position: { x: 4, y: 4 } });

    // Scope to the Radix portal so we don't accidentally match the chip in another row.
    const multiPicker = page.locator('[data-radix-popper-content-wrapper]');
    await expect(multiPicker).toBeVisible({ timeout: 3000 });
    await multiPicker.getByRole('button', { name: 'Design' }).click();
    await page.waitForLoadState('networkidle');

    // Both Backend and Design chips should now appear.
    await expect(perfRow.getByText('Design')).toBeVisible();
    await expect(perfRow.getByText('Backend')).toBeVisible();
  });

  test('edits a date cell — picks a date from the day picker (Book Tracker)', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // "The Pragmatic Programmer" has no Finished date.
    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    await pragRow.getByText('Pick a date...').click();

    // Scope to the Radix portal. In react-day-picker v10 the data-day ISO-date attribute is on
    // the Day td element, not on the DayButton button inside it. The correct selector is
    // '[data-day] button' — match the td with the attribute and take the button child.
    const datePicker = page.locator('[data-radix-popper-content-wrapper]');
    await expect(datePicker).toBeVisible({ timeout: 5000 });
    const dayButton = datePicker.locator('[data-day] button').first();
    await expect(dayButton).toBeVisible({ timeout: 3000 });
    await dayButton.click();

    // The cell must now show a formatted date, not "Pick a date...".
    await expect(pragRow.getByText('Pick a date...')).toHaveCount(0);
  });
});

test.describe('Database table view — select option reuse', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('a user-defined select option is offered again on a second row of the same database', async ({
    page,
  }) => {
    await createDatabase(page);
    const dbView = page.getByTestId('database-view');

    await addProperty(page, 'Priority', 'select');

    // Add first row — in-place since DEF-053 fix; dismiss the inline title input.
    await dbView.getByTestId('add-row-btn').click();
    const renameInput1 = page.getByRole('textbox', { name: /Name for new row/i });
    await expect(renameInput1).toBeVisible();
    await renameInput1.press('Escape');
    await expect(dbView.getByTestId('database-row')).toHaveCount(1);

    const row1 = dbView.getByTestId('database-row').nth(0);
    await row1.getByText('Select...').click();
    await page.getByPlaceholder('New option...').fill('High');
    await page.getByPlaceholder('New option...').press('Enter');
    await page.waitForLoadState('networkidle');
    await expect(row1.getByText('High')).toBeVisible();

    // Add second row — in-place since DEF-053 fix.
    await dbView.getByTestId('add-row-btn').click();
    const renameInput2 = page.getByRole('textbox', { name: /Name for new row/i });
    await expect(renameInput2).toBeVisible();
    await renameInput2.press('Escape');
    await expect(dbView.getByTestId('database-row')).toHaveCount(2);

    // The second row should have the "High" option available without re-creating it.
    const row2 = dbView.getByTestId('database-row').nth(1);
    await row2.getByText('Select...').click();

    // Scope to the Radix portal to avoid matching "High" chips outside the open picker.
    const reusePortal = page.locator('[data-radix-popper-content-wrapper]');
    await expect(reusePortal).toBeVisible({ timeout: 3000 });
    await expect(reusePortal.getByRole('button', { name: 'High' })).toBeVisible();
    await reusePortal.getByRole('button', { name: 'High' }).click();
    await page.waitForLoadState('networkidle');
    await expect(row2.getByText('High')).toBeVisible();
  });

  test('select options have user-defined colors from the seeded data', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // The first row should have a colored Status chip.
    const firstRow = dbView.getByTestId('database-row').first();
    const statusCell = firstRow.locator('td').nth(1);
    // A chip is rendered as a styled span with the option name.
    const chip = statusCell.locator('span').filter({ hasText: /Backlog|In progress|Done|On hold/ });
    await expect(chip.first()).toBeVisible();
  });
});
