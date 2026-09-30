/**
 * End-to-end evidence for the touch-gutter-menu fix on branch fix/mobile-touch-drag-and-toggle-drop.
 *
 * Problem: the block gutter drag handle is simultaneously a dnd-kit drag activator and a Radix
 * DropdownMenu.Trigger. Radix opened the menu from `onPointerDown` with no `pointerType` guard,
 * so on touch the menu appeared the instant the finger landed — before TouchSensor's 200ms hold
 * constraint could activate the drag.
 *
 * Fix: `BlockRow.tsx` sets a `touchPointerDownActiveRef` flag in the button's `onPointerDown`
 * when `e.pointerType === 'touch'`; the `onOpenChange` handler rejects Radix's immediate open
 * while that flag is set. The menu instead opens from the button's `onPointerUp` only when the
 * finger is released without the 200ms hold having fired (i.e. a real tap, not a drag).
 *
 * Cases:
 *
 *   1. Short tap (< 200 ms) on the handle opens the "Delete block" menu.
 *      Touch-only; driven via CDP Input.dispatchTouchEvent so no synthetic click is injected.
 *
 *   2. Long press (> 200 ms) + drag reorders the block; the menu must NOT appear at any point —
 *      including the ~200ms window while the hold is in progress.
 *      Detection uses an in-page MutationObserver armed *before* touchStart so even a transient
 *      flash (the menu appearing then closing once isDragging becomes true) is caught. Sampling
 *      at a fixed instant after the gesture is not sufficient: pre-fix code produces exactly
 *      such a flash that a point-in-time check misses.
 *      Touch-only; also driven via CDP.
 *
 *   3. Mouse click on the handle opens the menu. Desktop-only.
 *
 *   4. Mouse drag reorders the block; the menu must not open after drag-end. Desktop-only.
 *      Uses an end-state visibility check (not a MutationObserver) because the mouse path
 *      intentionally opens the menu briefly on pointerdown before the 4 px sensor threshold
 *      fires — that transient mount is expected behaviour for mouse, not a bug.
 *
 * Test 3 and 4 guard the mouse path against regressions introduced by the touch fix.
 * If an existing spec already covers mouse drag-and-menu (DEF-113 in phase-7-defect-retests),
 * these serve as a targeted regression pass scoped to this branch.
 *
 * Runs under:
 *   - chromium project  → tests 3 & 4 (desktop mouse)
 *   - mobile-chrome project → tests 1 & 2 (Pixel 5, hasTouch)
 */

import { test, expect, type Page } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// ── shared helpers ─────────────────────────────────────────────────────────────

/** Parse all block ids visible in the block editor in DOM order. */
async function blockIdsInOrder(page: Page): Promise<(string | null)[]> {
  return page
    .locator('[data-testid="block-editor"] [data-block-id]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')));
}

/**
 * Create two labelled paragraph blocks in the open page's editor.
 * Returns after the second block's text is committed.
 * The function navigates to the first block, then adds two new blocks below it.
 */
async function createTwoBlocks(page: Page, labelA: string, labelB: string): Promise<void> {
  const blockEditor = page.locator('[data-testid="block-editor"]');
  // Click the first block to get a caret, then move to the end of any existing text.
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await firstBlock.click();
  await page.keyboard.press('End');

  // Create block A.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.type(labelA);
  await page.waitForTimeout(150);

  // Create block B below A.
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  await page.keyboard.type(labelB);
  await page.waitForTimeout(150);

  // Wait for both blocks to be attached before returning.
  await expect(blockEditor.locator('[data-block-type]').filter({ hasText: labelA })).toBeAttached({
    timeout: 8000,
  });
  await expect(blockEditor.locator('[data-block-type]').filter({ hasText: labelB })).toBeAttached({
    timeout: 8000,
  });
}

/**
 * Return the centre coordinates of a block's drag handle, scrolling the element
 * into the middle of the viewport first so it is clear of the sticky topbar.
 * Throws if the handle cannot be located or measured.
 */
