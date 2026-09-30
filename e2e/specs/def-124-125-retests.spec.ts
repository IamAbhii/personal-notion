/**
 * DEF-124 retest — toggle-group drop adoption (toggleGroupForDrop fix).
 * DEF-125 retest — mobile touch drag handles: touch-action:none and 48px targets.
 *
 * DEF-124 covers three scenarios introduced by the new `toggleGroupForDrop` helper:
 *   1. A plain block dragged (keyboard) to the last-child slot of an open toggle is adopted.
 *   2. A plain block dragged (keyboard) to the first-child slot of an empty toggle is adopted.
 *   3. Regression guard: a toggle child dragged out past plain blocks loses parentToggleId.
 *   4. Same as (1) driven by pointer — catches a dead MouseCompatPointerSensor.
 *   5. Same as (2) driven by pointer — empty-toggle drop zone via pointer.
 *
 * DEF-124 tests 1–3 drive the reorder via dnd-kit's KeyboardSensor (Space to lift,
 * ArrowDown/Up to move, Space to drop).  Keyboard drag covers the accessibility path
 * and is synchronous and geometry-independent.  Tests 4–5 drive the pointer path
 * (MouseCompatPointerSensor: activates on pointerdown, declines touch) so a broken
 * pointer sensor fails a hard assertion rather than passing silently.
 *
 * DEF-125 covers mobile touch-drag handles.  The three tests are:
 *   a) block-drag-handle carries touch-action:none and is at least 48×48 px.
 *   b) block-toggle-arrow carries touch-action:none and is at least 48×48 px.
 *   c) A CDP-driven touch drag (Input.dispatchTouchEvent) reorders two blocks;
 *      the new order must survive a reload.  This test asserts unconditionally —
 *      if the gesture does not activate, the test fails and must be filed as a
 *      defect rather than softened.
 *
 * Runs under:
 *   - chromium project  → DEF-124 tests (desktop keyboard + pointer drag)
 *   - mobile-chrome project → DEF-125 tests (Pixel 5 preset, hasTouch)
 */

import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// ── Shared helpers ─────────────────────────────────────────────────────────────

/** Extract workspaceId from the current URL (/w/<id>[/...]). */
function workspaceId(page: Page): string {
  const match = page.url().match(/\/w\/([^/]+)/);
  if (!match) throw new Error('Not on a workspace URL: ' + page.url());
  return match[1];
}

/**
 * Fetch all blocks for the workspace from the snapshot API, filtered to the
 * page currently open in the browser (uses the /page/<id> URL segment).
 */
async function fetchSnapshot(page: Page): Promise<Record<string, unknown>[]> {
  const wsId = workspaceId(page);
  const r = await page.request.get(`/api/workspaces/${wsId}/snapshot`);
  expect(r.status()).toBe(200);
  const json = (await r.json()) as { blocks: Record<string, unknown>[] };
  const allBlocks = json.blocks ?? [];
  const pathMatch = page.url().match(/\/page\/([^/]+)/);
  if (!pathMatch) return allBlocks;
  const pageId = pathMatch[1];
  return allBlocks.filter((b) => (b['pageId'] as string) === pageId);
}

/**
 * Parse the `props` JSON string from a snapshot block record.
 * Returns an empty object when props is absent or malformed.
 */
