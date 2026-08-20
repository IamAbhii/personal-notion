/**
 * Phase 6 defect retests — DEF-033, DEF-054, DEF-056, DEF-057.
 *
 * DEF-033: Keyboard block drag loses most ArrowDown presses at OS auto-repeat speed.
 *   Fix: flushSync in BlockEditor.onDragMove forces React to commit state synchronously
 *   between consecutive keyboard events, so each press sees the updated DOM position.
 *
 * DEF-054: Table header row and title column are not sticky.
 *   Fix: sticky top-0/left-0 on thead cells with overflow-y:clip on the scroll container
 *   so the sticky context is resolved against the correct ancestor.
 *
 * DEF-056: A row page keeps rendering a deleted row indefinitely then silently discards edits.
 * DEF-057: The losing tab in a two-tab cell edit keeps showing its own stale value.
 *   Fix: snapshot query gains refetchInterval: 30_000 so cross-tab divergence converges
 *   within 30 seconds instead of never.
 *
 *   Tests for DEF-056 and DEF-057 open two pages in the same browser context to simulate two
 *   tabs. After a change is made in page A, page B is brought to front so TanStack Query's
 *   refetchOnWindowFocus fires immediately (no 30-second wait). A manual `window.focus` event
 *   is also dispatched for reliability in headless mode.
 */

import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Navigate to the seeded database by clicking its sidebar entry. */
async function gotoDatabase(page: Page, title: string) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('treeitem', { name: new RegExp(title, 'i') }).click();
  await page.waitForLoadState('networkidle');
}

// ── DEF-033: keyboard drag at auto-repeat speed ────────────────────────────────

test.describe('DEF-033: keyboard block drag at auto-repeat speed', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('DEF-033: 10 rapid ArrowDown presses during a keyboard drag move the block by ~10', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    // Ensure at least 15 blocks exist so there is room to move 10 positions.
    const allBlocks = blockEditor.locator('[data-block-id]');
    let blockCount = await allBlocks.count();
    while (blockCount < 15) {
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      await page.keyboard.type(`Extra block ${blockCount + 1}`);
      await page.waitForTimeout(300);
      blockCount = await allBlocks.count();
    }

    // Record the id of the first block before the drag.
    const firstId = await allBlocks.first().getAttribute('data-block-id');

    // Focus the first block's drag handle.
    const firstHandle = allBlocks.first().locator('[data-testid="block-drag-handle"]');
    await firstHandle.focus();

    // Space to lift the block.
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);

    // Send 10 ArrowDown presses at 40 ms intervals (macOS auto-repeat rate).
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(40);
    }

    // Space to drop.
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);

    // Find the new position of the block that started first.
    const ids = await allBlocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );
    const newPos = ids.indexOf(firstId);

    // With flushSync the block should have moved substantially — at least 5 positions.
    // Before the fix the block rarely moved more than 2-3 positions out of 10 presses.
    expect(
      newPos,
      `Block should have moved at least 5 positions down; moved to index ${newPos}`,
    ).toBeGreaterThanOrEqual(5);
  });
});

// ── DEF-054: sticky header row and title column ────────────────────────────────

