/**
 * One-shot spec: take screenshots of the toggleList block features.
 * Used for the Phase 7 gate report.
 * This spec is excluded from the normal suite and run on demand.
 */
import { test } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

const SCREENSHOTS = '/Users/abhijeet.brahmbhatt/Documents/Repos/personal-notion/screenshots';

async function createToggleWithChildren(page: Parameters<typeof resetWorkspace>[0]) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const blockEditor = page.locator('[data-testid="block-editor"]');
  const firstBlock = blockEditor.locator('[data-block-type]').first();
  await firstBlock.click();
  await page.waitForTimeout(100);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('/toggle');
  await page.waitForTimeout(400);
  const menuItem = page
    .locator('[data-testid="slash-menu-item"]')
    .filter({ hasText: 'Toggle list' })
    .first();
  await menuItem.click();
  await page.waitForTimeout(400);
  await page.keyboard.type('My Toggle Header');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('First child paragraph');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.keyboard.type('Second child paragraph');
  await page.waitForTimeout(300);
}

test('phase-7-toggle-expanded: toggle with two children, expanded (criterion 2 and 3)', async ({
  page,
}) => {
  await resetWorkspace(page);
  await createToggleWithChildren(page);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-7-toggle-expanded.png` });
});

test('phase-7-toggle-collapsed: toggle collapsed, aria-expanded=false (criterion 2)', async ({
  page,
}) => {
  await resetWorkspace(page);
  await createToggleWithChildren(page);
  const chevron = page.locator('[data-testid="block-toggle-arrow"]').first();
  await chevron.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-7-toggle-collapsed.png` });
});

test('phase-7-toggle-mobile: toggle on Pixel 5 viewport (mobile layout)', async ({ page }) => {
  // Pixel 5 is 393×851
  await page.setViewportSize({ width: 393, height: 851 });
  await resetWorkspace(page);
  await createToggleWithChildren(page);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-7-toggle-mobile.png` });
});
