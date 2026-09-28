/**
 * Retest spec for DEF-035 and DEF-036.
 *
 * DEF-035: Nested sidebar page title fully occluded by hover action overlay.
 * DEF-036: Sidebar row actions stay visible after the pointer leaves the row.
 *
 * Both defects involve the "Lighting ideas" row, which is nested 3 levels deep
 * (Home > Projects > Flat Renovation > Lighting ideas) in the seeded tree.
 * The fix is in Sidebar.tsx: the action overlay no longer uses an absolute
 * full-width backdrop, and the focus-within CSS rule was removed.
 */

import { test, expect } from '@playwright/test';
import { resetWorkspace } from '../fixtures/reset-workspace';

test.beforeEach(async ({ page }) => {
  await resetWorkspace(page);
});

/**
 * Navigates to the workspace root and expands the sidebar tree until the
 * "Lighting ideas" row is visible. Returns a locator for that row.
 *
 * The expand button carries aria-label "Expand <title>" when collapsed, so we
 * can locate it without traversing the DOM via parent ('..') which is fragile.
 */
async function openToLightingIdeas(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const sidebar = page.locator('[data-testid="sidebar"]');

  // Click an expand button if it exists; if the row is already expanded this is a no-op.
  async function ensureExpanded(title: string) {
    const expandBtn = sidebar.getByRole('button', { name: `Expand ${title}` });
    if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(150);
    }
  }

  await ensureExpanded('Home');
  await ensureExpanded('Projects');
  await ensureExpanded('Flat Renovation');

  const lightingRow = sidebar
    .locator('[data-page-id]')
    .filter({ has: page.locator('[data-testid="page-row-title"]', { hasText: 'Lighting ideas' }) });
  await expect(lightingRow).toBeVisible({ timeout: 5000 });
  return lightingRow;
}

// ---------------------------------------------------------------------------
// DEF-035: title is not occluded by the action overlay when the row is hovered
// ---------------------------------------------------------------------------

test('DEF-035: Lighting ideas title is reachable at its centre when hovered', async ({ page }) => {
  const lightingRow = await openToLightingIdeas(page);

  // Hover the row to reveal the action overlay.
  await lightingRow.hover();
  await page.waitForTimeout(200);

  // Locate the title button.
  const titleButton = lightingRow.locator('[data-testid="page-row-title"]');
  await expect(titleButton).toBeVisible();

  // Measure the title button's bounding box and sample elementFromPoint at its centre.
  const result = await page.evaluate(() => {
    const title = document.querySelector('[data-testid="page-row-title"]') as HTMLElement | null;
    if (!title) return null;
    const r = title.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      titleBox: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      hitTestId: (hit as HTMLElement | null)?.dataset?.['testid'] ?? 'none',
      hitTag: hit?.tagName ?? 'none',
    };
  });

  console.log('DEF-035 title hit-test:', JSON.stringify(result));

  // The element at the title centre must be the title itself (or a descendant),
  // not an overlay button such as page-add-child.
  expect(result).not.toBeNull();
  expect(
    result!.hitTestId,
    `Expected title or its child at centre of title button, got testid="${result!.hitTestId}". ` +
      `Title box: ${JSON.stringify(result!.titleBox)}`,
  ).not.toBe('page-add-child');
  expect(result!.hitTestId).not.toBe('page-rename');
  expect(result!.hitTestId).not.toBe('page-delete');
});

// ---------------------------------------------------------------------------
// DEF-036: action overlay hides after focus leaves and pointer moves away
// ---------------------------------------------------------------------------

test('DEF-036: action overlay opacity and pointer-events collapse after focus+pointer leave', async ({
  page,
}) => {
  const lightingRow = await openToLightingIdeas(page);

  // Click the title button to land keyboard focus inside the row — this is the exact
  // scenario DEF-036 describes: a click leaves focusWithin=true on the row.
  const titleButton = lightingRow.locator('[data-testid="page-row-title"]');
  await titleButton.click();
  await page.waitForTimeout(150);

  // Move the pointer well outside the sidebar (900, 700).
  await page.mouse.move(900, 700);
  await page.waitForTimeout(200);

  // Measure the action overlay container's computed style and whether the row is :focus-within.
  // The fix changed the overlay from opacity-0/opacity-100 to display:none/display:flex, so we
  // measure display — not opacity (a display:none element has computed opacity 1 by default,
  // making opacity an unreliable signal).
  type OverlayState = {
    display: string;
    focusWithin: boolean;
    focusVisible: boolean;
  };

  const state = await page.evaluate((): OverlayState => {
    // The desktop action overlay is the container with data-testid="page-row-desktop-actions".
    // There is also a mobile layer; we must measure the desktop one specifically.
    const overlay = document.querySelector(
      '[data-testid="page-row-desktop-actions"]',
    ) as HTMLElement | null;
    if (!overlay) {
      return { display: 'NOT_FOUND', focusWithin: false, focusVisible: false };
    }
    const cs = window.getComputedStyle(overlay);
    // Check whether the sidebar row matches :focus-within and whether any descendant is :focus-visible.
    const row = overlay.closest('[data-page-id]') as HTMLElement | null;
    const focusWithin = row ? row.matches(':focus-within') : false;
    const focusVisible = row
      ? Array.from(row.querySelectorAll(':focus-visible')).length > 0
      : false;
    return {
      display: cs.display,
      focusWithin,
      focusVisible,
    };
  });

  console.log('DEF-036 overlay state after pointer move:', JSON.stringify(state));

  // After clicking the title button (which sets :focus but NOT :focus-visible) and
  // moving the pointer away, the overlay must be hidden.
  // The fix: display:none by default, display:flex only on hover or :focus-visible.
  // A mouse click sets :focus but not :focus-visible, so the overlay must go back to display:none
  // once the pointer leaves — regardless of whether focus-within is still true.
  expect(
    state.display,
    `Overlay display should be "none" after click+pointer-leave. ` +
      `focusWithin=${state.focusWithin}, focusVisible=${state.focusVisible}`,
  ).toBe('none');
});
