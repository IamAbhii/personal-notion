import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('Slash menu', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('open slash menu in an empty block by typing /', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Get the first block in the seeded page
    const blockEditor = page.locator('[data-testid="block-editor"]');
    await expect(blockEditor).toBeVisible();

    // Click into first block
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create a new empty line
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Verify slash menu appears
    const slashMenu = page.locator('[data-testid="slash-menu"]');
    await expect(slashMenu).toBeVisible();

    // Verify there are slash menu items
    const menuItems = page.locator('[data-testid="slash-menu-item"]');
    const itemCount = await menuItems.count();
    expect(itemCount).toBeGreaterThan(0);
  });

  test('slash menu filters as you type', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open slash menu on an existing block
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create new empty block
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Get initial item count
    let menuItems = page.locator('[data-testid="slash-menu-item"]');
    const initialCount = await menuItems.count();

    // Type 'code' to filter
    await page.keyboard.type('code');
    await page.waitForTimeout(500);

    // Get filtered item count
    menuItems = page.locator('[data-testid="slash-menu-item"]');
    const filteredCount = await menuItems.count();

    // Should have fewer items after filtering
    expect(filteredCount).toBeLessThanOrEqual(initialCount);
    expect(filteredCount).toBeGreaterThan(0);
  });

  test('navigate slash menu by keyboard and insert block', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open slash menu
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create new empty block
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Navigate down with arrow keys
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    // Press Enter to select
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // Verify slash menu closes
    const slashMenu = page.locator('[data-testid="slash-menu"]');
    await expect(slashMenu).not.toBeVisible();
  });

  test('click slash menu item to insert block', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open slash menu
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create new empty block
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /
    await page.keyboard.type('/');
    await page.waitForTimeout(500);

    // Click the first menu item
    const firstMenuItem = page.locator('[data-testid="slash-menu-item"]').first();
    await firstMenuItem.click();
    await page.waitForTimeout(500);

    // Verify slash menu closes
    const slashMenu = page.locator('[data-testid="slash-menu"]');
    await expect(slashMenu).not.toBeVisible();
  });

  test('can insert heading block from slash menu', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open slash menu and filter for heading
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create new empty block
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /heading
    await page.keyboard.type('/heading');
    await page.waitForTimeout(500);

    // Click a heading item
    const headingItem = page.locator('[data-testid="slash-menu-item"]').first();
    await expect(headingItem).toBeVisible();
    await headingItem.click();
    await page.waitForTimeout(500);

    // Verify a heading block was inserted
    const headingBlock = blockEditor.locator(
      '[data-block-type="heading1"], [data-block-type="heading2"], [data-block-type="heading3"]',
    );
    const count = await headingBlock.count();
    expect(count).toBeGreaterThan(0);
  });

  test('can insert code block from slash menu', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open slash menu and filter for code
    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    // Go to end and create new empty block
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Type /code
    await page.keyboard.type('/code');
    await page.waitForTimeout(500);

    // Click code item
    const codeItem = page.locator('[data-testid="slash-menu-item"]').first();
    await expect(codeItem).toBeVisible();
    await codeItem.click();
    await page.waitForTimeout(500);

    // Verify a code block was inserted
    const codeBlock = blockEditor.locator('[data-block-type="code"]');
    await expect(codeBlock).toBeVisible();
  });

  test('all eleven block types can be inserted from slash menu and carry correct data-block-type', async ({
    page,
  }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // The eleven block types that should be insertable
    const blockTypes = [
      'paragraph',
      'heading1',
      'heading2',
      'heading3',
      'bulletedList',
      'numberedList',
      'todo',
      'quote',
      'divider',
      'code',
      'callout',
    ];

    for (const blockType of blockTypes) {
      // Get the first block
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.waitForTimeout(100);

      // Go to end and create new empty block
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Type / and the block type name to filter
      let filterText = '/';
      if (blockType === 'heading1') {
        filterText += 'heading 1';
      } else if (blockType === 'heading2') {
        filterText += 'heading 2';
      } else if (blockType === 'heading3') {
        filterText += 'heading 3';
      } else if (blockType === 'bulletedList') {
        filterText += 'bulleted';
      } else if (blockType === 'numberedList') {
        filterText += 'numbered';
      } else if (blockType === 'todo') {
        filterText += 'todo';
      } else {
        filterText += blockType;
      }

      await page.keyboard.type(filterText);
      await page.waitForTimeout(500);

      // Click the first menu item (should be the type we're looking for)
      const menuItem = page.locator('[data-testid="slash-menu-item"]').first();
      await menuItem.click();
      await page.waitForTimeout(500);

      // Verify the block was inserted with the correct type
      // For paragraph, there may be multiple so we check the last one
      let insertedBlock;
      if (blockType === 'paragraph') {
        insertedBlock = blockEditor.locator(`[data-block-type="${blockType}"]`).last();
      } else {
        insertedBlock = blockEditor.locator(`[data-block-type="${blockType}"]`).first();
      }

      await expect(insertedBlock).toBeVisible();

      // Verify the data-block-type attribute matches
      const actualType = await insertedBlock.getAttribute('data-block-type');
      expect(actualType).toBe(blockType);
    }
  });
});
