/**
 * Regression specs for the two visible defects fixed during the Tailwind migration:
 *
 * 1. List markers: Tailwind's preflight sets list-style: none on all ul/ol elements.
 *    The migration restored markers with list-disc and list-decimal utilities. These
 *    specs assert the rendered markers are visible so the fix cannot regress silently.
 *
 * 2. Sidebar title truncation: long page titles were clipping mid-word instead of
 *    truncating with an ellipsis. The migration added min-w-0 + truncate to the title
 *    span. These specs assert the rendered text uses an ellipsis when it overflows.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

// Helper: create a fresh page and open a block, returning the block editor locator.
async function openFreshPage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const addPageButton = page.getByRole('button', { name: 'Add a top-level page' });
  await addPageButton.click();
  await page.waitForURL(/\/w\/[^/]+\/page\/[^/]+/);
  await page.waitForLoadState('networkidle');

  const emptyButton = page.getByRole('button', { name: 'This page is empty' });
  await expect(emptyButton).toBeVisible();
  await emptyButton.click();
  await page.waitForTimeout(300);

  const blockEditor = page.locator('[data-testid="block-editor"]');
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await expect(firstBlock).toBeVisible();
  return { blockEditor, firstBlock };
}

// Helper: convert the currently focused block to a given type via the slash menu.
// The caller must ensure a block is focused before calling this.
async function convertViaSlash(
  page: import('@playwright/test').Page,
  query: string,
  label: string,
) {
  await page.keyboard.type('/');
  // Use Playwright's configured default expect timeout rather than a hand-picked number so this
  // stays in step with the rest of the suite even when the config timeout changes.
  const menu = page.locator('[data-testid="slash-menu"]');
  await expect(menu).toBeVisible();
  await page.keyboard.type(query);
  await page.waitForTimeout(300);
  // Select the matching item.
  const item = menu.locator('[data-testid="slash-menu-item"]').filter({ hasText: label }).first();
  await expect(item).toBeVisible();
  // Wait for any CSS entry animation on the menu to finish before clicking. Under batch load the
  // menu renders as "visible" before its transition completes; clicking mid-animation misses the
  // element because the layout position is still changing (DEF-104: ~20% flake rate in batch).
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="slash-menu"]');
    if (!el) return true;
    return el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
  });
  await item.click();
  await page.waitForTimeout(300);
}

test.describe('Tailwind migration regression: list markers', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('bulleted list block renders a visible disc marker', async ({ page }) => {
    const { firstBlock } = await openFreshPage(page);

    // Focus the block and convert it to a bulleted list.
    await firstBlock.click();
    await page.waitForTimeout(100);
    await convertViaSlash(page, 'bullet', 'Bulleted list');

    // Type text so the block has content.
    await page.keyboard.type('Bullet item');
    await page.waitForTimeout(300);

    // The block should now be a bulleted list.
    const bulletBlock = page.locator('[data-block-type="bulletedList"]').first();
    await expect(bulletBlock).toBeVisible();

    // The <ul> inside the block uses list-disc. Assert the list-style-type is not
    // "none" (which is Tailwind preflight's default that the fix overrides).
    const listStyleType = await bulletBlock.locator('ul').evaluate((el) => {
      return window.getComputedStyle(el).listStyleType;
    });

    // "disc" is the rendered marker; "none" means the fix is missing.
    expect(listStyleType).toBe('disc');
  });

  test('numbered list blocks render 1, 2, 3 markers and restart at 1 after a paragraph', async ({
    page,
  }) => {
    const { firstBlock } = await openFreshPage(page);

    // Build up three numbered-list blocks. Enter on a non-empty list creates another same-type
    // block (DEF-038 fix), so convertViaSlash on the new empty block is a no-op for numbered
    // lists but keeps the structure explicit.

    // Block 1: numbered list.
    await firstBlock.click();
    await page.waitForTimeout(100);
    await convertViaSlash(page, 'number', 'Numbered list');
    await page.keyboard.type('First item');
    await page.waitForTimeout(200);

    // Press Enter → creates a new numbered-list block; verify focus landed there before typing.
    await page.keyboard.press('Enter');
    // Click the newly created last block to ensure focus before the slash command. Under batch
    // load the focus transfer after Enter can lag behind the DOM insert, causing '/' to land
    // in the wrong element and the slash menu never appears (DEF-104 flake pattern).
    await expect(page.locator('[data-testid="block-editor"] [data-block-type]')).toHaveCount(2);
    await page.locator('[data-testid="block-editor"] [data-block-type]').last().click();
    await convertViaSlash(page, 'number', 'Numbered list');
    await page.keyboard.type('Second item');
    await page.waitForTimeout(200);

    // Block 3.
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="block-editor"] [data-block-type]')).toHaveCount(3);
    await page.locator('[data-testid="block-editor"] [data-block-type]').last().click();
    await convertViaSlash(page, 'number', 'Numbered list');
    await page.keyboard.type('Third item');
    await page.waitForTimeout(300);

    // Verify three numbered-list blocks exist.
    const numberedBlocks = page.locator('[data-block-type="numberedList"]');
    await expect(numberedBlocks).toHaveCount(3);

    // Each <ol> should use list-decimal, not none (list-decimal was the migration fix).
    const firstOl = numberedBlocks.nth(0).locator('ol');
    const listStyleType = await firstOl.evaluate((el) => {
      return window.getComputedStyle(el).listStyleType;
    });
    expect(listStyleType).toBe('decimal');

    // The <ol> elements carry a `start` attribute that makes the run count 1, 2, 3.
    const starts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = await numberedBlocks
        .nth(i)
        .locator('ol')
        .evaluate((el) => Number((el as HTMLOListElement).start));
      starts.push(start);
    }
    expect(starts).toEqual([1, 2, 3]);

    // Now break the run with a paragraph block, then add a fourth numbered item.
    // The fourth run must restart at 1, not continue at 4.
    await page.keyboard.press('Enter');
    // DEF-038: Enter on a non-empty list creates another same-type block, not a paragraph.
    // Convert the new empty numbered-list block to a paragraph explicitly.
    // Wait for the new block to appear, then click it to ensure focus before the slash command.
    await expect(page.locator('[data-testid="block-editor"] [data-block-type]')).toHaveCount(4);
    await page.locator('[data-testid="block-editor"] [data-block-type]').last().click();
    await convertViaSlash(page, 'Text', 'Text');
    await page.keyboard.type('A paragraph break');
    await page.waitForTimeout(300);

    // Add a fourth numbered list block after the paragraph.
    // Give the paragraph block time to be created and autosaved before pressing Enter, so the
    // next block creation doesn't compete with a pending API call.
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    // Click the last block to ensure it is focused before typing the slash command, which is
    // needed when running late in a long suite where earlier tests may have left focus state.
    const lastBlock = page.locator('[data-testid="block-editor"] [data-block-type]').last();
    await lastBlock.click();
    await page.waitForTimeout(200);
    await convertViaSlash(page, 'number', 'Numbered list');
    await page.keyboard.type('After break');
    await page.waitForTimeout(300);

    // The block after the paragraph break should have start=1 (run restarted).
    const allNumbered = page.locator('[data-block-type="numberedList"]');
    await expect(allNumbered).toHaveCount(4);

    // The last numbered block sits after the paragraph break; its ol.start must be 1.
    const lastStart = await allNumbered
      .last()
      .locator('ol')
      .evaluate((el) => Number((el as HTMLOListElement).start));
    expect(lastStart).toBe(1);
  });
});

test.describe('Tailwind migration regression: sidebar title truncation', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('long sidebar page title is truncated with an ellipsis, not clipped mid-word', async ({
    page,
  }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Create a new page so we have a page we can name.
    const pageIdBeforeMatch = page.url().match(/\/page\/([^/]+)/);
    expect(pageIdBeforeMatch).toBeTruthy();
    const pageIdBefore = pageIdBeforeMatch![1];

    const addPageButton = page.getByRole('button', { name: 'Add a top-level page' });
    await addPageButton.click();
    await page.waitForURL((url) => {
      const m = url.pathname.match(/\/page\/([^/]+)/);
      return !!m && m[1] !== pageIdBefore;
    });
    await page.waitForLoadState('networkidle');

    // Capture the new page id.
    const pageIdMatch = page.url().match(/\/page\/([^/]+)/);
    expect(pageIdMatch).toBeTruthy();
    const pageId = pageIdMatch![1];

    // Rename the page via the page header (avoids the pointer-events-none sidebar button issue).
    const pageHeaderSection = page.locator('[data-testid="page-header"]');
    const headerRenameButton = pageHeaderSection.getByRole('button', { name: /Rename/ });
    await expect(headerRenameButton).toBeVisible();
    await headerRenameButton.click();

    // A very long page title — longer than any sidebar could show without truncating.
    const longTitle =
      'This is a very long page title that should definitely overflow the sidebar panel width';
    const renameInput = pageHeaderSection.getByRole('textbox');
    await expect(renameInput).toBeVisible();
    await renameInput.clear();
    await renameInput.fill(longTitle);
    await renameInput.press('Enter');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Find the sidebar title span for this page.
    const sidebarRow = page.locator(`[data-testid="sidebar"] [data-page-id="${pageId}"]`);
    await expect(sidebarRow).toBeVisible();
    const titleSpan = sidebarRow.locator('[data-testid="page-row-title"] span');
    await expect(titleSpan).toBeVisible();

    // Assert the span uses text-overflow: ellipsis — the fix that prevents mid-word clipping.
    const textOverflow = await titleSpan.evaluate((el) => {
      return window.getComputedStyle(el).textOverflow;
    });
    expect(textOverflow).toBe('ellipsis');

    // Assert the span does not overflow its container: its rendered width must not exceed the
    // sidebar row's width. The original defect showed the text clipping mid-word, meaning the
    // span exceeded its container and was cut by overflow-hidden on the button.
    const spanBox = await titleSpan.boundingBox();
    const rowBox = await sidebarRow.boundingBox();
    expect(spanBox).not.toBeNull();
    expect(rowBox).not.toBeNull();

    // The span's right edge must not exceed the row's right edge.
    expect(spanBox!.x + spanBox!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);

    // Assert the title is rendered shorter than the full string (i.e., it IS being truncated).
    // A non-truncated title would have a scrollWidth larger than clientWidth on the span.
    const isScrollOverflowing = await titleSpan.evaluate((el) => {
      return el.scrollWidth > el.clientWidth;
    });
    // The span truncates via CSS, so scrollWidth > clientWidth confirms content is clipped
    // at the overflow boundary rather than spilling past it (mid-word clipping).
    expect(isScrollOverflowing).toBe(true);
  });
});
