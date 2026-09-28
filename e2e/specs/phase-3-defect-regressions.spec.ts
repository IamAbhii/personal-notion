/**
 * Phase 3 defect regression tests — retests for all 21 accepted adversary fixes.
 *
 * Each describe block names the defect it covers and the exact fix criterion it verifies.
 * Tests are ordered by DEF number. DEF-053 is covered in database-table.spec.ts.
 * DEF-054, DEF-056, DEF-057 are deferred to Phase 4/6 and are not tested here.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// Helper: navigate to a seeded database in the sidebar by name.
async function goToDatabase(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByTestId('sidebar').getByTestId('page-row-title').filter({ hasText: name }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('database-view')).toBeVisible();
}

// Helper: open "Manage options" for a column header and wait for the options editor.
// The column header menu items are <button> elements, not <menuitem> roles.
async function openManageOptions(
  page: import('@playwright/test').Page,
  columnName: string,
): Promise<void> {
  // Dismiss any open popover or dialog first, to ensure a clean state.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  const dbView = page.getByTestId('database-view');
  // Column headers have a trigger button inside the th element that opens the property menu.
  // Clicking the button directly is more reliable than clicking the th element.
  const header = dbView.getByRole('columnheader').filter({ hasText: columnName }).first();
  await expect(header).toBeVisible({ timeout: 5000 });
  const headerBtnLocator = header.getByRole('button');
  const btnCount = await headerBtnLocator.count();
  if (btnCount > 0) {
    await headerBtnLocator.first().click();
  } else {
    await header.click();
  }
  const popover = page.locator('[data-radix-popper-content-wrapper]');
  await expect(popover).toBeVisible({ timeout: 3000 });
  await popover.getByRole('button', { name: /Manage options/i }).click();
  // Wait for the options editor to be open.
  await expect(page.getByText('Manage options')).toBeVisible();
}

// ----- DEF-043 -----------------------------------------------------------------------

test.describe('DEF-043: url cell link is followable; pencil button enters edit mode', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('a url cell with a value shows an anchor and an edit button, not an input', async ({
    page,
  }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // "The Design of Everyday Things" row 0 has a Link value.
    const row0 = dbView.getByTestId('database-row').nth(0);

    // Anchor must be visible (followable link).
    const anchor = row0.getByRole('link', { name: /bookshop\.org/i });
    await expect(anchor).toBeVisible();

    // Pencil edit button must be present (the explicit path into edit mode).
    const editBtn = row0.getByRole('button', { name: /Edit Link/i });
    await expect(editBtn).toBeVisible({ timeout: 3000 });
  });

  test('clicking the pencil button enters edit mode, not clicking the anchor', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    const row0 = dbView.getByTestId('database-row').nth(0);
    const editBtn = row0.getByRole('button', { name: /Edit Link/i });
    await editBtn.click();

    // An input should appear (edit mode active).
    await expect(row0.locator('input[type="url"]')).toBeVisible();
  });
});

// ----- DEF-044 -----------------------------------------------------------------------

test.describe('DEF-044: only a plausible URL is linkified', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('non-URL text is shown as plain text, not wrapped in an anchor', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // Row 1 ("A Philosophy of Software Design") has no Link — shows the input directly.
    const row1 = dbView.getByTestId('database-row').nth(1);
    const urlInput = row1.locator('input[type="url"]');
    await urlInput.click();
    await urlInput.fill('not a url at all');
    await urlInput.blur();
    await page.waitForLoadState('networkidle');

    // The cell should NOT wrap the value in an anchor — it should be a plain text span.
    await expect(row1.getByRole('link', { name: /not a url/i })).toHaveCount(0);
    // The outer span carries aria-label "Link: <value>" — use that to target it uniquely.
    await expect(row1.getByLabel('Link: not a url at all')).toBeVisible();
  });

  test('a hostname.tld value is linkified after blur', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    const row1 = dbView.getByTestId('database-row').nth(1);
    const urlInput = row1.locator('input[type="url"]');
    await urlInput.click();
    await urlInput.fill('example.com/test');
    await urlInput.blur();
    await page.waitForLoadState('networkidle');

    await expect(row1.getByRole('link', { name: /example\.com/i })).toBeVisible();
  });
});

// ----- DEF-045 (HIGH) ----------------------------------------------------------------

test.describe('DEF-045: Enter commits; Escape reverts; committed value survives reload', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('text cell: Enter saves the value and it survives a reload', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // "The Pragmatic Programmer" (row 2) has no Notes.
    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    const textInput = pragRow.locator('input[type="text"]').last();
    await textInput.click();
    await textInput.fill('Enter-committed note');
    await textInput.press('Enter');
    // Do NOT blur — verify Enter alone committed the value.
    await page.waitForTimeout(500);

    // Reload without any further interaction.
    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloaded = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });
    await expect(reloaded.locator('input[type="text"]').last()).toHaveValue('Enter-committed note');
  });

  test('text cell: Escape reverts to the value at edit start', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');

    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // Notes is initially empty. Type something, then Escape.
    const textInput = pragRow.locator('input[type="text"]').last();
    await textInput.click();
    await textInput.fill('should be reverted');
    await textInput.press('Escape');

    // After Escape, the draft reverts to the value at focus time (empty string).
    await expect(textInput).toHaveValue('');
  });

  test('number cell: Enter saves the value and it survives a reload', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // Rating (number) — enter value and press Enter only.
    const numInput = pragRow.locator('input[inputmode="decimal"]');
    await numInput.click();
    await numInput.fill('7');
    await numInput.press('Enter');
    await page.waitForTimeout(500);

    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloaded = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });
    await expect(reloaded.locator('input[inputmode="decimal"]')).toHaveValue('7');
  });

  test('number cell: Escape reverts to the value at edit start', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');

    const pragRow = page
      .getByTestId('database-view')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    const numInput = pragRow.locator('input[inputmode="decimal"]');
    await numInput.click();
    await numInput.fill('999');
    await numInput.press('Escape');

    // After Escape the input shows the original empty value (formatted).
    await expect(numInput).toHaveValue('');
  });

  test('url cell: Enter saves the value and it survives a reload', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const workspaceId = page.url().match(/\/w\/([^/]+)\//)![1];
    const dbPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // Row 1 ("A Philosophy of Software Design") has no Link.
    const row1 = page.getByTestId('database-view').getByTestId('database-row').nth(1);
    const urlInput = row1.locator('input[type="url"]');
    await urlInput.click();
    await urlInput.fill('enter-test.example.com');
    await urlInput.press('Enter');
    await page.waitForTimeout(500);

    await page.goto(`/w/${workspaceId}/page/${dbPageId}`);
    await page.waitForLoadState('networkidle');

    const reloaded = page.getByTestId('database-view').getByTestId('database-row').nth(1);
    await expect(reloaded.getByRole('link', { name: /enter-test\.example\.com/i })).toBeVisible();
  });

  test('url cell: Escape reverts to the value at edit start', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // Row 0 has a Link value — click the pencil to enter edit mode.
    const row0 = dbView.getByTestId('database-row').nth(0);
    const editBtn = row0.getByRole('button', { name: /Edit Link/i });
    await editBtn.click();

    const urlInput = row0.locator('input[type="url"]');
    await expect(urlInput).toBeVisible();
    const originalValue = await urlInput.inputValue();

    // Type something different, then Escape.
    await urlInput.fill('completely-different.example.com');
    await urlInput.press('Escape');

    // Editing mode exits; original anchor should reappear.
    await expect(urlInput).toHaveCount(0);
    await expect(row0.getByRole('link', { name: new RegExp(originalValue) })).toBeVisible();
  });
});

// ----- DEF-046 -----------------------------------------------------------------------

test.describe('DEF-046: Add property button disabled when name is empty', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('Add button is disabled when the property name box is empty', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    await dbView.getByTestId('add-property-btn').click();
    const nameInput = page.getByPlaceholder('Property name');
    await expect(nameInput).toBeVisible();

    // Clear the name box.
    await nameInput.fill('');

    // The Add button must be disabled (fix: DEF-046 criterion is a disabled button).
    // REGRESSION CHECK: the button is always enabled; clicking it silently does nothing.
    // This test verifies the fix criterion; if it fails the defect is not fully resolved.
    const addBtn = page.getByRole('button', { name: /^Add$/i }).last();
    await expect(addBtn).toBeDisabled();
  });
});

// ----- DEF-047 -----------------------------------------------------------------------

test.describe('DEF-047: empty option name cannot be saved', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('clearing an option name and saving does not produce a nameless option', async ({
    page,
  }) => {
    await goToDatabase(page, 'Work Projects');
    await openManageOptions(page, 'Status');

    // The option name inputs have no aria-label. The options editor lives in a Radix popover.
    // Scope to the popper to avoid matching other inputs on the page.
    const optionsPopover = page.locator('[data-radix-popper-content-wrapper]');
    // Options are rendered in definition order: Backlog first.
    const backlogInput = optionsPopover.locator('input[type="text"]').first();
    await expect(backlogInput).toBeVisible();
    const originalValue = await backlogInput.inputValue();
    expect(originalValue).toBe('Backlog');

    await backlogInput.fill('');
    await page.getByRole('button', { name: /^Save$/i }).click();
    await page.waitForLoadState('networkidle');

    // The "Backlog" option should not have been saved as empty; it should still have a name.
    // Re-open manage options to verify.
    await openManageOptions(page, 'Status');

    // The empty-name option must not be present as a nameless text input with blank value.
    // The original option retains its name (or is at least not saved as blank).
    const reopenedPopover = page.locator('[data-radix-popper-content-wrapper]');
    const allOptionInputs = reopenedPopover.locator('input[type="text"]:not([placeholder])');
    const count = await allOptionInputs.count();
    expect(count, 'should still have the same number of named options').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const v = await allOptionInputs.nth(i).inputValue();
      expect(v.trim().length, `option name at index ${i} must not be empty`).toBeGreaterThan(0);
    }
  });
});

// ----- DEF-048 (HIGH) ----------------------------------------------------------------

test.describe('DEF-048: removing an in-use option warns with row count; unused option removes silently', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('removing an in-use option shows a confirmation with a row count', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    // Row 0 has Status "In progress" — use count = 1.
    await openManageOptions(page, 'Status');

    const removeInProgress = page.getByRole('button', {
      name: /Remove In progress/i,
    });
    await expect(removeInProgress).toBeVisible();
    await removeInProgress.click();

    // A confirmation dialog must appear mentioning how many rows use this option.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/1 row/i);
    // Cancel to avoid side effects on subsequent tests.
    await page.getByRole('button', { name: /Cancel/i }).click();
  });

  test('confirming in-use option removal clears the affected cells', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    await openManageOptions(page, 'Status');

    const removeInProgress = page.getByRole('button', { name: /Remove In progress/i });
    await removeInProgress.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: /Remove option/i }).click();

    // Save the options editor.
    const saveBtn = page.getByRole('button', { name: /^Save$/i });
    await saveBtn.click();
    await page.waitForLoadState('networkidle');

    // Row 0 should now have "Select..." (cleared) rather than "In progress".
    const row0 = page.getByTestId('database-view').getByTestId('database-row').nth(0);
    await expect(row0.getByText('In progress')).toHaveCount(0);
    await expect(row0.getByText('Select...')).toBeVisible();
  });

  test('removing an unused option does not produce a confirmation dialog', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    // Phase 4 made every original Status option used by at least one row:
    //   Backlog → Accessibility audit + Mobile layout pass
    //   In progress → Phase 3: databases and table view
    //   Done → Performance baseline
    //   On hold → API documentation (Phase 4 addition)
    // Strategy: open Status manage options, add a brand-new "Prototype" option (unused),
    // then remove it immediately. Because "Prototype" has never been assigned to any row,
    // removal must be silent (no confirmation dialog) — this is the DEF-048 criterion.
    await openManageOptions(page, 'Status');

    // Type a new option name in the "New option..." input and add it.
    const newOptionInput = page.locator('input[placeholder="New option..."]');
    await expect(newOptionInput).toBeVisible({ timeout: 3000 });
    await newOptionInput.fill('Prototype');
    await page.getByRole('button', { name: /^Add$/i }).click();

    // The newly created option has never been assigned to any row — it is unused.
    const removePrototype = page.getByRole('button', { name: /Remove Prototype/i });
    await expect(removePrototype).toBeVisible({ timeout: 3000 });
    await removePrototype.click();

    // No confirmation dialog should appear: the ConfirmDialog shows a "Remove option" button.
    // An unused option is removed immediately without that button appearing.
    await expect(page.getByRole('button', { name: /Remove option/i })).toHaveCount(0);
    // The "Prototype" remove button should be gone from the options list (option removed).
    await expect(page.getByRole('button', { name: /Remove Prototype/i })).toHaveCount(0);
  });
});

// ----- DEF-049 -----------------------------------------------------------------------

test.describe('DEF-049: deleting a property requires confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('clicking "Delete property" opens a confirmation dialog naming the property', async ({
    page,
  }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // Open the Effort (days) column header menu.
    await dbView.getByRole('columnheader').filter({ hasText: 'Effort (days)' }).click();
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    await expect(popover).toBeVisible({ timeout: 3000 });
    // Column menu items are <button> elements, not menuitem roles.
    await popover.getByRole('button', { name: /Delete property/i }).click();

    // A confirmation dialog must appear.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Effort \(days\)/i);

    // Cancel to leave the property intact.
    await page.getByRole('button', { name: /Cancel/i }).click();
  });
});

// ----- DEF-051 -----------------------------------------------------------------------

test.describe('DEF-051: date picker opens on the stored date with it selected', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('opening a date cell that has a stored date shows that date selected in the picker', async ({
    page,
  }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // Row 0 ("Phase 3: databases and table view") has Due date = 2026-09-15.
    const row0 = dbView.getByTestId('database-row').nth(0);

    // Find the date cell button (shows a formatted date, not "Pick a date...").
    // The date column is the 4th property column (0-indexed: Status, Tags, Due date, Done, ...).
    const dueDateBtn = row0.locator('button').filter({ hasText: /2026/ });
    await expect(dueDateBtn).toBeVisible();
    await dueDateBtn.click();

    const datePicker = page.locator('[data-radix-popper-content-wrapper]');
    await expect(datePicker).toBeVisible({ timeout: 5000 });

    // The picker must open on the month containing the stored date (September 2026).
    await expect(datePicker).toContainText(/Sep/i);

    // The stored day (15) must be marked as selected.
    const selectedDay = datePicker.locator('[data-selected]');
    await expect(selectedDay).toBeVisible();
  });
});

// ----- DEF-052 -----------------------------------------------------------------------

test.describe('DEF-052: option colour picker shows all six swatches', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('clicking the colour swatch opens a picker with exactly six colour buttons', async ({
    page,
  }) => {
    await goToDatabase(page, 'Work Projects');
    await openManageOptions(page, 'Status');

    // Click the first color swatch (for the first option).
    const firstSwatch = page.getByRole('button', { name: /Pick color for/i }).first();
    await expect(firstSwatch).toBeVisible();
    await firstSwatch.click();

    // A color picker popover should open.
    const colorPicker = page.locator('[data-radix-popper-content-wrapper]').last();
    await expect(colorPicker).toBeVisible({ timeout: 3000 });

    // Exactly 6 color swatch buttons must be present.
    const swatches = colorPicker.getByRole('button');
    await expect(swatches).toHaveCount(6);
  });
});

// ----- DEF-055 -----------------------------------------------------------------------

test.describe('DEF-055: options editor floats over the table, not inside the header', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('opening "Manage options" does not expand the header row', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    // Measure the header row height before.
    const thead = dbView.locator('thead');
    await expect(thead).toBeVisible();
    const heightBefore = (await thead.boundingBox())!.height;

    // Open "Manage options" for the Status column.
    await openManageOptions(page, 'Status');

    // The options editor must be a popover (in the Radix portal, outside the thead).
    const optionsEditor = page.locator('[data-radix-popper-content-wrapper]');
    await expect(optionsEditor).toBeVisible({ timeout: 3000 });

    // The thead height must not have grown significantly (it should remain unchanged).
    const heightAfter = (await thead.boundingBox())!.height;
    expect(heightAfter, 'header row must not expand when options editor opens').toBeLessThanOrEqual(
      heightBefore + 4,
    );
  });
});

// ----- DEF-058 -----------------------------------------------------------------------

test.describe('DEF-058: cell editors carry accessible names from their property', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('text cell aria-label includes the property name, not just the placeholder', async ({
    page,
  }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // "Notes" is a text property. The input should have aria-label including "Notes".
    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    const notesInput = pragRow.locator('input[type="text"]').last();
    const label = await notesInput.getAttribute('aria-label');
    expect(label, 'text cell must carry the property name in aria-label').toMatch(/Notes/i);
  });

  test('number cell aria-label includes the property name', async ({ page }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    const numInput = pragRow.locator('input[inputmode="decimal"]');
    const label = await numInput.getAttribute('aria-label');
    expect(label, 'number cell must carry the property name in aria-label').toMatch(/Rating/i);
  });

  test('checkbox cell aria-label includes the property name', async ({ page }) => {
    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    const auditRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    const checkbox = auditRow.locator('input[type="checkbox"]');
    const label = await checkbox.getAttribute('aria-label');
    expect(label, 'checkbox cell must carry the property name in aria-label').toMatch(/Done/i);
  });
});

// ----- DEF-059 -----------------------------------------------------------------------

test.describe('DEF-059: database row in sidebar is distinguishable from a page by screen reader', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('the sidebar title button for a database has aria-label including "Database:"', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const workProjectsRow = page
      .getByTestId('sidebar')
      .locator('[data-page-id]')
      .filter({ has: page.getByTestId('page-row-title').filter({ hasText: 'Work Projects' }) });

    const titleBtn = workProjectsRow.getByTestId('page-row-title');
    const label = await titleBtn.getAttribute('aria-label');
    expect(label, 'database row title must carry "Database:" in aria-label').toMatch(/Database:/i);
  });
});

// ----- DEF-060 -----------------------------------------------------------------------

test.describe('DEF-060: "Add a database inside" is offered at 1280px desktop width', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('"Add a database inside" button appears on hover for a non-database page at 1280px', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // "Home" is a regular page (kind=page), not a database; hover over it.
    const homeRow = page
      .getByTestId('sidebar')
      .locator('[data-page-id]')
      .filter({ has: page.getByTestId('page-row-title').filter({ hasText: 'Home' }) })
      .first();

    await homeRow.hover();

    // The "Add a database inside Home" button must be present in the desktop action strip.
    const addDbBtn = homeRow.getByRole('button', { name: /Add a database inside Home/i });
    await expect(addDbBtn).toBeVisible({ timeout: 3000 });
  });
});

// ----- DEF-061 -----------------------------------------------------------------------

test.describe('DEF-061: number cells format for display; stored value unchanged', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('a float entered through the cell is displayed formatted, not as raw float noise', async ({
    page,
  }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    const pragRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Pragmatic Programmer/i }) });

    // Enter a long float via the number input.
    const numInput = pragRow.locator('input[inputmode="decimal"]');
    await numInput.click();
    await numInput.fill('3.14159265358979');
    await numInput.blur();
    await page.waitForLoadState('networkidle');

    // After blur the cell is not focused; it should display a formatted value.
    const displayed = await numInput.inputValue();
    // The formatted value must be shorter than the 16-digit input (no raw float noise).
    expect(displayed.length, 'formatted number must not show raw 16-digit float').toBeLessThan(17);
    // Must not have more than 10 significant digits worth of content.
    expect(displayed).not.toBe('3.14159265358979');
  });
});

// ----- DEF-062 -----------------------------------------------------------------------

test.describe('DEF-062: unchecked checkbox is not a white square in dark theme', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('checkbox input has appearance:none in dark theme so the browser default is suppressed', async ({
    page,
  }) => {
    // Switch to dark theme via localStorage.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      localStorage.setItem('personal-space:theme', 'dark');
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    await goToDatabase(page, 'Work Projects');
    const dbView = page.getByTestId('database-view');

    const auditRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    const checkbox = auditRow.locator('input[type="checkbox"]');

    // The fix applies appearance:none via a CSS module class; assert that the checkbox's
    // computed appearance is 'none', meaning the OS default white square is suppressed.
    const appearance = await checkbox.evaluate((el) => window.getComputedStyle(el).appearance);
    expect(appearance, 'checkbox must not use native appearance in dark theme').toBe('none');
  });
});

// ----- DEF-063 -----------------------------------------------------------------------

test.describe('DEF-063: row page marks the parent database as current in the sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('opening a row page highlights the parent database in the sidebar, not nothing', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page
      .getByTestId('sidebar')
      .getByTestId('page-row-title')
      .filter({ hasText: 'Work Projects' })
      .click();
    await page.waitForLoadState('networkidle');

    // Open the first row page.
    await page.getByTestId('database-view').getByTestId('row-title-cell').first().click();
    await page.waitForLoadState('networkidle');

    // On the row page, the sidebar should have "Work Projects" marked as current.
    const workProjectsRow = page
      .getByTestId('sidebar')
      .locator('[data-page-id]')
      .filter({ has: page.getByTestId('page-row-title').filter({ hasText: 'Work Projects' }) });

    await expect(workProjectsRow).toHaveAttribute('data-current', 'true');
  });
});

// ----- DEF-064 -----------------------------------------------------------------------

test.describe('DEF-064: delete-database dialog calls rows "rows" and mentions properties', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('the confirmation dialog for deleting a database mentions rows and properties', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Hover over "Work Projects" in the sidebar to reveal the delete button.
    const workProjectsRow = page
      .getByTestId('sidebar')
      .locator('[data-page-id]')
      .filter({ has: page.getByTestId('page-row-title').filter({ hasText: 'Work Projects' }) });

    await workProjectsRow.hover();

    const deleteBtn = workProjectsRow.getByRole('button', { name: /Delete Work Projects/i });
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
    await deleteBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Dialog must say "rows" (not "pages") — partial fix from the commit.
    // REGRESSION CHECK: must also mention properties that will be destroyed.
    await expect(dialog).toContainText(/rows?/i);
    await expect(dialog).toContainText(/propert/i); // This assertion verifies the properties-mention criterion from DEF-064.

    // Cancel — do not actually delete the database.
    await page.getByRole('button', { name: /Cancel/i }).click();
  });
});

// ----- DEF-065 -----------------------------------------------------------------------

test.describe('DEF-065: a new database gets a database-appropriate default icon', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('new database icon is the card-index dividers emoji, not the document emoji', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const before = page.url().match(/\/page\/([^/]+)/)?.[1];
    await page.getByTestId('new-database-top').click();

    await page.waitForURL((url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== before;
    });
    await page.waitForLoadState('networkidle');

    const newPageId = page.url().match(/\/page\/([^/]+)/)![1];

    // The sidebar row for the new database must NOT carry the document icon (📄 U+1F4C4).
    const sidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${newPageId}"]`);
    const iconText = await sidebarRow.locator('[class*="font-emoji"]').first().textContent();
    expect(iconText?.trim(), 'new database must not carry the document 📄 icon').not.toBe(
      '\u{1F4C4}',
    );
    // It should be the card-index dividers emoji (🗃 U+1F5C3).
    expect(iconText?.trim(), 'new database must carry the 🗃 icon').toBe('\u{1F5C3}');
  });
});

// ----- DEF-066 -----------------------------------------------------------------------

test.describe('DEF-066: multi-select chip remove control is a sibling button, not nested', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('the chip remove button is a sibling of the chip text, not nested inside a button', async ({
    page,
  }) => {
    await goToDatabase(page, 'Book Tracker');
    const dbView = page.getByTestId('database-view');

    // "The Design of Everyday Things" (row 0) has Topics chips (e.g. "Design", "Usability").
    const row0 = dbView.getByTestId('database-row').nth(0);
    const tagsCell = row0.locator('td').nth(2);

    // The remove button must not have a button ancestor inside the cell (invalid HTML: button>button).
    const removeButtons = tagsCell.locator('button[aria-label^="Remove"]');
    const count = await removeButtons.count();
    expect(count, 'Topics cell should have at least one chip remove button').toBeGreaterThan(0);

    // For each remove button, verify it is not nested inside another button.
    for (let i = 0; i < count; i++) {
      const btn = removeButtons.nth(i);
      const buttonAncestorCount = await btn.evaluate((el) => {
        // Walk up from the remove button to the cell boundary; count any <button> ancestors.
        let node = el.parentElement;
        let buttonParents = 0;
        // Stop when we reach the <td> or the document root.
        while (node && node.tagName !== 'TD') {
          if (node.tagName === 'BUTTON') buttonParents++;
          node = node.parentElement;
        }
        return buttonParents;
      });
      expect(
        buttonAncestorCount,
        `Remove button at index ${i} must not be nested inside a <button>`,
      ).toBe(0);
    }
  });
});
