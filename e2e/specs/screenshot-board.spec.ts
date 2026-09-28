/**
 * One-shot spec: take a screenshot of the board view grouped by Status.
 * Used for the phase 5 gate report (criterion 3 evidence).
 * This spec is excluded from the normal suite and run on demand.
 */
import { test } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

const SCREENSHOTS = '/Users/abhijeet.brahmbhatt/Documents/Repos/personal-notion/screenshots';

test('board view grouped by Status — criterion 3 screenshot', async ({ page }) => {
  await resetWorkspace(page);
  const wpBtn = page
    .getByTestId('sidebar')
    .getByRole('button', { name: /Work Projects/ })
    .first();
  await wpBtn.click();
  await page.waitForLoadState('networkidle');
  await page.getByRole('tab', { name: 'Board view' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SCREENSHOTS}/phase-5-board-status-grouped.png` });
});
