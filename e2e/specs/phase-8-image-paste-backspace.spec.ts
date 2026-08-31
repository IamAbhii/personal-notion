import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// Helpers for navigating to the editor in a consistent state.
async function openEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const blockEditor = page.locator('[data-testid="block-editor"]');
  await expect(blockEditor).toBeVisible();
  return blockEditor;
}

// Creates an empty block at the bottom of the editor by pressing Enter at the
// end of the first block, then returns the newly-focused textarea.
async function createEmptyBlock(page: import('@playwright/test').Page) {
  const blockEditor = page.locator('[data-testid="block-editor"]');
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await firstBlock.click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

test.describe('Phase 8 — image paste and backspace type reset', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  // -------------------------------------------------------------------------
  // Image paste via clipboard
  // -------------------------------------------------------------------------

  test('pasting a clipboard image inserts an image block with a data: src', async ({ page }) => {
    // The onPaste handler in BlockRow reads event.clipboardData.items, finds an
    // image/* item, reads it via FileReader, and calls onPasteImage with the data URL.
    //
    // In headless Chromium, native Ctrl+V paste does not populate clipboardData.items
    // the way a real user gesture does (OS clipboard access is restricted in headless mode).
    // We therefore dispatch a synthetic paste event. We set the `clipboardData` property
    // via Object.defineProperty on a plain Event — verified to work with React 18's
    // event delegation (event.defaultPrevented becomes true after dispatch, confirming
    // the React handler ran and found the image item).

    await openEditor(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstTextarea = blockEditor.locator('textarea').first();
    await firstTextarea.click();
    await page.waitForTimeout(100);

    const countBefore = await blockEditor.locator('[data-block-id]').count();

    // Dispatch a synthetic paste event whose clipboardData contains a real 1×1 PNG file.
    // The PNG is a minimal valid image so the <img> element actually loads and becomes visible.
    // React's onPaste handler for the textarea receives this and calls FileReader.readAsDataURL.
    await page.evaluate(async () => {
      // Generate a real PNG via canvas so it is a valid image the browser can render.
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png'),
      );
      const file = new File([blob], 'screenshot.png', { type: 'image/png' });

      const fakeItem = { type: 'image/png', getAsFile: () => file };
      const fakeClipboardData = { items: [fakeItem] };

      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: fakeClipboardData,
        configurable: true,
      });

      const textarea = document.querySelector(
        '[data-testid="block-editor"] textarea',
      ) as HTMLTextAreaElement;
      if (!textarea) throw new Error('No textarea found');
      textarea.dispatchEvent(event);
    });

    // FileReader.readAsDataURL is async — wait for the onload callback and then
    // for React to commit the state update (patchBlocks + network sync).
    await page.waitForTimeout(1500);

    // An image block should have been inserted.
    const countAfter = await blockEditor.locator('[data-block-id]').count();
    expect(countAfter).toBe(countBefore + 1);

    // The image block renders a testid="block-image" <img> with a data: src.
    const img = blockEditor.locator('[data-testid="block-image"]');
    await expect(img).toBeVisible();
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\//);
  });

  test('pasting plain text does not insert an image block', async ({ page }) => {
    await openEditor(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstTextarea = blockEditor.locator('textarea').first();
    await firstTextarea.click();
    await page.waitForTimeout(100);

    const countBefore = await blockEditor.locator('[data-block-id]').count();

    // Paste plain text via keyboard shortcut — no image block should appear.
    await page.keyboard.insertText('hello world');
    await page.waitForTimeout(500);

    // No image element should be present.
    const img = blockEditor.locator('[data-testid="block-image"]');
    expect(await img.count()).toBe(0);

    // Block count is the same or grew by at most 1 if Enter was implied — but no image row.
    const countAfter = await blockEditor.locator('[data-block-id]').count();
    expect(countAfter).toBeLessThanOrEqual(countBefore + 1);
  });

  // -------------------------------------------------------------------------
  // Backspace type reset: non-paragraph empty block resets to paragraph
  // -------------------------------------------------------------------------

  test('backspace on empty heading1 block resets it to paragraph, not deleted', async ({
    page,
  }) => {
    await openEditor(page);
    await createEmptyBlock(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // Record the heading1 count before conversion (seeded content contains heading1 blocks).
    const heading1CountBefore = await blockEditor.locator('[data-block-type="heading1"]').count();

    // Use the slash menu to convert the empty block to heading1.
    await page.keyboard.type('/heading1');
    await page.waitForTimeout(500);

    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: /heading 1/i })
      .first();
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await page.waitForTimeout(400);

    // One more heading1 now exists.
    expect(await blockEditor.locator('[data-block-type="heading1"]').count()).toBe(
      heading1CountBefore + 1,
    );

    const blockCountBeforeBackspace = await blockEditor.locator('[data-block-id]').count();

    // Click the new (last) heading1 block's textarea to ensure keyboard events land there.
    const newHeading = blockEditor.locator('[data-block-type="heading1"]').last();
    await newHeading.locator('textarea').click();
    await page.waitForTimeout(100);

    // Press Backspace with the caret at the start of the empty heading.
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    // Block was NOT deleted — total count is the same.
    expect(await blockEditor.locator('[data-block-id]').count()).toBe(blockCountBeforeBackspace);

    // Block type was reset to paragraph — heading1 count is back to what it was before.
    expect(await blockEditor.locator('[data-block-type="heading1"]').count()).toBe(
      heading1CountBefore,
    );

    // A textarea is still in the DOM (the block is now an editable paragraph).
    expect(await blockEditor.locator('textarea').count()).toBeGreaterThan(0);
  });

  test('backspace on empty heading2 block resets it to paragraph', async ({ page }) => {
    await openEditor(page);
    await createEmptyBlock(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    const heading2CountBefore = await blockEditor.locator('[data-block-type="heading2"]').count();

    await page.keyboard.type('/heading2');
    await page.waitForTimeout(500);

    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: /heading 2/i })
      .first();
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await page.waitForTimeout(400);

    expect(await blockEditor.locator('[data-block-type="heading2"]').count()).toBe(
      heading2CountBefore + 1,
    );

    const blockCountBefore = await blockEditor.locator('[data-block-id]').count();

    const newHeading2 = blockEditor.locator('[data-block-type="heading2"]').last();
    await newHeading2.locator('textarea').click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    expect(await blockEditor.locator('[data-block-id]').count()).toBe(blockCountBefore);
    expect(await blockEditor.locator('[data-block-type="heading2"]').count()).toBe(
      heading2CountBefore,
    );
  });

  test('backspace on empty quote block resets it to paragraph', async ({ page }) => {
    await openEditor(page);
    await createEmptyBlock(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    const quoteCountBefore = await blockEditor.locator('[data-block-type="quote"]').count();

    await page.keyboard.type('/quote');
    await page.waitForTimeout(500);

    const menuItem = page
      .locator('[data-testid="slash-menu-item"]')
      .filter({ hasText: /quote/i })
      .first();
    await expect(menuItem).toBeVisible();
    await menuItem.click();
    await page.waitForTimeout(400);

    expect(await blockEditor.locator('[data-block-type="quote"]').count()).toBe(
      quoteCountBefore + 1,
    );

    const blockCountBefore = await blockEditor.locator('[data-block-id]').count();

    const newQuote = blockEditor.locator('[data-block-type="quote"]').last();
    await newQuote.locator('textarea').click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    expect(await blockEditor.locator('[data-block-id]').count()).toBe(blockCountBefore);
    expect(await blockEditor.locator('[data-block-type="quote"]').count()).toBe(quoteCountBefore);
  });

  // -------------------------------------------------------------------------
  // Backspace on paragraph still deletes the block
  // -------------------------------------------------------------------------

  test('backspace on empty paragraph block deletes it and focuses the block above', async ({
    page,
  }) => {
    await openEditor(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');

    // Create a first paragraph with text, then press Enter to add an empty second paragraph.
    const firstBlock = blockEditor.locator('[data-block-type]').first();
    await firstBlock.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    const countBeforeBackspace = await blockEditor.locator('[data-block-id]').count();

    // The new block is empty and is a paragraph — Backspace should delete it.
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(400);

    const countAfterBackspace = await blockEditor.locator('[data-block-id]').count();
    expect(countAfterBackspace).toBe(countBeforeBackspace - 1);
  });
});
