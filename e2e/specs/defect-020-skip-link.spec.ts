import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.describe('DEF-020: Skip link allows keyboard users to bypass sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await resetWorkspace(page);
  });

  test('skip link is first focusable element and navigates to editor', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Press Tab once - should focus the skip link
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Check what element is focused
    const focused = page.locator(':focus');
    const focusedElement = await focused.evaluate((el) => ({
      tagName: el.tagName,
      textContent: el.textContent,
      id: el.id,
      className: el.className,
    }));

    console.log(`After first Tab: ${focusedElement.tagName} (${focusedElement.textContent})`);

    // Should be the skip link
    const skipLinkText = focusedElement.textContent?.toLowerCase() || '';
    expect(skipLinkText).toContain('skip');
    expect(skipLinkText).toContain('body');

    // Press Enter to activate the skip link
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Now check if focus is inside the page body (not in the sidebar)
    const focusedAfter = page.locator(':focus');
    const focusedAfterElement = await focusedAfter.evaluate((el) => ({
      tagName: el.tagName,
      id: el.id,
      className: el.className,
      inSidebar: el.closest('[data-testid="sidebar"]') ? true : false,
      inPageBody:
        el.closest('[data-testid="page-body"]') || el.closest('[data-testid="block-editor"]')
          ? true
          : false,
    }));

    console.log(
      `After Enter: ${focusedAfterElement.tagName} (inSidebar: ${focusedAfterElement.inSidebar}, inPageBody: ${focusedAfterElement.inPageBody})`,
    );

    // Focus should NOT be in the sidebar; should be in the page body area
    expect(focusedAfterElement.inSidebar).toBe(false);
    // And should be in the page body or editor
    expect(focusedAfterElement.inPageBody || focusedAfterElement.id === 'page-body').toBe(true);
  });
});
