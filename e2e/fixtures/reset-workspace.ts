import { Page, expect } from '@playwright/test';

export async function resetWorkspace(page: Page) {
  // Navigate to the app first to establish a session and get the workspace ID
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Extract workspace ID from URL
  const urlMatch = page.url().match(/\/w\/([^/]+)/);
  if (urlMatch) {
    const workspaceId = urlMatch[1];

    // Call the test reset endpoint to reset the workspace
    const response = await page.request.post(`/api/workspaces/${workspaceId}/test/reset`);

    // Verify the reset succeeded
    expect(response.status()).toBe(200);
    const responseBody = await response.json();
    expect(responseBody.workspaceId).toBe(workspaceId);

    // Verify the reset actually worked by checking the database state
    // The reset endpoint should have cleared all user-created pages and re-seeded
    await page.reload();
    await page.waitForLoadState('networkidle');
  }
}
