// Test setup: apply the real migrations once, then start every test from an empty database.
// Version 0.21 of the pool no longer isolates storage per test, and tests share one local D1, so the
// reset is explicit. Child rows go first because of the foreign keys.
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';

const TABLES_CHILD_FIRST = [
  'applied_ops',
  'pages',
  'sessions',
  'workspace_members',
  'workspaces',
  'users',
];

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch(TABLES_CHILD_FIRST.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});
