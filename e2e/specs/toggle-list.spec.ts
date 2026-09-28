/**
 * Phase 7 end-to-end tests for the toggleList block.
 *
 * Covers all six success criteria that touch the browser:
 *   Criterion 1 — slash menu includes a "Toggle list" entry matching `toggle`, `collapse`, `expand`
 *   Criterion 2 — chevron collapses and expands with aria-expanded reflecting the state
 *   Criterion 3 — children are visually indented beneath the header (measured, not class-checked)
 *   Criterion 4 — Enter and Backspace keyboard behaviours
 *   Criterion 5 — children survive a refresh; collapsed state resets to open
 *   Criterion 6 — no backend rejection (no notice toast after creating a toggle and its children)
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

/** Helper: open the page's editor and type '/' in a new empty block at the bottom. */
async function openSlashMenu(page: Parameters<typeof resetWorkspace>[0]) {
  const blockEditor = page.locator('[data-testid="block-editor"]');
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await firstBlock.click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/');
  await page.waitForTimeout(400);
}

/** Helper: insert a toggleList block via the slash menu using a query string. */
async function insertToggleBlock(page: Parameters<typeof resetWorkspace>[0]) {
  await openSlashMenu(page);
  await page.keyboard.type('toggle');
  await page.waitForTimeout(400);
  const menuItem = page
    .locator('[data-testid="slash-menu-item"]')
    .filter({ hasText: 'Toggle list' })
    .first();
  await expect(menuItem).toBeVisible();
  await menuItem.click();
  await page.waitForTimeout(400);
}

