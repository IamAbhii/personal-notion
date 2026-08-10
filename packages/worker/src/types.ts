// The Hono application type: the bindings the Worker gets and the per-request values the auth
// middleware puts in the context for handlers to read.
import type { Db } from './db/client';
import type { Env } from './env';
import type { Ctx, Identity } from './repo/context';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: Db;
    identity: Identity;
    // Set by requireWorkspace for routes under /api/workspaces/:workspaceId.
    ctx: Ctx;
  };
};