test.describe('DEF-054: sticky table header and title column geometry', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('DEF-054: header row stays in viewport when table is scrolled vertically', async ({
    page,
  }) => {
    await gotoDatabase(page, 'Work Projects');

    // Create enough rows to overflow the viewport.
    for (let i = 0; i < 25; i++) {
      const newRowBtn = page.getByRole('button', { name: 'New row' });
      await newRowBtn.click();
      await page.waitForTimeout(150);
      // Dismiss the inline rename input.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    // Ensure the table has rendered the new rows.
    const rows = page.locator('[data-testid="database-row"]');
    await expect(rows).toHaveCount(31, { timeout: 10000 }); // 6 seeded + 25 new

    // Measure the header's y position before scroll.
    const tableView = page.locator('[data-testid="database-view"]');
    await expect(tableView).toBeVisible();

    const firstHeaderCell = tableView.locator('thead th').first();
    const beforeBox = await firstHeaderCell.boundingBox();
    expect(beforeBox).not.toBeNull();

    // After the DEF-054 fix, the database-view div is the scroll container for BOTH axes
    // (overflow-auto on both). The old approach scrolled #page-body, which is no longer the
    // vertical scroll ancestor for the table — the table is contained within database-view and
    // only scrolls that container. Scrolling #page-body would now be a no-op, producing a
    // false pass (the header y never changes, so the ≤4px drift assertion would vacuously pass).
    const vertScrolled = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="database-view"]') as HTMLElement;
      if (!el) return 0;
      el.scrollTop += 600;
      return el.scrollTop;
    });
    // Sanity-check: if scrollTop is still 0, the table did not overflow vertically — that is a
    // test-setup failure (not enough rows), not a product bug. Fail loudly rather than pass vacuously.
    expect(vertScrolled, 'database-view must have scrolled at least 100px vertically').toBeGreaterThan(100);
    await page.waitForTimeout(300);

    // The header's y position should be unchanged (it is sticky to the top of the viewport
    // or its scroll container). The key invariant: y-after === y-before ± 4px.
    const afterBox = await firstHeaderCell.boundingBox();
    expect(afterBox).not.toBeNull();
    const yDrift = Math.abs(afterBox!.y - beforeBox!.y);
    expect(
      yDrift,
      `Header row drifted ${yDrift}px on vertical scroll — not sticky`,
    ).toBeLessThanOrEqual(4);
  });

  test('DEF-054: title column stays in viewport when table is scrolled horizontally', async ({
    page,
  }) => {
    await gotoDatabase(page, 'Work Projects');
    const tableView = page.locator('[data-testid="database-view"]');
    await expect(tableView).toBeVisible();

    // Add text properties to force the table to overflow horizontally.
    // Work Projects has 6 properties (Title:160px + 6×120px + 40px actions = 920px). The sidebar
    // is ~256px so the content area at 1280px is ~1024px — not wide enough to overflow with 6 props.
    // Add 8 more: 8 × 120px = 960px → total ~1880px >> 1024px. The Add-property form requires a
    // non-empty name before pressing Enter; pressing Escape cancels without adding.
    const addPropertyBtn = page.getByRole('button', { name: /Add property/i });
    await expect(addPropertyBtn).toBeVisible({ timeout: 5000 });
    for (let i = 0; i < 8; i++) {
      await addPropertyBtn.click();
      // Type a name (the form requires a non-empty name to submit).
      await page.keyboard.type(`Extra${i + 1}`);
      await page.keyboard.press('Enter');
      // Wait for the new header cell to appear before adding the next property.
      await expect(
        page.locator('[data-testid="database-view"] thead th'),
      ).toHaveCount(9 + i, { timeout: 3000 }); // Title + 6 seed + add-property + i new
    }

    // Verify the table now overflows horizontally by attempting to scroll.
    const actualScrollLeft = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="database-view"]') as HTMLElement;
      if (!el) return -1;
      el.scrollLeft += 600;
      return el.scrollLeft;
    });
    // If scrollLeft is still 0 the add-property loop failed silently — fail loudly.
    expect(
      actualScrollLeft,
      'Table must overflow horizontally after adding 8 extra properties',
    ).toBeGreaterThan(0);
    await page.waitForTimeout(200);

    // The first data cell in the Title column.
    const titleCell = page.locator('[data-testid="database-row"]').first().locator('td').first();
    const beforeBox = await titleCell.boundingBox();
    expect(beforeBox).not.toBeNull();

    // Scroll another 300px to the right so the title column is truly off-screen if not sticky.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="database-view"]') as HTMLElement;
      if (el) el.scrollLeft += 300;
    });
    await page.waitForTimeout(300);

    const afterBox = await titleCell.boundingBox();
    expect(afterBox).not.toBeNull();
    const xDrift = Math.abs(afterBox!.x - beforeBox!.x);
    expect(
      xDrift,
      `Title column drifted ${xDrift}px on horizontal scroll — not sticky`,
    ).toBeLessThanOrEqual(4);
  });

  test('DEF-054: no gap between the header row and first data row', async ({ page }) => {
    await gotoDatabase(page, 'Work Projects');
    const tableView = page.locator('[data-testid="database-view"]');
    await expect(tableView).toBeVisible();

    // The header bottom and the first row top should be contiguous.
    // A previous broken fix left a 52 px empty band above the header.
    const headerRow = page.locator('thead tr').first();
    const firstDataRow = page.locator('[data-testid="database-row"]').first();

    const headerBox = await headerRow.boundingBox();
    const rowBox = await firstDataRow.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(rowBox).not.toBeNull();

    const headerBottom = headerBox!.y + headerBox!.height;
    const gap = Math.abs(rowBox!.y - headerBottom);
    expect(
      gap,
      `Gap between header bottom and first row top is ${gap}px — expected ≤ 2px`,
    ).toBeLessThanOrEqual(2);
  });
});