async function handleCentre(
  page: Page,
  blockLabel: string,
): Promise<{ x: number; y: number; box: { x: number; y: number; width: number; height: number } }> {
  const blockEditor = page.locator('[data-testid="block-editor"]');
  const block = blockEditor.locator('[data-block-type]').filter({ hasText: blockLabel });
  const handle = block.locator('[data-testid="block-drag-handle"]').first();

  await expect(handle).toBeAttached({ timeout: 8000 });
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);

  const box = await handle.boundingBox();
  if (!box) throw new Error(`drag handle bounding box is null for block "${blockLabel}"`);

  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), box };
}

/**
 * Arm an in-page MutationObserver that sets window.__menuFlashDetected = true the moment
 * any element matching `[data-testid="block-delete"]` is connected to the DOM (including via
 * a Radix portal append deep in the subtree). Call armMenuFlashObserver() before the gesture,
 * then readMenuFlashResult() after it finishes.
 *
 * Why a MutationObserver instead of point-in-time visibility checks:
 *   Pre-fix, Radix opens the menu on pointerdown but BlockRow renders it as
 *   `open={menuOpen && !isDragging}`. Once the TouchSensor fires (~200ms in), isDragging becomes
 *   true and the menu closes. The menu flash lasts only ~200ms. A check at touchStart races the
 *   portal mount; a check at +350ms is after isDragging has already closed it. Both pass pre-fix
 *   because neither samples during the flash window.
 *   A MutationObserver armed before touchStart catches any DOM connection regardless of when it
 *   occurs during the gesture — it is the only reliable way to detect a transient flash.
 */
async function armMenuFlashObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Initialise the sentinel on the window object so readMenuFlashResult() can read it.
    (window as unknown as Record<string, unknown>)['__menuFlashDetected'] = false;
    (window as unknown as Record<string, unknown>)['__menuFlashTime'] = null;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node as Element;
          // Match either the item itself or any ancestor that Radix might insert as a wrapper.
          if (
            el.matches('[data-testid="block-delete"]') ||
            el.querySelector('[data-testid="block-delete"]') !== null
          ) {
            (window as unknown as Record<string, unknown>)['__menuFlashDetected'] = true;
            (window as unknown as Record<string, unknown>)['__menuFlashTime'] = Date.now();
          }
        }
      }
    });

    // Observe the full document body with subtree so Radix portal appends are caught wherever
    // Radix chooses to insert the portal container.
    observer.observe(document.body, { childList: true, subtree: true });
    // Store the observer so it is not garbage-collected during the gesture.
    (window as unknown as Record<string, unknown>)['__menuObserver'] = observer;
  });
}

/** Read the flash result and disconnect the observer. */
async function readMenuFlashResult(
  page: Page,
): Promise<{ detected: boolean; time: number | null }> {
  return page.evaluate(() => {
    const obs = (window as unknown as Record<string, unknown>)['__menuObserver'] as
      MutationObserver | undefined;
    obs?.disconnect();
    return {
      detected: (window as unknown as Record<string, unknown>)['__menuFlashDetected'] as boolean,
      time: (window as unknown as Record<string, unknown>)['__menuFlashTime'] as number | null,
    };
  });
}

// ── 1 & 2: touch tests (mobile-chrome project only) ───────────────────────────

