import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Phase 2 Defect Regressions', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('DEF-011: Typing at human speed keeps characters in correct blocks', async ({ page }) => {
    // Navigate to the app (fresh reset)
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create first page
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

    // Click into the first block
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Type "First line" at ~100ms per keystroke (human speed)
    const firstText = 'First line typed at normal speed';
    for (const char of firstText) {
      await page.keyboard.type(char);
      await page.waitForTimeout(100);
    }

    // Press Enter to create new block
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Type "Second line" at normal speed
    const secondText = 'Second line';
    for (const char of secondText) {
      await page.keyboard.type(char);
      await page.waitForTimeout(100);
    }

    // Wait for autosave
    await page.waitForTimeout(1000);

    // Reload to verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify the text is correct in both blocks
    const blocks = page.locator('[data-testid="block-editor"]').locator('[data-block-type]');
    const blockCount = await blocks.count();

    expect(blockCount).toBeGreaterThanOrEqual(2);

    const firstBlockText = await blocks.nth(0).textContent();
    const secondBlockText = await blocks.nth(1).textContent();

    // First block should contain "First line" without the second character in it
    expect(firstBlockText).toContain('First line typed at normal speed');

    // Second block should contain "Second line" (not be missing the 'S')
    expect(secondBlockText).toContain('Second line');

    // Verify they are NOT mixed
    expect(firstBlockText).not.toMatch(/speedS\s*$/);
    expect(secondBlockText).not.toMatch(/^econd/);
  });

  test('DEF-012: Text typed while slash menu is open is saved on menu close', async ({ page }) => {
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

    // Type text that starts with / (to open the menu)
    const testText = '/my important note';
    await page.keyboard.type(testText);
    await page.waitForTimeout(300);

    // Close the menu with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Wait for autosave
    await page.waitForTimeout(600);

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The block should contain the text
    const blockContent = page
      .locator('[data-testid="block-editor"]')
      .locator('[data-block-type]')
      .first();
    const text = await blockContent.textContent();

    expect(text).toBeTruthy();
    expect(text?.length).toBeGreaterThan(0);
    expect(text).toContain('important');
  });

  test('DEF-013: Keystrokes inside 500ms debounce window flush on reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to first page (seeded page exists)
    const firstPageLink = page.locator('[data-testid="sidebar-item"]').first();
    if (await firstPageLink.isVisible()) {
      await firstPageLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Get the first block in the editor
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();

    // Click into the block and go to end
    await firstBlock.click();
    await page.keyboard.press('End');
    await page.waitForTimeout(100);

    // Type text within the 500ms debounce window
    const textToAdd = 'LOSTTEXT';
    await page.keyboard.type(textToAdd);

    // Immediately reload (before the 500ms debounce settles)
    await page.reload();
    await page.waitForLoadState('networkidle');

    // The text should be there (saved by beforeunload handler)
    const blockContent = page
      .locator('[data-testid="block-editor"]')
      .locator('[data-block-type]')
      .first();
    const text = await blockContent.textContent();

    // The text should contain "LOSTTEXT" - it should have been flushed on unload
    expect(text).toContain('LOSTTEXT');
  });

  test('DEF-015: Emoji at text boundary does not corrupt', async ({ page }) => {
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

    // Type text with emoji
    const testText = 'Before emoji 😀 after emoji';
    await page.keyboard.type(testText);

    // Wait for autosave
    await page.waitForTimeout(1000);

    // Reload to verify
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Check the stored text
    const blockContent = page
      .locator('[data-testid="block-editor"]')
      .locator('[data-block-type]')
      .first();
    const text = await blockContent.textContent();

    // Should not contain replacement characters (U+FFFD) which indicates mojibake
    expect(text).not.toContain('�');

    // The emoji should be present and readable
    expect(text).toContain('😀');
  });

  test('DEF-016: Block sort keys remain stable across reload', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to a page with blocks (Home/seeded page)
    const firstPageLink = page.locator('[data-testid="sidebar-item"]').first();
    if (await firstPageLink.isVisible()) {
      await firstPageLink.click();
      await page.waitForLoadState('networkidle');
    }

    // Get initial block order
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const blocks = blockEditor.locator('[data-block-type]');
    const blockCountBefore = await blocks.count();

    // Get text of first few blocks to verify order
    const textsBeefore: string[] = [];
    for (let i = 0; i < Math.min(3, blockCountBefore); i++) {
      const text = await blocks.nth(i).textContent();
      textsBeefore.push(text || '');
    }

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Get block order after reload
    const blocksAfter = blockEditor.locator('[data-block-type]');
    const blockCountAfter = await blocksAfter.count();

    // Block count should be the same
    expect(blockCountAfter).toBe(blockCountBefore);

    // Block order should be the same
    const textsAfter: string[] = [];
    for (let i = 0; i < Math.min(3, blockCountAfter); i++) {
      const text = await blocksAfter.nth(i).textContent();
      textsAfter.push(text || '');
    }

    // Verify order is stable
    expect(textsAfter).toEqual(textsBeefore);
  });

  test('DEF-018: Enter key works when slash query matches nothing', async ({ page }) => {
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

    // Type a non-matching slash command
    await page.keyboard.type('/nomatch');
    await page.waitForTimeout(300);

    // Menu should be open showing "No block type matches that"
    const noMatch = page.locator('text=No block type matches that');
    const menuOpen = await noMatch.isVisible();

    if (menuOpen) {
      // Press Enter - should close the menu
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Check if menu closed
      const menuStillOpen = await noMatch.isVisible();

      // At minimum, Enter should close the menu
      expect(menuStillOpen).toBe(false);
    }
  });
});
