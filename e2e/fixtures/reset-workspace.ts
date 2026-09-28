import { Page, expect } from '@playwright/test';

// Reset the workspace to a clean seeded state before each test.
// Fails loudly if the app has not reached a /w/<id> URL — a silent skip
// is worse than a failure because it lets stale state bleed between tests.
export async function resetWorkspace(page: Page) {
  await page.goto('/');

  // Wait for the app to actually redirect to a workspace URL, not merely for
  // network activity to quiet down. networkidle is not sufficient: the app
  // may still be in the process of redirecting when activity drops to zero.
  await page.waitForURL(/\/w\/[^/]+/, { timeout: 15000 });

  const urlMatch = page.url().match(/\/w\/([^/]+)/);
  // This must never be null — waitForURL above guarantees the pattern matched.
  // If it is null something is deeply wrong and the test must not proceed.
  expect(
    urlMatch,
    'Could not extract workspaceId from URL after goto("/"): ' + page.url(),
  ).toBeTruthy();
  const workspaceId = urlMatch![1];

  // POST to the reset endpoint to wipe user-created data and re-seed.
  const response = await page.request.post(`/api/workspaces/${workspaceId}/test/reset`);
  expect(response.status()).toBe(200);
  const responseBody = await response.json();
  expect(responseBody.workspaceId).toBe(workspaceId);

  // Reload so the page sees the freshly-seeded state before the test begins.
  await page.reload();
  await page.waitForLoadState('networkidle');
}