test.describe('touch gutter handle: tap opens menu, long press drags without opening menu', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    // Skip the entire describe block in the desktop project so the suite stays fast.
    // The mobile-chrome project has `isMobile: true` via the Pixel 5 preset.
    test.skip(!isMobile, 'touch tests run only in the mobile-chrome project');
    await resetWorkspace(page);
  });

  test('Case 1: short CDP tap on handle opens the Delete block menu', async ({ page }) => {
    /**
     * Input mechanism: CDP `Input.dispatchTouchEvent`.
     *
     * Why not `locator.tap()`: Playwright's `tap()` injects a synthetic `click` after
     * `touchEnd`, which would open the Radix dropdown via Radix's standard click handler
     * even if the fix is completely absent — the test would pass on broken code.
     *
     * CDP `Input.dispatchTouchEvent` delivers raw browser-level touch events identical
     * to a real finger.  Radix's `DropdownMenuTrigger` has no click fallback for touch
     * because `e.preventDefault()` on `pointerdown` suppresses the compatibility click
     * on touch pointers (Pointer Events spec).  So the menu can only open through the
     * fix's `onPointerUp` path.  A test that passes here proves the fix's `onPointerUp`
     * handler works; a failure proves it does not.
     */

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTwoBlocks(page, 'Tap Target A', 'Tap Target B');

    const { x, y } = await handleCentre(page, 'Tap Target A');

    // Gate: elementFromPoint must confirm the handle is the hit target.
    const hitInfo = await page.evaluate(
      ([hx, hy]: [number, number]) => {
        const el = document.elementFromPoint(hx, hy);
        if (!el) return { matched: false, tagName: 'null' };
        return {
          matched: el.closest('[data-testid="block-drag-handle"]') !== null,
          tagName: el.tagName,
        };
      },
      [x, y] as [number, number],
    );
    expect(
      hitInfo.matched,
      `CDP tap coordinates (${x}, ${y}) do not land on the drag handle — hit: <${hitInfo.tagName}>`,
    ).toBe(true);

    const cdp = await page.context().newCDPSession(page);

    // Short tap: touchStart then touchEnd within 50 ms — well under the 200 ms TouchSensor
    // activation delay.  No movement between start and end.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(50);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    // The fix opens the menu from onPointerUp when pointerType === 'touch' and isDragging is false.
    await expect(page.locator('[data-testid="block-delete"]')).toBeVisible({ timeout: 3000 });

    await page.screenshot({ path: 'screenshots/def-touch-drag-tap-menu-open.png' });
  });

  test('Case 2: long press and drag reorders block; Delete block menu never appears', async ({
    page,
  }) => {
    /**
     * Input mechanism: CDP `Input.dispatchTouchEvent` with a 350 ms stationary hold before
     * any movement — exceeding the 200 ms TouchSensor activation delay while remaining
     * within the 8 px tolerance.
     *
     * Detection: an in-page MutationObserver is armed *before* touchStart so that even the
     * ~200 ms menu flash produced by pre-fix code (menu opens on pointerdown, closes when
     * isDragging becomes true at ~200ms) is captured. Point-in-time visibility checks are
     * insufficient because they sample after the flash window has closed.
     *
     * The test asserts:
     *   a) the MutationObserver never saw `[data-testid="block-delete"]` connected to the DOM
     *   b) the block order changed (TouchSensor activated)
     *   c) the new order survives a reload (persisted)
     */

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTwoBlocks(page, 'Drag Block One', 'Drag Block Two');

    // Capture block order before the drag.
    const idsBefore = await blockIdsInOrder(page);

    const { x, y, box: handleBox } = await handleCentre(page, 'Drag Block One');

    // Compute a drag distance that clears the neighbouring block (at least 120 px down).
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const neighbourBlock = blockEditor
      .locator('[data-block-type]')
      .filter({ hasText: 'Drag Block Two' });
    const neighbourBox = await neighbourBlock.boundingBox();
    const neighbourHeight = neighbourBox ? neighbourBox.height : 48;
    const dragDistance = Math.max(120, neighbourHeight * 2 + 20);

    // Gate: elementFromPoint must confirm the handle is the hit target.
    const hitInfo = await page.evaluate(
      ([hx, hy]: [number, number]) => {
        const el = document.elementFromPoint(hx, hy);
        if (!el) return { matched: false, tagName: 'null' };
        return {
          matched: el.closest('[data-testid="block-drag-handle"]') !== null,
          tagName: el.tagName,
        };
      },
      [x, y] as [number, number],
    );
    expect(
      hitInfo.matched,
      `CDP drag coordinates (${x}, ${y}) do not land on the drag handle — hit: <${hitInfo.tagName}>. handleBox: ${JSON.stringify(handleBox)}`,
    ).toBe(true);

    // Arm the observer BEFORE touchStart so any portal append during the gesture is caught.
    await armMenuFlashObserver(page);

    const cdp = await page.context().newCDPSession(page);

    // touchStart: finger down, stationary.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });

    // Hold 350 ms — exceeds the 200 ms TouchSensor activation delay.
    // Pre-fix: the menu opens on pointerdown and closes again when isDragging flips to true
    // at ~200ms. The observer catches the portal mount during this window.
    await page.waitForTimeout(350);

    // Drag: ten incremental touchMove steps.
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const stepY = Math.round(y + (dragDistance * i) / steps);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: stepY }],
      });
      await page.waitForTimeout(30);
    }

    await page.waitForTimeout(200);

    // touchEnd: lift finger.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });

    await page.waitForTimeout(1500);

    // Read the observer result and disconnect it.
    const flashResult = await readMenuFlashResult(page);

    // PRIMARY assertion: the menu must never have appeared at any point during the gesture.
    // Pre-fix this fails because Radix mounts the menu content on pointerdown before
    // the TouchSensor activates and isDragging suppresses it (~200ms flash).
    expect(
      flashResult.detected,
      `[data-testid="block-delete"] was connected to the DOM during the long-press drag gesture` +
        (flashResult.time !== null ? ` at t=${flashResult.time}` : '') +
        ` — the menu flashed open (pre-fix: Radix opens on pointerdown before TouchSensor activates).` +
        ` The fix's touchPointerDownActiveRef guard is not working.`,
    ).toBe(false);

    // SECONDARY assertion: block order must have changed (TouchSensor activated the drag).
    const idsAfter = await blockIdsInOrder(page);
    expect(
      idsAfter,
      'block order must change after long-press drag — TouchSensor did not activate; the touch drag fix may not be working',
    ).not.toEqual(idsBefore);

    // New order must survive a reload (confirms persistence, not just in-memory render).
    await page.reload();
    await page.waitForLoadState('networkidle');
    const idsAfterReload = await blockIdsInOrder(page);
    expect(
      idsAfterReload,
      'block order after touch drag must be preserved after reload — reorder not persisted',
    ).toEqual(idsAfter);

    await page.screenshot({ path: 'screenshots/def-touch-drag-long-press-reorder.png' });
  });
});

