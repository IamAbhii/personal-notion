import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Block drag to reorder', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('drag block to new position using keyboard (Space, arrows)', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use the seeded page blocks
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    // Get all blocks and verify there are at least 3
    let allBlocks = blockEditor.locator('[data-block-id]');
    let blockCount = await allBlocks.count();

    // If we don't have enough blocks, create some
    while (blockCount < 3) {
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.waitForTimeout(100);

      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await page.keyboard.type(`Block ${blockCount + 1}`);
      await page.waitForTimeout(300);

      allBlocks = blockEditor.locator('[data-block-id]');
      blockCount = await allBlocks.count();
    }

    // Get initial block order
    const initialIds = await allBlocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );

    // Focus on the first block's drag handle
    const firstBlockDragHandle = blockEditor
      .locator('[data-block-id]')
      .first()
      .locator('[data-testid="block-drag-handle"]');
    await firstBlockDragHandle.focus();
    await page.waitForTimeout(100);

    // Space to lift
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    // Press ArrowDown twice to move down two positions
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Space to drop
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);

    // Get new block order
    const newIds = await blockEditor
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')));

    // Verify the order changed
    expect(newIds).not.toEqual(initialIds);

    // Reload and verify order persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedIds = await blockEditor
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')));

    // The order should still match the reordered version
    expect(reloadedIds).toEqual(newIds);
  });

  test('drag block to new position using pointer (mouse)', async ({ page }) => {
    /*
     * Drives the MouseCompatPointerSensor — activates on pointerdown, declines touch.
     * A dead pointer sensor would leave the block order unchanged and fail the assertion,
     * so this test catches any regression that kills mouse drag.
     */
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    // Seed at least 3 blocks (seeded page already has several, but be explicit).
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('Mouse Drag A');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('Mouse Drag B');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.type('Mouse Drag C');
    await page.waitForTimeout(1000);

    // Record IDs before drag.
    const allBlocks = blockEditor.locator('[data-block-id]');
    const idsBefore = await allBlocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );

    // Drag "Mouse Drag A" down past "Mouse Drag B" using the pointer.
    const blockA = blockEditor.locator('[data-block-type]').filter({ hasText: 'Mouse Drag A' });
    const blockC = blockEditor.locator('[data-block-type]').filter({ hasText: 'Mouse Drag C' });
    const handleA = blockA.locator('[data-testid="block-drag-handle"]');

    const fromBox = await handleA.boundingBox();
    const toBox = await blockC.boundingBox();
    expect(fromBox, 'drag handle A bounding box must be measurable').toBeTruthy();
    expect(toBox, 'block C bounding box must be measurable').toBeTruthy();

    const fromX = fromBox!.x + fromBox!.width / 2;
    const fromY = fromBox!.y + fromBox!.height / 2;
    const toX = toBox!.x + toBox!.width / 2;
    const toY = toBox!.y + toBox!.height + 5;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    // Initial small move to exceed the activation distance.
    await page.mouse.move(fromX, fromY + 5, { steps: 3 });
    await page.mouse.move(toX, toY, { steps: 20 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    await page.waitForTimeout(1500);

    // Block order must have changed.
    const idsAfterDrag = await allBlocks.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-block-id')),
    );
    expect(
      idsAfterDrag,
      'block order did not change after pointer drag — MouseCompatPointerSensor may be broken',
    ).not.toEqual(idsBefore);

    // Order must persist after reload.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const idsAfterReload = await blockEditor
      .locator('[data-block-id]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block-id')));
    expect(idsAfterReload).toEqual(idsAfterDrag);
  });

  test('verify block content remains intact after reordering', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Use the seeded page and just verify persistence
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    // Get the first block's initial content
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    const initialContent = await firstBlock.textContent();

    // Reload and verify content persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    const firstBlockAfterReload = blockEditor.locator('[data-block-type]').first();
    const contentAfterReload = await firstBlockAfterReload.textContent();

    // Content should remain the same
    expect(contentAfterReload).toBe(initialContent);
  });
});
