import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('To-do blocks', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('toggle to-do checkbox and verify state persists', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for a to-do block in the seeded content
    const blockEditor = page.locator('[data-testid="block-editor"]');
    let todoBlock = blockEditor.locator('[data-block-type="todo"]').first();

    // If there's no todo in the current page, create one
    if ((await todoBlock.count()) === 0) {
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.waitForTimeout(100);

      // Go to end and create new block
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      // Type /todo
      await page.keyboard.type('/todo');
      await page.waitForTimeout(500);

      // Click the to-do item
      const todoMenuItem = page.locator('[data-testid="slash-menu-item"]').first();
      await todoMenuItem.click();
      await page.waitForTimeout(500);

      // Type some text in the to-do
      const testText = `Todo task ${Date.now()}`;
      await page.keyboard.type(testText);
      await page.waitForTimeout(600);

      todoBlock = blockEditor.locator('[data-block-type="todo"]').first();
    }

    await expect(todoBlock).toBeVisible();

    // Find the to-do checkbox
    const todoCheckbox = todoBlock.locator('input[type="checkbox"]');
    await expect(todoCheckbox).toBeVisible();

    // Verify checkbox is initially unchecked
    const isCheckedBefore = await todoCheckbox.isChecked();

    // If already checked, uncheck it first for the test
    if (isCheckedBefore) {
      await todoCheckbox.click();
      await expect(todoCheckbox).not.toBeChecked();
    }

    await expect(todoCheckbox).not.toBeChecked();

    // Toggle the checkbox ON
    await todoCheckbox.click();

    // Verify checkbox is now checked (web-first — retries until the DOM update commits).
    await expect(todoCheckbox).toBeChecked();

    // Wait for the autosave POST to reach the server before reloading. A fixed 600ms timeout
    // missed the sync request under batch CPU load, causing the state to revert on reload
    // (DEF-104: "assertion on checked-todo state arrived before DOM update committed").
    await page.waitForLoadState('networkidle');

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify the to-do block exists
    const reloadedTodoBlock = blockEditor.locator('[data-block-type="todo"]').first();
    await expect(reloadedTodoBlock).toBeVisible();

    // Verify the checkbox state persisted as checked
    const reloadedCheckbox = reloadedTodoBlock.locator('input[type="checkbox"]');
    await expect(reloadedCheckbox).toBeChecked();
  });

  test('to-do checkbox can be toggled back to unchecked', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find or create a to-do block
    const blockEditor = page.locator('[data-testid="block-editor"]');
    let todoBlock = blockEditor.locator('[data-block-type="todo"]').first();

    if ((await todoBlock.count()) === 0) {
      const firstBlock = blockEditor.locator('[data-block-type]').first();
      await firstBlock.click();
      await page.waitForTimeout(100);

      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);

      await page.keyboard.type('/todo');
      await page.waitForTimeout(500);

      const todoMenuItem = page.locator('[data-testid="slash-menu-item"]').first();
      await todoMenuItem.click();
      await page.waitForTimeout(500);

      const testText = `Toggle test ${Date.now()}`;
      await page.keyboard.type(testText);
      await page.waitForTimeout(600);

      todoBlock = blockEditor.locator('[data-block-type="todo"]').first();
    }

    // Get the checkbox
    const todoCheckbox = todoBlock.locator('input[type="checkbox"]');
    await expect(todoCheckbox).toBeVisible();

    // Make sure it's checked first
    const isCheckedInitially = await todoCheckbox.isChecked();
    if (!isCheckedInitially) {
      await todoCheckbox.click();
      await page.waitForTimeout(300);
      await expect(todoCheckbox).toBeChecked();
    }

    // Toggle OFF
    await todoCheckbox.click();
    await expect(todoCheckbox).not.toBeChecked();

    // Wait for the autosave to reach the server before reloading (DEF-104).
    await page.waitForLoadState('networkidle');

    // Reload and verify OFF state persists
    await page.reload();
    await page.waitForLoadState('networkidle');

    const reloadedTodoBlock = blockEditor.locator('[data-block-type="todo"]').first();
    const reloadedCheckbox = reloadedTodoBlock.locator('input[type="checkbox"]');
    await expect(reloadedCheckbox).not.toBeChecked();
  });
});