// ── 3 & 4: desktop mouse tests (chromium project only) ────────────────────────

test.describe('desktop mouse: click opens menu, drag reorders without opening menu', () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, 'mouse tests run only in the chromium project');
    await resetWorkspace(page);
  });

  test('Case 3: mouse click on handle opens the Delete block menu', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTwoBlocks(page, 'Click Target A', 'Click Target B');

    const { x, y } = await handleCentre(page, 'Click Target A');

    // Hover to reveal the handle (desktop gutter is hidden until group-hover).
    await page.mouse.move(x, y);
    await page.waitForTimeout(100);

    // Click to open the menu.
    await page.mouse.click(x, y);

    await expect(page.locator('[data-testid="block-delete"]')).toBeVisible({ timeout: 3000 });
  });

  test('Case 4: mouse drag reorders block; Delete block menu does not open', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await createTwoBlocks(page, 'Mouse Drag A', 'Mouse Drag B');

    const idsBefore = await blockIdsInOrder(page);

    const { x, y } = await handleCentre(page, 'Mouse Drag A');
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const targetBlock = blockEditor
      .locator('[data-block-type]')
      .filter({ hasText: 'Mouse Drag B' });
    const targetBox = await targetBlock.boundingBox();

    const toX = x;
    const toY = targetBox ? Math.round(targetBox.y + targetBox.height + 30) : y + 100;

    // Hover to reveal, then drag.
    await page.mouse.move(x, y);
    await page.mouse.down();
    // Small initial move to cross the 4 px MouseCompatPointerSensor activation threshold.
    await page.mouse.move(x, y + 5, { steps: 3 });
    await page.mouse.move(toX, toY, { steps: 25 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    // For mouse, Radix intentionally opens the menu on pointerdown (before the 4 px sensor
    // threshold fires). BlockRow's render-phase fix closes menuOpen when isDragging becomes
    // true, so the menu closes during the drag. The MutationObserver approach is not used here
    // because that transient mount is by design; the only defect was the menu staying open
    // after drag-end (DEF-113). We assert end-state only.
    await expect(page.locator('[data-testid="block-delete"]')).not.toBeVisible();

    // Block order must have changed.
    const idsAfter = await blockIdsInOrder(page);
    expect(
      idsAfter,
      'block order must change after mouse drag — MouseCompatPointerSensor did not activate',
    ).not.toEqual(idsBefore);

    await page.screenshot({ path: 'screenshots/def-touch-drag-mouse-reorder.png' });
  });
});