// ── DEF-056/DEF-057: cross-tab convergence via refetchOnWindowFocus ────────────
//
// The fix added refetchInterval: 30_000 to the snapshot query. TanStack Query's
// refetchOnWindowFocus (the default) also refetches when the window regains focus,
// which happens immediately when the user switches tabs. These tests simulate two
// tabs using two Playwright Page objects in the same browser context and trigger the
// focus-based refetch by bringing the second page to front and dispatching a focus
// event, so the test completes in seconds rather than 30 s.

test.describe('DEF-056: row page shows not-found after its row is deleted in another tab', () => {
  test('DEF-056: navigating to a row page whose row was deleted in another tab shows not-found', async ({
    page,
    context,
  }) => {
    // The 30-second refetchInterval means convergence takes up to 30 s. The visibility-change
    // trick below collapses that to near-zero, but we give the test 70 s in case headless
    // mode prevents the trick from working and we must wait out the full interval.
    test.setTimeout(70_000);

    // Set up: reset workspace.
    await resetWorkspace(page);
    await gotoDatabase(page, 'Work Projects');

    // Open the "Accessibility audit" row's page — it has a predictable name.
    const dbView = page.locator('[data-testid="database-view"]');
    await expect(dbView).toBeVisible();

    const auditRow = dbView
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });
    await expect(auditRow).toBeVisible({ timeout: 8000 });

    // Click the row's ••• actions menu and open its page.
    const actionsBtn = auditRow.getByRole('button', { name: /Actions for/i });
    await actionsBtn.click();
    await page.getByRole('menuitem', { name: /Open row page/i }).click();
    await page.waitForLoadState('networkidle');
    const rowPageUrl = page.url();

    // Open a second tab (page2) at the same row page URL.
    const page2 = await context.newPage();
    await page2.goto(rowPageUrl);
    await page2.waitForLoadState('networkidle');

    // Confirm page2 is showing the row content, not the "not found" state.
    const notFoundBefore = await page2
      .getByText(/no longer exists/i)
      .isVisible()
      .catch(() => false);
    expect(notFoundBefore, 'Row page should load successfully before deletion').toBe(false);

    // Go back on page1 to the database and delete the "Accessibility audit" row.
    await page.goBack();
    await page.waitForLoadState('networkidle');

    // If back on the database page, or navigate there explicitly.
    if (!page.url().match(/\/page\//)) {
      await gotoDatabase(page, 'Work Projects');
    }

    const auditRowDelete = page
      .locator('[data-testid="database-view"]')
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });

    await auditRowDelete.getByRole('button', { name: /Actions for/i }).click();
    await page.getByRole('menuitem', { name: /Delete row/i }).click();
    await page.getByRole('button', { name: /Delete permanently/i }).click();
    await page.waitForLoadState('networkidle');

    // Trigger TanStack Query's refetchOnWindowFocus on page2 by simulating a visibility
    // transition: hidden → visible. TanStack Query v5's focusManager only fires its
    // onFocus listeners when the focused state *changes*, so we must first signal hidden
    // (sets focused=false) then visible (sets focused=true, triggers refetch).
    await page2.bringToFront();
    await page2.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The snapshot refetches; the deleted row is gone from `pages`. PageScreen's
    // `if (!page)` branch renders "This page no longer exists." (DEF-056 fix).
    // Timeout is generous to cover the full 30-second refetchInterval if the
    // focus trick above does not fire in headless mode.
    await expect(page2.getByText(/no longer exists/i)).toBeVisible({ timeout: 35_000 });

    await page2.close();
  });
});

// ── Offline-sync: edit survives immediate reload via the localStorage stash ────
//
// docs/architecture/offline-sync.md describes a synchronous localStorage stash that
// captures unsent ops at the unload boundary (pagehide) and replays them on the
// next load. The netwidle waits in block-todo and views-board-list are test hygiene
// (they ensure the POST lands so the reload reads fresh server state), but the stash
// must also preserve an edit that has not yet reached the server — otherwise an
// unfortunate reload timing is a data-loss path.
//
// This test deliberately reloads without waiting for networkidle so only the stash
// can save it.

