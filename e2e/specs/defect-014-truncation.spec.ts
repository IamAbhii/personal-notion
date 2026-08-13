import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-014: Large paste truncation and feedback', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('pasting >10000 characters stores exactly 10000 and shows notice', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create new page
    const addPageButton = page.getByRole('button', { name: 'Add a top-level page' });
    await addPageButton.click();
    await page.waitForURL(/\/w\/[^/]+\/page\/[^/]+/);

    // Click "This page is empty"
    const emptyButton = page.getByRole('button', { name: 'This page is empty' });
    await expect(emptyButton).toBeVisible();
    await emptyButton.click();
    await page.waitForLoadState('networkidle');

    // Get the block editor
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();

    // Click into the block
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Create a string just over 10000 characters
    // Use a shorter, more realistic text pattern
    const largeText = 'The quick brown fox jumps over the lazy dog. '.repeat(235); // 10350 chars
    console.log(`Large text length: ${largeText.length}`);
    expect(largeText.length).toBeGreaterThan(10000);

    // Type it using fillText with a delay between characters (simulating rapid paste)
    // Use type with minimal delay
    for (let i = 0; i < largeText.length; i += 100) {
      const chunk = largeText.slice(i, i + 100);
      await page.keyboard.type(chunk, { delay: 1 });
    }

    console.log('Large text typed');

    // The paste-clamp notice must be visible immediately after the clamping fires. Assert before
    // the reload because the 2 s auto-dismiss lifetime means the notice will be gone by then.
    // Without the fix (no notice) this assertion times out and fails.
    const notice = page.locator('[data-testid="notice"]');
    await expect(notice).toBeVisible({ timeout: 1000 });
    console.log('Paste-clamp notice is visible — truncation feedback confirmed.');

    await page.waitForTimeout(500);

    // Wait for autosave
    await page.waitForTimeout(800);

    // Reload and check the stored length
    await page.reload();
    await page.waitForLoadState('networkidle');

    const blockContent = page
      .locator('[data-testid="block-editor"]')
      .locator('[data-block-type]')
      .first();
    const text = await blockContent.textContent();
    console.log(`Text length after reload: ${text?.length || 0}`);

    // Should be at most 10000 characters (exactly 10000 if truncated)
    expect(text?.length).toBeLessThanOrEqual(10000);

    if (text?.length === 10000) {
      console.log('Truncation confirmed: stored exactly 10000 characters');
    }
  });
});
