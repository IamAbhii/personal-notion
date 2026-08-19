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
    coverage: {
      // V8 native coverage requires node:inspector which is a non-functional stub in workerd.
      // @cloudflare/vitest-pool-workers explicitly rejects the v8 provider and requires Istanbul,
      // which instruments source code at build time and works on any JavaScript runtime.
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      include: ['src/**'],
      exclude: ['src/index.ts', 'src/env.ts', 'src/types.ts', 'src/**/*.d.ts', 'src/db/schema.ts'],
      thresholds: {
        statements: 80,
      },
    },
  },
});
