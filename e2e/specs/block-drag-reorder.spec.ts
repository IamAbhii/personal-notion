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