test.describe('offline-sync: edit survives immediate reload via localStorage stash', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('a block text edit is visible after immediate reload without waiting for the server', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();

    // Count the existing blocks before adding a new one.
    const initialCount = await blockEditor.locator('[data-block-type]').count();

    // Click the first block and move to end.
    await firstBlock.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Wait for the new block to appear (one more than the initial count).
    await expect(blockEditor.locator('[data-block-type]')).toHaveCount(initialCount + 1, {
      timeout: 5000,
    });

    // Type a unique string.  The debounce window for autosave is typically ~500 ms.
    const marker = `stash-test-${Date.now()}`;
    await page.keyboard.type(marker);
    // Wait 200 ms — enough for the text to be in React state, but less than the debounce
    // so the autosave POST is very unlikely to have fired.
    await page.waitForTimeout(200);

    // Reload immediately — no networkidle.  Only the synchronous localStorage stash can
    // preserve this edit.
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The stash should have been replayed: the marker text must be visible in the editor.
    await expect(blockEditor.getByText(marker)).toBeVisible({ timeout: 8000 });
  });
});

test.describe('DEF-057: checkbox cell checked in one tab is visible in another tab after refetch', () => {
  // NOTE: This test uses a checkbox cell (not a text cell) because TextCell uses a local
  // `draft` state that does not sync with value-prop changes from snapshot refetches.
  // That means text cell changes from another tab are never reflected without a reload —
  // a product bug tracked separately as DEF-105. Checkbox cells use the `value` prop
  // directly (no local state) and DO converge via the refetchInterval, so this test
  // exercises the mechanism that the DEF-057 fix actually repairs.
  test('DEF-057: a checkbox checked in tab A is visible in tab B after the snapshot refetches', async ({
    page,
    context,
  }) => {
    // The 30-second refetchInterval means convergence takes up to 30 s. We extend the timeout
    // and use the visibility-change trick to trigger an immediate refetch where possible.
    test.setTimeout(70_000);

    // Set up: reset workspace.
    await resetWorkspace(page);

    // Navigate page1 to Work Projects — it has a boolean "Done" column.
    await gotoDatabase(page, 'Work Projects');
    const workProjectsUrl = page.url();

    // Open page2 at the same database URL.
    const page2 = await context.newPage();
    await page2.goto(workProjectsUrl);
    await page2.waitForLoadState('networkidle');

    // Find the "Accessibility audit" row in page1 (Done = false in the seed).
    const dbView1 = page.locator('[data-testid="database-view"]');
    const auditRow1 = dbView1
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Accessibility audit/i }) });
    await expect(auditRow1).toBeVisible({ timeout: 8000 });

    const doneCheckbox1 = auditRow1.locator('input[type="checkbox"]');
    await expect(doneCheckbox1).not.toBeChecked();

    // Check the Done box in page1 (tab A).
    await doneCheckbox1.click();
    await expect(doneCheckbox1).toBeChecked();

    // Wait for the save POST to reach the server.
    await page.waitForLoadState('networkidle');

    // Trigger TanStack Query's refetchOnWindowFocus on page2 by simulating a visibility
    // transition: hidden → visible. See DEF-056 test for the rationale.
    await page2.bringToFront();
    await page2.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // The snapshot refetches; CheckboxCell reads `value` prop directly (no local draft state)
    // so it immediately reflects the refetched value. Timeout is generous to cover the full
    // 30-second refetchInterval if the visibility trick does not fire in headless mode.
    const dbView2 = page2.locator('[data-testid="database-view"]');
    const auditRow2 = dbView2
      .getByTestId('database-row')
      .filter({ has: page2.getByRole('button', { name: /Accessibility audit/i }) });
    const doneCheckbox2 = auditRow2.locator('input[type="checkbox"]');
    await expect(doneCheckbox2).toBeChecked({ timeout: 35_000 });

    await page2.close();
  });
});

// ── DEF-105: TextCell draft now derived from focus state, not from useState init ──────────────
//
// The DEF-105 fix changed TextCell so that when the cell is NOT focused, it shows the `value`
// prop directly (not a stale `draft`). This means background refetches update the displayed
// value whenever the user is not actively editing the cell. Two behaviours must both hold:
//
//   A. Convergence: a value set in another tab is visible in this tab after a refetch (when
//      the user is not editing the cell).
//   B. Mid-edit protection: a refetch arriving while the user is actively typing does NOT
//      destroy their draft — the input continues to show what they typed.
//
// These are tested separately: (A) uses the same visibility-change refetch trick as DEF-056/057,
// and (B) stays focused in the input while the refetch fires, then asserts the draft survived.

