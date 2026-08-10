// Backend unit tests run in the real workerd runtime against a local D1 with the real migrations
// applied, so a migration is exercised before it ships and no D1 behaviour is mocked.
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-01-15',
        d1Databases: ['DB'],
        bindings: {
          // The migrations reach the setup file through a binding, because the test worker runs in
          // workerd and cannot read the filesystem.
          TEST_MIGRATIONS: migrations,
          NODE_ENV: 'test',
          AUTH_DISABLED: 'false',
          ALLOWED_EMAIL: 'owner@example.com',
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    // Test files share one local D1, so they run one at a time.
    fileParallelism: false,
  },
});
