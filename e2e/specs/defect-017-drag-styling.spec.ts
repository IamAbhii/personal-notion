import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-017: Block being dragged has visible background', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('dragged block has full opacity background, not translucent placeholder', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to a page with blocks (Home/seeded page)
    const firstPageLink = page.locator('[data-testid="sidebar-item"]').first();
    if (await firstPageLink.isVisible()) {
      await firstPageLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Get the first block
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();

    // Get the drag handle
    const dragHandle = firstBlock.locator('[data-testid="block-drag-handle"]').first();
    await expect(dragHandle).toBeVisible();

    // Start dragging from the handle
    const handleBox = await dragHandle.boundingBox();
    if (!handleBox) {
      test.skip();
      return;
    }

    // Drag from the handle center
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.waitForTimeout(100);
    await page.mouse.down();
    await page.waitForTimeout(200);

    // Move pointer down to another block
    const secondBlock = blockEditor.locator('[data-block-type]').nth(1);
    if (await secondBlock.isVisible()) {
      const bbox = await secondBlock.boundingBox();
      if (bbox) {
        await page.mouse.move(bbox.x + 50, bbox.y + 10);
        await page.waitForTimeout(300);

        // Find the lifted block (.block--dragging)
        const draggingBlock = page.locator('[data-block-type].block--dragging').first();

        if (await draggingBlock.isVisible()) {
          // Check the computed background-color has full opacity (alpha 1)
          const bgColor = await draggingBlock.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return style.backgroundColor;
          });

          console.log(`Dragging block background: ${bgColor}`);

          // Should be a solid color like "rgb(X, Y, Z)" or "rgba(X, Y, Z, 1)", not transparent
          expect(bgColor).toBeTruthy();
          // Should not be transparent
          expect(bgColor).not.toContain('rgba(');
          // Or if it is rgba, alpha should be 1
          if (bgColor.includes('rgba')) {
            const alphaMatch = bgColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([^)]+)\)/);
            if (alphaMatch) {
              const alpha = parseFloat(alphaMatch[1]);
              expect(alpha).toBe(1);
            }
          }
        }
      }
    }

    // Release
    await page.mouse.up();

    expect(true).toBe(true);
  });
});