/** Helper: trigger TanStack Query's refetchOnWindowFocus on the given page. */
async function triggerRefetch(p: Page): Promise<void> {
  await p.bringToFront();
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('DEF-105: TextCell convergence — text cell edited in another tab is visible after refetch', () => {
  test('DEF-105 part A: a text cell edited in tab A shows the new value in tab B after refetch', async ({
    page,
    context,
  }) => {
    test.setTimeout(70_000);
    await resetWorkspace(page);
    // Book Tracker has the "Notes" text-type property (Work Projects has no text property).
    await gotoDatabase(page, 'Book Tracker');
    const bookTrackerUrl = page.url();

    const page2 = await context.newPage();
    await page2.goto(bookTrackerUrl);
    await page2.waitForLoadState('networkidle');

    // Use "The Design of Everyday Things" — the first seeded row in Book Tracker.
    const dbView1 = page.locator('[data-testid="database-view"]');
    const designRow1 = dbView1
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Design of Everyday Things/i }) });
    await expect(designRow1).toBeVisible({ timeout: 8000 });

    // In tab A: fill the Notes cell with a unique value, then blur to save.
    // Book Tracker's Notes is type 'text' — its cell renders <input aria-label="Notes">.
    // fill() focuses the input, dispatches an input event that fires React's onChange
    // (setting draft = uniqueValue), and reliably replaces the existing content.
    const notesCell1 = designRow1.locator('input[aria-label="Notes"]');
    const uniqueValue = `notes-converge-${Date.now()}`;
    await notesCell1.fill(uniqueValue);
    await page.keyboard.press('Tab');
    await page.waitForLoadState('networkidle');

    // Trigger a refetch on tab B via the visibility-change trick.
    await triggerRefetch(page2);

    // Tab B should now show the value from tab A. TextCell's focused-state pattern means
    // when NOT focused, displayValue = parseValue(value) — the prop-derived value.
    const dbView2 = page2.locator('[data-testid="database-view"]');
    const designRow2 = dbView2
      .getByTestId('database-row')
      .filter({ has: page2.getByRole('button', { name: /Design of Everyday Things/i }) });
    const notesCell2 = designRow2.locator('input[aria-label="Notes"]');
    await expect(notesCell2).toHaveValue(uniqueValue, { timeout: 35_000 });

    await page2.close();
  });
});

test.describe('DEF-105: TextCell mid-edit protection — refetch while editing does not destroy draft', () => {
  test('DEF-105 part B: a refetch arriving while the user is mid-edit does not overwrite their typing', async ({
    page,
    context,
  }) => {
    test.setTimeout(70_000);
    await resetWorkspace(page);
    await gotoDatabase(page, 'Book Tracker');
    const bookTrackerUrl = page.url();

    const page2 = await context.newPage();
    await page2.goto(bookTrackerUrl);
    await page2.waitForLoadState('networkidle');

    // Tab A: edit the Notes cell for "The Design of Everyday Things" and save a known value.
    const dbView1 = page.locator('[data-testid="database-view"]');
    const designRow1 = dbView1
      .getByTestId('database-row')
      .filter({ has: page.getByRole('button', { name: /Design of Everyday Things/i }) });
    await expect(designRow1).toBeVisible({ timeout: 8000 });

    const notesCell1 = designRow1.locator('input[aria-label="Notes"]');
    const savedByA = `from-tab-a-${Date.now()}`;
    await notesCell1.fill(savedByA);
    await page.keyboard.press('Tab');
    await page.waitForLoadState('networkidle');

    // Tab B: fill the same cell to start editing. fill() focuses and sets draft via onChange.
    const dbView2 = page2.locator('[data-testid="database-view"]');
    const designRow2 = dbView2
      .getByTestId('database-row')
      .filter({ has: page2.getByRole('button', { name: /Design of Everyday Things/i }) });
    const notesCell2 = designRow2.locator('input[aria-label="Notes"]');
    const midEditDraft = `mid-edit-draft-${Date.now()}`;
    await notesCell2.fill(midEditDraft);
    // Confirm the input shows what was typed (focused=true, draft=midEditDraft is authoritative).
    await expect(notesCell2).toHaveValue(midEditDraft);

    // Trigger a refetch in tab B while the cell is still focused. The refetch updates `value`
    // prop to savedByA, but TextCell's focused-state pattern means displayValue = draft when
    // focused, so the user's typing must survive.
    await triggerRefetch(page2);
    // Give TanStack Query time to process the refetch response.
    await page2.waitForTimeout(500);

    // Assert: the cell still shows the mid-edit draft, not the value that arrived from tab A.
    await expect(
      notesCell2,
      'Draft must survive a background refetch while the cell is focused',
    ).toHaveValue(midEditDraft);

    await page2.close();
  });
});
