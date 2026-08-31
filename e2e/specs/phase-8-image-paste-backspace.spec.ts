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
  // Large-payload regression: pasting a real screenshot must not show the
  // "you are offline" toast. This is the regression test for the keepalive
  // 64 KiB body cap bug: before the fix, apiPost set keepalive unconditionally,
  // so a ~300 KB data URL caused fetch() to reject, and isOfflineError then
  // mislabelled that TypeError as offline. The synthetic 1x1 PNG used in the
  // basic test is too small to trigger the bug — this test uses a noise canvas
  // large enough that its data URL reliably exceeds 60 000 characters.
  // -------------------------------------------------------------------------

  test('pasting a large image (>60 KB payload) saves without showing an offline error', async ({
    page,
  }) => {
    await openEditor(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstTextarea = blockEditor.locator('textarea').first();
    await firstTextarea.click();
    await page.waitForTimeout(100);

    // Generate a 200x200 random-noise canvas. Random pixels defeat PNG compression,
    // so the data URL reliably exceeds 60 000 characters — enough to trigger the
    // keepalive 64 KiB cap and thereby expose the false-offline bug if it regresses.
    // 200x200 is deliberately small enough to stay as PNG (< 1.5 MB threshold) and to
    // POST quickly (< 300 KB body), making the test fast.
    const dataUrlLength = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      // Fill with random RGBA values so PNG compression cannot reduce the file.
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i++) {
        imageData.data[i] = Math.floor(Math.random() * 256);
      }
      ctx.putImageData(imageData, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.length;
    });

    // Assert the fixture is actually large enough — if this fails, the test
    // setup is wrong and the bug would not have been caught anyway.
    expect(
      dataUrlLength,
      'Fixture data URL must exceed 60 000 chars to stress the keepalive cap',
    ).toBeGreaterThan(60000);

    // Set up the response waiter BEFORE dispatching the paste, otherwise there is a race
    // between the sync request being made and us starting to listen for the response.
    const syncResponsePromise = page.waitForResponse((resp) => resp.url().includes('/sync'), {
      timeout: 15000,
    });

    // Paste the large image.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i++) {
        imageData.data[i] = Math.floor(Math.random() * 256);
      }
      ctx.putImageData(imageData, 0, 0);
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

    // Wait for the image block to appear (optimistic update — happens before the network).
    const img = blockEditor.locator('[data-testid="block-image"]');
    await expect(img).toBeVisible({ timeout: 5000 });
    const src = await img.getAttribute('src');
    expect(src).toMatch(/^data:image\//);

    // Wait for the sync response. The image is compressed (PNG, ~220 KB data URL, ~295 KB body)
    // so this typically resolves in 1–3 seconds against a local wrangler instance.
    const syncResponse = await syncResponsePromise;
    expect(
      syncResponse.status(),
      `Sync request must succeed (200) — got ${syncResponse.status()}`,
    ).toBe(200);

    // Now that the sync has resolved successfully, any error notice should NOT be present.
    // Before the fix, a large-body keepalive rejection would have shown:
    // "Adding a image block could not be saved because you are offline."
    const offlineToast = page.locator('[data-testid="notice"]').filter({
      hasText: /offline|could not be saved/i,
    });
    expect(await offlineToast.count()).toBe(0);

    // Reload and confirm the block persisted — the write actually reached the server.
    await page.reload();
    await page.waitForLoadState('networkidle');
    const imgAfterReload = page.locator('[data-testid="block-image"]');
    await expect(imgAfterReload).toBeVisible({ timeout: 5000 });
    const srcAfterReload = await imgAfterReload.getAttribute('src');
    expect(srcAfterReload).toMatch(/^data:image\//);
  });

  // -------------------------------------------------------------------------
  // Downscaling: images wider or taller than 1600px must be scaled down by
  // compressPastedImage before reaching the server. We draw a 2400x1200
  // noise canvas, paste it, and assert the rendered <img> naturalWidth <= 1600.
  // -------------------------------------------------------------------------

  test('pasting an image wider than 1600px produces a downscaled image block', async ({ page }) => {
    await openEditor(page);

    const blockEditor = page.locator('[data-testid="block-editor"]');
    const firstTextarea = blockEditor.locator('textarea').first();
    await firstTextarea.click();
    await page.waitForTimeout(100);

    // Paste a 2400x1200 noise image.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 2400;
      canvas.height = 1200;
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < imageData.data.length; i++) {
        imageData.data[i] = Math.floor(Math.random() * 256);
      }
      ctx.putImageData(imageData, 0, 0);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png'),
      );
      const file = new File([blob], 'large-screenshot.png', { type: 'image/png' });
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

    // Wait for the image block to appear.
    await page.waitForTimeout(3000);

    const img = blockEditor.locator('[data-testid="block-image"]');
    await expect(img).toBeVisible();

    // Wait for the image to load so naturalWidth is accurate.
    await img.evaluate((el) => {
      const imgEl = el as HTMLImageElement;
      if (imgEl.complete) return Promise.resolve();
      return new Promise<void>((res) => {
        imgEl.onload = () => res();
        imgEl.onerror = () => res(); // resolve even on error; the assertion will catch it
      });
    });

    const naturalWidth = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    const naturalHeight = await img.evaluate((el) => (el as HTMLImageElement).naturalHeight);

    // compressPastedImage must have scaled the 2400x1200 image down to at most 1600px on the longest edge.
    expect(
      naturalWidth,
      `Image naturalWidth ${naturalWidth} exceeds 1600px — compressPastedImage did not downscale`,
    ).toBeLessThanOrEqual(1600);
    expect(
      naturalHeight,
      `Image naturalHeight ${naturalHeight} exceeds 1600px — compressPastedImage did not downscale`,
    ).toBeLessThanOrEqual(1600);
    // Sanity: it should be meaningfully scaled down, not coincidentally small.
    expect(naturalWidth, 'Image should be wider than 100px after downscaling').toBeGreaterThan(100);
  });

  // -------------------------------------------------------------------------
  // Offline path still works: when navigator.onLine is false, a write failure
  // DOES show the offline message, confirming the path was narrowed not removed.
  // -------------------------------------------------------------------------

  test('a write failure while offline shows the offline error message', async ({ page }) => {
    await openEditor(page);

    // Simulate offline by overriding window.fetch to reject sync requests with a TypeError AND
    // setting navigator.onLine to false. page.route() cannot intercept keepalive:true requests
    // (which small images use), so we override fetch directly in the page. navigator.onLine
    // is overridden on Navigator.prototype (not the instance) so the getter persists through
    // React re-renders.
    await page.evaluate(() => {
      // Override navigator.onLine
      Object.defineProperty(Navigator.prototype, 'onLine', {
        get: () => false,
        configurable: true,
      });
      // Override fetch to reject calls to the sync endpoint
      const originalFetch = window.fetch.bind(window);
      window.fetch = function (...args: Parameters<typeof fetch>) {
        const url =
          typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : '';
        if (url.includes('/sync')) {
          return Promise.reject(new TypeError('Network request failed: offline simulation'));
        }
        return originalFetch(...args);
      };
    });

    // Paste a small image — the sync will fail because we aborted the endpoint.
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'blue';
      ctx.fillRect(0, 0, 1, 1);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), 'image/png'),
      );
      const file = new File([blob], 'offline-test.png', { type: 'image/png' });
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

    // The offline notification must appear within 5 seconds. The toast auto-dismisses
    // after 2000ms so we use toBeVisible (which polls) rather than a count after a static delay
    // that might miss the window.
    // isOfflineError now gates on navigator.onLine === false, so this confirms the offline path
    // was preserved — not just silently disabled. Before the fix it would never appear because
    // any TypeError would have been mislabelled (navigator.onLine was not checked).
    const offlineToast = page.locator('[data-testid="notice"]').filter({
      hasText: /offline|could not be saved/i,
    });
    await expect(
      offlineToast,
      'An offline notification must appear when a write fails while the device is offline',
    ).toBeVisible({ timeout: 5000 });

    // Restore the overrides before the test ends so subsequent tests (and the next
    // beforeEach reset) run against the real server and the real navigator.onLine.
    await page.evaluate(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        get: () => true,
        configurable: true,
      });
      // Restore fetch. We replace with the native one; the simplest way is to
      // reload the page — but that would discard the current test context, so
      // instead we restore the stub to a pass-through. The next test's beforeEach
      // reloads the page anyway (resetWorkspace calls page.goto('/') then page.reload()).
      window.fetch = globalThis.fetch;
    });
    await page.waitForTimeout(500);
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
