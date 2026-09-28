/**
 * Retest of DEF-021: the clamp notice previously said "pasted" when triggered by keyboard input.
 *
 * The fix fires the notice from the generic onChange handler so it covers both paste and keyboard
 * input. The message must not contain "pasted", and must say something type-neutral (e.g.
 * "A block holds at most ... characters").
 *
 * The notice renders with data-testid="notice" (same as DEF-014's paste notice).
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-021 retest — clamp notice is type-neutral', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('typing past 10 000 characters shows a notice that does not say "pasted"', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a new page to get a fresh block editor.
    const createBtn = page.getByRole('button', { name: 'Add a top-level page' });
    await createBtn.click();
    await page.waitForURL(/\/w\/[^/]+\/page\/[^/]+/);
    await page.waitForLoadState('networkidle');

    // Click "This page is empty" to create the first block.
    const emptyBtn = page.getByRole('button', { name: 'This page is empty' });
    await expect(emptyBtn).toBeVisible();
    await emptyBtn.click();
    await page.waitForLoadState('networkidle');

    const blockEditor = page.getByTestId('block-editor');
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await expect(firstBlock).toBeVisible();
    await firstBlock.click();

    // Fill 9,990 characters in one shot via the textarea inside the block so we arrive near the
    // limit without spending ~10 seconds on individual CDP keystrokes. Then genuinely type ~20
    // more characters through keyboard.type so that the generic onChange handler (not the paste
    // handler) is what triggers the clamp and fires the notice. The boundary crossing happens
    // through real keystrokes — that is the behaviour DEF-021 tests.
    // Note: [data-block-type] is the container div; blocks use a <textarea>, not contenteditable.
    const blockTextarea = firstBlock.locator('textarea');
    await expect(blockTextarea).toBeVisible();
    await blockTextarea.fill('a'.repeat(9990));
    // Type 20 more characters to cross 10 000 via incremental keyboard input.
    await page.keyboard.type('bbbbbbbbbbbbbbbbbbbb', { delay: 0 });

    // The notice must appear. The notice component uses data-testid="notice".
    // Give it a generous timeout since large keyboard.type can be slow.
    const notice = page.locator('[data-testid="notice"]');
    await expect(notice).toBeVisible({ timeout: 10000 });

    // The notice must NOT contain the word "pasted".
    const noticeText = await notice.textContent();
    expect(noticeText).not.toMatch(/pasted/i);

    // The notice should mention "10,000" or "10000" and "block".
    expect(noticeText).toMatch(/10.?000/);
    expect(noticeText).toMatch(/block/i);
  });
});