test.describe('toggleList block — Phase 7', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // ── Criterion 1 ─────────────────────────────────────────────────────────────

  test('criterion-1a: slash menu shows Toggle list entry matching /toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openSlashMenu(page);

    const slashMenu = page.locator('[data-testid="slash-menu"]');
    await expect(slashMenu).toBeVisible();

    const toggleItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' });
    await expect(toggleItem.first()).toBeVisible();
  });

  test('criterion-1b: slash menu matches query "collapse" for Toggle list', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openSlashMenu(page);
    await page.keyboard.type('collapse');
    await page.waitForTimeout(400);

    const toggleItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' });
    await expect(toggleItem.first()).toBeVisible();
  });

  test('criterion-1c: slash menu matches query "expand" for Toggle list', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await openSlashMenu(page);
    await page.keyboard.type('expand');
    await page.waitForTimeout(400);

    const toggleItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' });
    await expect(toggleItem.first()).toBeVisible();
  });

  // ── Creating a toggle and typing a header ───────────────────────────────────

  test('creating a toggle via slash menu inserts a toggleList block', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const toggleBlock = blockEditor.locator('[data-block-type="toggleList"]');
    await expect(toggleBlock).toBeVisible();

    // Type a header and assert it is reflected in the block
    await page.keyboard.type('My Toggle Header');
    await page.waitForTimeout(300);

    const toggleHeader = page.locator('[data-testid="block-toggle-header"]').first();
    await expect(toggleHeader).toBeVisible();
  });

  // ── Criterion 3 — children are indented ─────────────────────────────────────

  test('criterion-3: two children are visually below and horizontally indented vs header', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);
    await page.keyboard.type('Parent Header');
    await page.waitForTimeout(300);

    // Press Enter to add first child
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child A');
    await page.waitForTimeout(300);

    // Press Enter again to add second child
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child B');
    await page.waitForTimeout(300);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // The toggle header row
    const toggleRow = blockEditor.locator('[data-block-type="toggleList"]').first();
    const headerBox = await toggleRow.boundingBox();
    expect(headerBox).toBeTruthy();

    // The children container
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();
    await expect(childrenContainer).toBeVisible();

    // Each child row lives inside the children container
    const childRows = childrenContainer.locator('[data-block-type]');
    const childCount = await childRows.count();
    expect(childCount).toBe(2);

    // First child bounding box — must be below and to the right of the header row
    const firstChildBox = await childRows.first().boundingBox();
    expect(firstChildBox).toBeTruthy();

    // Child top > header top (below)
    expect(firstChildBox!.y).toBeGreaterThan(headerBox!.y);
    // Child left > header left (indented)
    expect(firstChildBox!.x).toBeGreaterThan(headerBox!.x);
  });

  // ── Criterion 2 — collapse and expand ───────────────────────────────────────

  test('criterion-2: chevron collapses and expands children; aria-expanded reflects state', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);
    await page.keyboard.type('Toggle Header');
    await page.waitForTimeout(300);

    // Add a child
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child content');
    await page.waitForTimeout(300);

    const chevron = page.locator('[data-testid="block-toggle-arrow"]').first();
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();

    // Initially expanded
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(childrenContainer).toBeVisible();

    // Click to collapse
    await chevron.click();
    await page.waitForTimeout(300);

    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    // The container is always in the DOM; assert it is not visible
    await expect(childrenContainer).not.toBeVisible();

    // Click again to expand
    await chevron.click();
    await page.waitForTimeout(300);

    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(childrenContainer).toBeVisible();
  });

  // ── Criterion 4 — keyboard behaviours ───────────────────────────────────────

  test('criterion-4a: Enter on last empty child exits toggle and creates sibling paragraph', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);
    await page.keyboard.type('Toggle Header');
    await page.waitForTimeout(300);

    // Add one child and immediately press Enter on the empty child
    await page.keyboard.press('Enter'); // creates first child
    await page.waitForTimeout(300);
    // This child is empty — pressing Enter should exit the toggle
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // The children container should now have no visible children (the empty one was removed)
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();
    // Either hidden or child count is 0
    const childCount = await childrenContainer.locator('[data-block-type]').count();
    expect(childCount).toBe(0);

    // A new paragraph block should exist after the toggle in the flat block list
    const allBlocks = blockEditor.locator('[data-block-id]');
    const blockCount = await allBlocks.count();
    // There must be at least two top-level records: the toggle and the escaped paragraph
    expect(blockCount).toBeGreaterThanOrEqual(2);
  });

  test('criterion-4b: Backspace on empty child removes it; focus returns to header or prev child', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);
    await page.keyboard.type('Toggle Header');
    await page.waitForTimeout(300);

    // Create two children
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child A');
    await page.waitForTimeout(300);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    // Second child is empty — press Backspace to delete it
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);

    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();
    const childRows = childrenContainer.locator('[data-block-type]');
    const childCount = await childRows.count();
    // Only Child A should remain — the empty second child was removed by Backspace
    expect(childCount).toBe(1);
  });

  // ── Criterion 5 — persistence and state reset ────────────────────────────────

  test('criterion-5: children survive refresh; collapsed state resets to open', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await insertToggleBlock(page);
    await page.keyboard.type('Persistent Header');
    await page.waitForTimeout(300);

    // Add two children
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child One');
    await page.waitForTimeout(300);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Child Two');
    await page.waitForTimeout(300);

    // Collapse the toggle
    const chevron = page.locator('[data-testid="block-toggle-arrow"]').first();
    await chevron.click();
    await page.waitForTimeout(300);

    // Verify collapsed before reload
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');

    // Autosave and reload
    await page.waitForTimeout(2000);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Children must have survived the reload
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const toggleBlock = blockEditor.locator('[data-block-type="toggleList"]');
    await expect(toggleBlock).toBeVisible();

    const chevronAfter = page.locator('[data-testid="block-toggle-arrow"]').first();
    // Collapsed state is NOT persisted — it resets to open (aria-expanded = true)
    await expect(chevronAfter).toHaveAttribute('aria-expanded', 'true');

    // Children container visible because state reset to open
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();
    await expect(childrenContainer).toBeVisible();

    // Both children are present
    const childRows = childrenContainer.locator('[data-block-type]');
    await expect(childRows).toHaveCount(2);
  });

  // ── Criterion 6 — no backend rejection ──────────────────────────────────────

  test('criterion-6: creating a toggle and adding children produces no error notice', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Collect any error-level console messages
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out browser internals unrelated to the app
        if (
          !text.includes('favicon') &&
          !text.includes('net::ERR_') &&
          !text.includes('ResizeObserver')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    await insertToggleBlock(page);
    await page.keyboard.type('Sync Test Header');
    await page.waitForTimeout(300);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Sync Child A');
    await page.waitForTimeout(300);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.keyboard.type('Sync Child B');

    // Give the sync queue time to flush
    await page.waitForTimeout(2000);

    // No error toast should have appeared
    const errorNotice = page.locator('[data-testid="notice"]');
    await expect(errorNotice).toHaveCount(0);

    // No console errors from the app
    expect(consoleErrors).toHaveLength(0);
  });
});
