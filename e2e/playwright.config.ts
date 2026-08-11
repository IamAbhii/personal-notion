import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { defineConfig, devices } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  webServer: {
    command: `bash ${__dirname}/start-server.sh`,
    url: 'http://localhost:8787',
    // Always start the server; start-server.sh kills any stale ones as its first step.
    // Reusing a stale server is a false-pass risk and is not worth the convenience of skipping
    // the ~5 second cold start, especially since the preflight makes reuse moot anyway.
    reuseExistingServer: false,
    // Timeout is set generously at 45 seconds. A healthy Wrangler dev start serves in a few
    // seconds, so 45s is enough to distinguish a slow start from a wedged one. Anything longer
    // is likely an orphan; fail fast rather than waiting out 120s.
    timeout: 45000,
    cwd: `${__dirname}/..`,
  },
});
