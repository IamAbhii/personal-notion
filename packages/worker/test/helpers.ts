// Shared test setup: a real user, workspace, membership and session in the local D1, plus a fetch
// helper that carries the session cookie. Tests exercise handlers through SELF, so the whole stack
// (middleware, repository, D1) runs exactly as it does in production.
import { env, SELF } from 'cloudflare:test';
import { createDb, type Db } from '../src/db/client';
import { createSession, SESSION_COOKIE } from '../src/repo/sessions';
import { createUser, createWorkspaceForUser } from '../src/repo/accounts';
import type { Ctx, Role } from '../src/repo/context';

export const OWNER_EMAIL = 'owner@example.com';
export const ORIGIN = 'https://space.test';

export type TestAccount = {
  db: Db;
  ctx: Ctx;
  sessionId: string;
  userId: string;
  workspaceId: string;
};

// Returns a Drizzle handle on the test database for direct assertions.
export function testDb(): Db {
  return createDb(env.DB);
}

// Creates a signed-in account with one workspace and returns everything a test needs to act as it.
// The email defaults to the allowlisted one; pass another to exercise a refused account.
export async function createAccount(
  options: { email?: string; role?: Role; workspaceName?: string } = {},
): Promise<TestAccount> {
  const db = testDb();
  const email = options.email ?? OWNER_EMAIL;
  const user = await createUser(db, { email, name: 'Test Owner' });
  const membership = await createWorkspaceForUser(
    db,
    user.id,
    options.workspaceName ?? 'Test Space',
    options.role ?? 'owner',
  );
  const sessionId = await createSession(db, user.id);
  return {
    db,
    ctx: { userId: user.id, workspaceId: membership.workspaceId, role: options.role ?? 'owner' },
    sessionId,
    userId: user.id,
    workspaceId: membership.workspaceId,
  };
}

// Fetches an API path as the given account (or anonymously when no session id is given).
export function apiFetch(
  path: string,
  options: RequestInit & { sessionId?: string } = {},
): Promise<Response> {
  const { sessionId, headers, ...rest } = options;
  const merged = new Headers(headers);
  if (sessionId) merged.set('Cookie', `${SESSION_COOKIE}=${sessionId}`);
  if (rest.body && !merged.has('Content-Type')) merged.set('Content-Type', 'application/json');
  return SELF.fetch(`${ORIGIN}${path}`, { ...rest, headers: merged });
}

let clientSeq = 0;

type OpType =
  | 'page.create'
  | 'page.update'
  | 'page.delete'
  | 'block.create'
  | 'block.update'
  | 'block.delete'
  | 'property.create'
  | 'property.update'
  | 'property.delete'
  | 'value.set';

// Derives the entity field from the op type so tests only state what they are testing. Phase 3 adds
// property and value entities; a test that wants a mismatched entity passes it as an override.
function entityForType(type: OpType): string {
  if (type.startsWith('block.')) return 'block';
  if (type.startsWith('property.')) return 'property';
  if (type.startsWith('value.')) return 'value';
  return 'page';
}

// Builds a well-formed op with sensible defaults, so a test only states what it is testing. The
// envelope's entity is derived from the type, which is exactly what the server insists on; a test that
// wants a mismatched entity overrides it.
export function makeOp(
  workspaceId: string,
  type: OpType,
  entityId: string,
  payload: Record<string, unknown> = {},
  overrides: {
    opId?: string;
    baseVersion?: number | null;
    clientSeq?: number;
    entity?: string;
  } = {},
) {
  clientSeq += 1;
  return {
    opId: overrides.opId ?? crypto.randomUUID(),
    workspaceId,
    entity: overrides.entity ?? entityForType(type),
    entityId,
    type,
    payload,
    baseVersion: overrides.baseVersion ?? null,
    clientSeq: overrides.clientSeq ?? clientSeq,
    createdAt: Date.now(),
  };
}