function parseProps(block: Record<string, unknown>): Record<string, unknown> {
  const raw = block['props'];
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ── DEF-124: toggle drop adoption ─────────────────────────────────────────────

test.describe('DEF-124: block dragged to last-child slot and empty-toggle drop zone is adopted', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'DEF-124 covers desktop keyboard drag; DEF-125 covers mobile');
    await resetWorkspace(page);
  });

  // ── Scenario 1: keyboard drag onto last-child slot ────────────────────────
  //
  // Block layout built in this test (flat order):
  //   seeded-1 (idx 0), plain-draggable (idx 1), toggle-header (idx 2),
  //   child-A (idx 3), child-B (idx 4), seeded-2+ (idx 5+)
  //
  // Three ArrowDown presses move "plain-draggable" from idx 1 to over child-B (idx 4).
  // toggleGroupForDrop sees child-B (parentToggleId = toggleId) as beforeBlock → adopts.

  test('DEF-124-1: plain block keyboard-dragged to last toggle child position gets parentToggleId after reload', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // Add "plain draggable" right after the first seeded block.
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('plain draggable');
    await page.waitForTimeout(300);

    // Add toggle with children right after "plain draggable".
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Parent Toggle');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child A');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child B');
    await page.waitForTimeout(1500);

    // Record the toggle block id before the drag.
    const toggleBlock = page.locator('[data-block-type="toggleList"]').first();
    const toggleId = await toggleBlock.getAttribute('data-block-id');
    expect(toggleId, 'toggleList block must have a data-block-id').toBeTruthy();

    // Focus the drag handle of "plain draggable" and use keyboard drag.
    // The drag handle is a <button> so it can receive focus.
    const plainBlock = blockEditor
      .locator('[data-block-type]')
      .filter({ hasText: 'plain draggable' });
    const plainHandle = plainBlock.locator('[data-testid="block-drag-handle"]').first();
    await plainHandle.focus();
    await page.waitForTimeout(100);

    // Space lifts the block; three ArrowDown moves it from idx 1 to over child-B (idx 4);
    // Space drops it.
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const blocks = await fetchSnapshot(page);
    const plain = blocks.find((b) => (b['text'] as string) === 'plain draggable');

    expect(plain, '"plain draggable" block missing from snapshot after reload').toBeTruthy();
    if (!plain) return;

    const parentId = parseProps(plain)['parentToggleId'] as string | undefined;

    expect(
      parentId,
      'plain block keyboard-dragged to last-child position has no parentToggleId — DEF-124 drop adoption not working',
    ).toBe(toggleId);
  });

  // ── Scenario 2: keyboard drag into empty toggle (first-child slot) ─────────
  //
  // Block layout:
  //   seeded-1 (idx 0), to-adopt (idx 1), toggle-header (idx 2 — no children), seeded-2+ (idx 3+)
  //
  // One ArrowDown moves "to-adopt" to over toggle-header (idx 2).
  // toggleGroupForDrop sees toggle-header (type=toggleList → returns its own id) as beforeBlock
  // → adopts.  This exercises the same adoption path as the mouse drop-zone, just via keyboard.

  test('DEF-124-2: block keyboard-dragged to first-child slot of empty toggle gets parentToggleId after reload', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();

    // Add "to adopt" right after the first seeded block.
    await firstBlock.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('to adopt');
    await page.waitForTimeout(300);

    // Add empty toggle right after "to adopt".
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Empty Toggle');
    // Click the first seeded block to commit the header without adding any children.
    await firstBlock.click();
    await page.waitForTimeout(1500);

    const toggleBlock = page.locator('[data-block-type="toggleList"]').first();
    const toggleId = await toggleBlock.getAttribute('data-block-id');
    expect(toggleId, 'toggleList block must have data-block-id').toBeTruthy();

    // Focus "to adopt"'s drag handle and keyboard-drag it onto the toggle header slot.
    const toAdoptBlock = blockEditor.locator('[data-block-type]').filter({ hasText: 'to adopt' });
    const toAdoptHandle = toAdoptBlock.locator('[data-testid="block-drag-handle"]').first();
    await toAdoptHandle.focus();
    await page.waitForTimeout(100);

    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const blocks = await fetchSnapshot(page);
    const adopted = blocks.find((b) => (b['text'] as string) === 'to adopt');

    expect(adopted, '"to adopt" block missing from snapshot after reload').toBeTruthy();
    if (!adopted) return;

    const parentId = parseProps(adopted)['parentToggleId'] as string | undefined;

    expect(
      parentId,
      'block keyboard-dragged to first-child slot of empty toggle has no parentToggleId — DEF-124 empty-toggle adoption not working',
    ).toBe(toggleId);
  });

  // ── Scenario 3: DEF-112 regression guard ──────────────────────────────────
  //
  // Block layout:
  //   seeded-1, toggle-header, child-A, child-B, plain-one, plain-two, seeded-2+
  //
  // Three ArrowDown presses move child-A from idx (toggle+1) to over plain-two.
  // toggleGroupForDrop sees plain-two (no parentToggleId) as beforeBlock → returns undefined
  // → child-A loses parentToggleId (the DEF-112 behaviour must still hold).

  test('DEF-124-3 (DEF-112 regression): child dragged past last plain block loses parentToggleId', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();

    // Build toggle with children right after the first seeded block.
    await firstBlock.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Regression Toggle');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child A');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child B');
    await page.waitForTimeout(300);

    // Exit the toggle: Enter on "child B" (non-empty last child) creates an empty child-C.
    // Enter again on empty child-C (empty AND last child) triggers onEnterToggleChild's exit
    // path — it deletes child-C and creates a top-level paragraph after the toggle group.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('plain one');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('plain two');
    await page.waitForTimeout(1500);

    // Focus child A's drag handle.
    const childrenContainer = page.locator('[data-testid="block-toggle-children"]').first();
    const childARow = childrenContainer.locator('[data-block-type]').first();
    const childAHandle = childARow.locator('[data-testid="block-drag-handle"]').first();
    await childAHandle.focus();
    await page.waitForTimeout(100);

    // Keyboard drag child A past child-B, plain-one, and plain-two (3 ArrowDown presses).
    await page.keyboard.press('Space');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const blocks = await fetchSnapshot(page);
    const childA = blocks.find((b) => (b['text'] as string) === 'child A');

    expect(
      childA,
      '"child A" block missing from snapshot — drag may have deleted the block or it was not committed before reload',
    ).toBeTruthy();
    if (!childA) return;

    const parentId = parseProps(childA)['parentToggleId'];

    expect(
      parentId,
      'child A still has parentToggleId after being dragged past last plain block — DEF-112 regression',
    ).toBeFalsy();
  });

  // ── Scenario 4: pointer drag to last-child slot (covers MouseCompatPointerSensor) ──
  //
  // Identical premise to DEF-124-1 but driven by page.mouse.  A dead pointer sensor
  // (e.g. the MouseSensor regression in 20046e3) leaves the block in its original position
  // and fails the parentToggleId assertion, which catches the regression instead of letting
  // it pass vacuously through a keyboard-only suite.

  test('DEF-124-4 (pointer): plain block pointer-dragged to last toggle child position gets parentToggleId', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // Build the same block layout as DEF-124-1.
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('plain draggable');
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem4 = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem4).toBeVisible({ timeout: 5000 });
    await menuItem4.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Parent Toggle');
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child A');
    await page.waitForTimeout(200);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('child B');
    await page.waitForTimeout(1500);

    const toggleBlock4 = page.locator('[data-block-type="toggleList"]').first();
    const toggleId4 = await toggleBlock4.getAttribute('data-block-id');
    expect(toggleId4, 'toggleList block must have a data-block-id').toBeTruthy();

    // Pointer-drag "plain draggable" onto child B (last child slot).
    const plainBlock4 = blockEditor
      .locator('[data-block-type]')
      .filter({ hasText: 'plain draggable' });
    const plainHandle4 = plainBlock4.locator('[data-testid="block-drag-handle"]').first();
    const childBRow4 = page
      .locator('[data-testid="block-toggle-children"]')
      .first()
      .locator('[data-block-type]')
      .last();

    const fromBox4 = await plainHandle4.boundingBox();
    const toBox4 = await childBRow4.boundingBox();
    expect(fromBox4, 'plain drag handle bounding box must be measurable').toBeTruthy();
    expect(toBox4, 'child B bounding box must be measurable').toBeTruthy();

    const fromX4 = fromBox4!.x + fromBox4!.width / 2;
    const fromY4 = fromBox4!.y + fromBox4!.height / 2;
    const toX4 = toBox4!.x + toBox4!.width / 2;
    const toY4 = toBox4!.y + toBox4!.height + 5;

    await page.mouse.move(fromX4, fromY4);
    await page.mouse.down();
    await page.mouse.move(fromX4, fromY4 + 5, { steps: 3 });
    await page.mouse.move(toX4, toY4, { steps: 25 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const blocks4 = await fetchSnapshot(page);
    const plain4 = blocks4.find((b) => (b['text'] as string) === 'plain draggable');
    expect(plain4, '"plain draggable" block missing from snapshot').toBeTruthy();
    if (!plain4) return;

    const parentId4 = parseProps(plain4)['parentToggleId'] as string | undefined;
    expect(
      parentId4,
      'plain block pointer-dragged to last-child position has no parentToggleId — pointer sensor broken or toggle adoption not working',
    ).toBe(toggleId4);
  });

  // ── Scenario 5: pointer drag to empty-toggle drop zone ────────────────────

  test('DEF-124-5 (pointer): block pointer-dragged onto empty toggle drop zone gets parentToggleId', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();

    // Build the same block layout as DEF-124-2.
    await firstBlock.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('to adopt');
    await page.waitForTimeout(300);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem5 = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem5).toBeVisible({ timeout: 5000 });
    await menuItem5.click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Empty Toggle');
    await firstBlock.click();
    await page.waitForTimeout(1500);

    const toggleBlock5 = page.locator('[data-block-type="toggleList"]').first();
    const toggleId5 = await toggleBlock5.getAttribute('data-block-id');
    expect(toggleId5, 'toggleList block must have data-block-id').toBeTruthy();

    // Start a drag to reveal the drop zone, then drop onto it.
    const toAdoptBlock5 = blockEditor.locator('[data-block-type]').filter({ hasText: 'to adopt' });
    const toAdoptHandle5 = toAdoptBlock5.locator('[data-testid="block-drag-handle"]').first();

    const fromBox5 = await toAdoptHandle5.boundingBox();
    const toggleBox5 = await toggleBlock5.boundingBox();
    expect(fromBox5, '"to adopt" drag handle bounding box must be measurable').toBeTruthy();
    expect(toggleBox5, 'toggle block bounding box must be measurable').toBeTruthy();

    // Drag toward the toggle to make the drop zone appear, then land on it.
    const fromX5 = fromBox5!.x + fromBox5!.width / 2;
    const fromY5 = fromBox5!.y + fromBox5!.height / 2;
    const toX5 = toggleBox5!.x + toggleBox5!.width / 2;
    // Land 20px below the toggle header's bottom edge — inside the drop zone region.
    const toY5 = toggleBox5!.y + toggleBox5!.height + 20;

    await page.mouse.move(fromX5, fromY5);
    await page.mouse.down();
    await page.mouse.move(fromX5, fromY5 + 5, { steps: 3 });
    await page.mouse.move(toX5, toY5, { steps: 25 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    await page.reload();
    await page.waitForLoadState('networkidle');

    const blocks5 = await fetchSnapshot(page);
    const adopted5 = blocks5.find((b) => (b['text'] as string) === 'to adopt');
    expect(adopted5, '"to adopt" block missing from snapshot').toBeTruthy();
    if (!adopted5) return;

    const parentId5 = parseProps(adopted5)['parentToggleId'] as string | undefined;
    expect(
      parentId5,
      'block pointer-dragged onto empty toggle drop zone has no parentToggleId — drop zone adoption not working',
    ).toBe(toggleId5);
  });
});

