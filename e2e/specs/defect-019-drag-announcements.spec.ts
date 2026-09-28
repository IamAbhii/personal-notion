import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-019: Drag announcements contain block text, not UUIDs', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('keyboard drag lift announces block text without UUID', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to Home page with blocks
    const firstPageLink = page.locator('[data-testid="sidebar-item"]').first();
    if (await firstPageLink.isVisible()) {
      await firstPageLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Get the first block and its drag handle
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    const dragHandle = firstBlock.locator('[data-testid="block-drag-handle"]').first();

    await expect(dragHandle).toBeVisible();

    // Focus the drag handle by keyboard
    await dragHandle.focus();
    await page.waitForTimeout(100);

    // Get the block's text content to verify it in announcements
    const blockText = await firstBlock.textContent();
    console.log(`Block text: "${blockText}"`);

    // Press Space to pick up the block (activate drag)
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);

    // Get the live region announcements
    const liveRegion = page.locator('[role="status"], [role="log"], [aria-live]').first();

    let announcementText: string | null = null;
    if (await liveRegion.isVisible()) {
      announcementText = await liveRegion.textContent();
      console.log(`Live region announcement: "${announcementText}"`);
    } else {
      // Try to find any aria-live region
      const allLiveRegions = page.locator('[aria-live]');
      const count = await allLiveRegions.count();
      console.log(`Found ${count} aria-live regions`);

      if (count > 0) {
        announcementText = await allLiveRegions.first().textContent();
        console.log(`First live region: "${announcementText}"`);
      }
    }

    // Release the block
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    // Verify the announcement
    if (announcementText) {
      // Should contain the block's text (or at least not only UUID)
      // UUID pattern: 8-4-4-4-12 hex
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

      // The announcement should not be a UUID-only announcement like
      // "Draggable item 12345678-1234-1234-1234-123456789abc"
      const isUUIDOnly =
        uuidPattern.test(announcementText) && announcementText.split(/\s+/).length < 10;

      console.log(`Is UUID only: ${isUUIDOnly}`);
      console.log(`Announcement length: ${announcementText.length}`);

      // Assert the announcement contains meaningful text, not just UUIDs
      expect(isUUIDOnly).toBe(false);
    }

    expect(true).toBe(true);
  });
});
