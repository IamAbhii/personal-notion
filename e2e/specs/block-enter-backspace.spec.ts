import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Enter and Backspace block behavior', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('pressing Enter inserts a new block below and focuses it', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get the first block from seeded content
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Type some text
    const text = `First block ${Date.now()}`;
    await page.keyboard.type(text);
    await page.waitForTimeout(300);

    // Count blocks before pressing Enter
    let allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountBefore = await allBlocks.count();

    // Press End then Enter to go to end of block and create new one
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Count blocks after
    allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountAfter = await allBlocks.count();

    // Should have one more block
    expect(blockCountAfter).toBe(blockCountBefore + 1);
  });

  test('pressing Enter inside code block inserts newline, not a new block', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find or create a code block
    const blockEditor = page.locator('[data-testid="block-editor"]');
    let codeBlock = blockEditor.locator('[data-block-type="code"]').first();

    if ((await codeBlock.count()) === 0) {
      // Create a code block via slash menu
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.waitForTimeout(100);

      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await page.keyboard.type('/code');
      await page.waitForTimeout(500);

      const codeMenuItem = page.locator('[data-testid="slash-menu-item"]').first();
      await codeMenuItem.click();
      await page.waitForTimeout(500);

      codeBlock = blockEditor.locator('[data-block-type="code"]').first();
    }

    // Click into the code block
    await codeBlock.click();
    await page.waitForTimeout(100);

    // Count blocks before
    let allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountBefore = await allBlocks.count();

    // Clear and type some code
    await page.keyboard.press('Control+A');
    await page.keyboard.type('const x = 1;');
    await page.waitForTimeout(300);

    // Press Enter (should insert newline in code block, not create new block)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type more code
    await page.keyboard.type('const y = 2;');
    await page.waitForTimeout(300);

    // Count blocks after
    allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountAfter = await allBlocks.count();

    // Should still have same number of blocks (Enter didn't create a new block)
    expect(blockCountAfter).toBe(blockCountBefore);

    // Verify both lines are in the same code block
    const codeText = await codeBlock.textContent();
    expect(codeText).toContain('const x = 1;');
    expect(codeText).toContain('const y = 2;');
  });

  test('pressing Backspace at start of empty block removes it and moves caret to end of block above', async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get the first block from seeded content
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Type some text in the first block
    const text = `First block ${Date.now()}`;
    await page.keyboard.type(text);
    await page.waitForTimeout(300);

    // Create a second block by pressing Enter at the end
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Count blocks before Backspace
    let allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountBefore = await allBlocks.count();

    // Verify we're now in the second (empty) block by pressing Home to go to start
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);

    // Press Backspace at the start of the empty block
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    // Count blocks after Backspace
    allBlocks = blockEditor.locator('[data-block-id]');
    const blockCountAfter = await allBlocks.count();

    // Should have one fewer block
    expect(blockCountAfter).toBe(blockCountBefore - 1);

    // Verify the first block's text is still there (caret should be at the end of it)
    const firstBlockAfter = blockEditor.locator('[data-block-type]').first();
    const firstBlockText = await firstBlockAfter.textContent();
    expect(firstBlockText).toContain(text);
  });
});