// ── DEF-125: mobile touch drag handles ────────────────────────────────────────

test.describe('DEF-125: touch drag activators carry touch-action:none and meet 48px target', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('DEF-125: block-drag-handle has touch-action:none and is at least 48×48px', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'DEF-125 is mobile-only');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.tap();
    await page.waitForTimeout(200);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('Block for drag');
    await page.waitForTimeout(1000);

    // The drag handle is always present in the DOM for dnd-kit touch access.
    const dragHandle = blockEditor.locator('[data-testid="block-drag-handle"]').first();
    await expect(dragHandle).toBeAttached({ timeout: 5000 });

    const touchAction = await dragHandle.evaluate((el) =>
      window.getComputedStyle(el).getPropertyValue('touch-action'),
    );
    expect(
      touchAction,
      'block-drag-handle must have touch-action:none so dnd-kit can claim the gesture before the browser scrolls',
    ).toBe('none');

    const box = await dragHandle.boundingBox();
    expect(box, 'block-drag-handle bounding box must be measurable').toBeTruthy();
    expect(
      box!.width,
      `block-drag-handle width ${box!.width}px is less than the 48px minimum touch target`,
    ).toBeGreaterThanOrEqual(48);
    expect(
      box!.height,
      `block-drag-handle height ${box!.height}px is less than the 48px minimum touch target`,
    ).toBeGreaterThanOrEqual(48);

    await page.screenshot({ path: 'screenshots/phase-9-def-125-drag-handle-mobile.png' });
  });

  test('DEF-125: block-toggle-arrow (toggle drag/toggle activator) has touch-action:none and is at least 48×48px', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'DEF-125 is mobile-only');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.tap();
    await page.waitForTimeout(200);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('/toggle');
    await page.waitForTimeout(400);
    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: 'Toggle list' })
      .first();
    await expect(menuItem).toBeVisible({ timeout: 5000 });
    await menuItem.tap();
    await page.waitForTimeout(300);
    await page.keyboard.type('Touch Arrow Test');
    await page.waitForTimeout(1000);

    const chevron = blockEditor.locator('[data-testid="block-toggle-arrow"]').first();
    await expect(chevron).toBeVisible({ timeout: 5000 });

    const touchAction = await chevron.evaluate((el) =>
      window.getComputedStyle(el).getPropertyValue('touch-action'),
    );
    expect(
      touchAction,
      'block-toggle-arrow must have touch-action:none so dnd-kit touch drag is activated before the browser scroll',
    ).toBe('none');

    const box = await chevron.boundingBox();
    expect(box, 'block-toggle-arrow bounding box must be measurable').toBeTruthy();
    expect(
      box!.width,
      `block-toggle-arrow width ${box!.width}px is less than the 48px minimum touch target`,
    ).toBeGreaterThanOrEqual(48);
    expect(
      box!.height,
      `block-toggle-arrow height ${box!.height}px is less than the 48px minimum touch target`,
    ).toBeGreaterThanOrEqual(48);

    await page.screenshot({ path: 'screenshots/phase-9-def-125-toggle-arrow-mobile.png' });
  });

  test('DEF-125: touch drag reorders two blocks via CDP Input.dispatchTouchEvent', async ({
    page,
    isMobile,
  }) => {
    /**
     * Drives dnd-kit's TouchSensor (delay:200, tolerance:8) through CDP
     * Input.dispatchTouchEvent.  CDP delivers the same browser-level touch events
     * a real finger produces, bypassing the identifier and coordinate pitfalls of
     * hand-constructed TouchEvent objects dispatched from page.evaluate.
     *
     * The ordering constraint that the fix exists to satisfy: the finger must be
     * stationary for at least the 200ms activation delay and must not exceed the
     * 8px tolerance during that hold.  Any movement during the hold causes the
     * TouchSensor to treat the gesture as a scroll and decline.  We therefore hold
     * for 350ms before the first move.
     *
     * This test asserts unconditionally: two blocks must change order after the
     * touch gesture, and the new order must survive a reload.  There is no fallback
     * path and no console-log substituting for an assertion.
     */
    test.skip(!isMobile, 'DEF-125 is mobile-only');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.tap();
    await page.waitForTimeout(200);
    await page.keyboard.press('End');

    // Create four blocks so the drag target (Touch Beta) sits in the middle of the page,
    // away from the topbar and with neighbours both above and below.
    for (const label of ['Touch Alpha', 'Touch Beta', 'Touch Gamma', 'Touch Delta']) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      await page.keyboard.type(label);
      await page.waitForTimeout(150);
    }

    // Wait for Touch Delta (the last-created block) and its drag handle to be attached before
    // proceeding.  A fixed waitForTimeout is not reliable: on a slow run the blocks are not yet
    // in the DOM when the locator is evaluated, causing the setup to time out before any touch
    // event is dispatched.
    const touchDelta = blockEditor.locator('[data-block-type]').filter({ hasText: 'Touch Delta' });
    await expect(touchDelta).toBeAttached({ timeout: 10000 });
    const deltaDragHandle = touchDelta.locator('[data-testid="block-drag-handle"]').first();
    await expect(deltaDragHandle).toBeAttached({ timeout: 5000 });

    const allBlockIds = blockEditor.locator('[data-block-id]');
    const idsBefore = await allBlockIds.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );

    // Target: Touch Beta — one block below Alpha, two above Gamma and Delta.
    const touchBeta = blockEditor.locator('[data-block-type]').filter({ hasText: 'Touch Beta' });
    const dragHandle = touchBeta.locator('[data-testid="block-drag-handle"]').first();
    // Ensure the handle is attached before scrolling; Touch Beta is created before Delta so if
    // Delta is attached, Beta certainly is — but be explicit for clarity.
    await expect(dragHandle).toBeAttached({ timeout: 5000 });

    // Scroll to center using the full scrollIntoView({ block:'center' }) — not scrollIntoViewIfNeeded,
    // which only does the minimum and left the handle occluded by the topbar in the previous attempt.
    await dragHandle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(150);

    const handleBox = await dragHandle.boundingBox();
    expect(
      handleBox,
      'drag handle bounding box must be measurable after center-scroll',
    ).toBeTruthy();
    if (!handleBox) return;

    // Measure the sticky topbar so we can report overlap context on failure.
    const topbarRect = await page.evaluate(() => {
      const el =
        document.querySelector('header') ??
        document.querySelector('[class*="topbar"], [class*="top-bar"], nav');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    const fromX = Math.round(handleBox.x + handleBox.width / 2);
    const fromY = Math.round(handleBox.y + handleBox.height / 2);

    // Gate: elementFromPoint at the exact dispatch coordinates must be the handle or a child.
    const hitInfo = await page.evaluate(
      ([x, y]: [number, number]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return { matched: false, tagName: 'null', testid: '', outerHTML: '', rect: null };
        const ancestor = el.closest('[data-testid="block-drag-handle"]');
        const r = el.getBoundingClientRect();
        return {
          matched: ancestor !== null,
          tagName: el.tagName,
          testid: el.getAttribute('data-testid') ?? '',
          outerHTML: el.outerHTML.slice(0, 200),
          rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      },
      [fromX, fromY] as [number, number],
    );

    // Measure a neighbouring block to sanity-check the drag distance.
    const gammaBlock = blockEditor.locator('[data-block-type]').filter({ hasText: 'Touch Gamma' });
    const gammaBox = await gammaBlock.boundingBox();
    const neighbourHeight = gammaBox ? Math.round(gammaBox.height) : 48;
    // Move at least two block heights to cross a neighbour regardless of exact row height.
    const dragDistance = Math.max(120, neighbourHeight * 2 + 20);

    console.log(
      'DEF-125 touch drag geometry:',
      JSON.stringify(
        {
          handleBox: { x: handleBox.x, y: handleBox.y, w: handleBox.width, h: handleBox.height },
          touchPoint: { x: fromX, y: fromY },
          topbarRect,
          neighbourHeight,
          dragDistance,
          hitElement: {
            matched: hitInfo.matched,
            tagName: hitInfo.tagName,
            testid: hitInfo.testid,
            outerHTML: hitInfo.outerHTML,
            rect: hitInfo.rect,
          },
        },
        null,
        2,
      ),
    );

    expect(
      hitInfo.matched,
      `CDP touch coordinates (${fromX}, ${fromY}) do not land on [data-testid="block-drag-handle"] — ` +
        `hit element: <${hitInfo.tagName}> testid="${hitInfo.testid}" rect=${JSON.stringify(hitInfo.rect)} outerHTML=${hitInfo.outerHTML} — ` +
        `handle box: ${JSON.stringify(handleBox)} — topbar: ${JSON.stringify(topbarRect)}`,
    ).toBe(true);

    const cdp = await page.context().newCDPSession(page);

    // touchStart: finger down, completely stationary.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: fromX, y: fromY }],
    });

    // Hold for 350ms without any movement — must exceed the 200ms TouchSensor activation delay
    // while staying within the 8px tolerance, or the sensor treats it as a scroll and declines.
    await page.waitForTimeout(350);

    // touchMove: ten incremental steps down to dragDistance below the start.
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const stepY = Math.round(fromY + (dragDistance * i) / steps);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: fromX, y: stepY }],
      });
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(200);

    // touchEnd: lift the finger.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(1500);

    const idsAfter = await allBlockIds.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );

    expect(
      idsAfter,
      'block order must change after CDP-driven touch drag — TouchSensor not activating despite handle being the confirmed hit target; mobile touch drag fix may not be working',
    ).not.toEqual(idsBefore);

    // New order must survive a reload (confirmed persisted, not just in-memory).
    await page.reload();
    await page.waitForLoadState('networkidle');
    const idsAfterReload = await blockEditor
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')));
    expect(
      idsAfterReload,
      'block order after touch drag must be preserved after reload — reorder not persisted',
    ).toEqual(idsAfter);

    await page.screenshot({ path: 'screenshots/phase-9-def-125-touch-drag-reorder-mobile.png' });
  });
});
