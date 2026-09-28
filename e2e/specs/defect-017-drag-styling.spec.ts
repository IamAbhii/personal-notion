import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-017: Block being dragged has visible background', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('dragged block has data-dragging="true" and a solid background colour', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The root URL navigates to the seeded Home page which already has blocks.
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();

    // Hover the block so its drag handle is pointer-interactive, then grab the handle.
    await firstBlock.hover();
    const dragHandle = firstBlock.locator('[data-testid="block-drag-handle"]').first();
    await expect(dragHandle).toBeVisible();

    const handleBox = await dragHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    // Press down on the handle, wait for dnd-kit to recognise the drag.
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    );
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(300);

    // Move the pointer over the second block to trigger the active-drag state.
    const secondBlock = blockEditor.locator('[data-block-type]').nth(1);
    await expect(secondBlock).toBeVisible();
    const secondBox = await secondBlock.boundingBox();
    expect(secondBox).not.toBeNull();
    await page.mouse.move(secondBox!.x + 50, secondBox!.y + 10);
    await page.waitForTimeout(400);

    // The block row holding the drag styles must carry data-dragging="true".
    // Assert unconditionally — if the element is absent the test fails, not silently passes.
    const draggingBlock = page.locator('[data-block-type][data-dragging="true"]').first();
    await expect(draggingBlock).toBeVisible();

    // The dragging block must have a solid (non-transparent) background colour.
    const bgColor = await draggingBlock.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // A solid background renders as "rgb(R, G, B)" or "rgba(R, G, B, 1)".
    // "rgba(0, 0, 0, 0)" / "transparent" would signal the DEF-017 regression.
    expect(bgColor).not.toBe('');
    expect(bgColor).not.toBe('transparent');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

    if (bgColor.includes('rgba')) {
      const alphaMatch = bgColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
      expect(alphaMatch).not.toBeNull();
      const alpha = parseFloat(alphaMatch![1]);
      expect(alpha).toBe(1);
    }

    await page.mouse.up();
  });
});
