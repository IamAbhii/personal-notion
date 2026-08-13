// Types for the bindings the test pool provides, so `env` in tests is typed like the Worker's own.
// The pool types `env` as Cloudflare.Env, so the Worker's bindings plus the migrations binding are
// declared there.
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerEnv } from '../src/env';

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
