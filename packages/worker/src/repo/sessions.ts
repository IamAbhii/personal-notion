// Session data access. Sessions live in D1 rather than in a signed cookie so that sign-out (and a
// future "sign out everywhere") deletes them server-side and a stolen cookie stops working.
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { runBatch } from '../db/batch';
import { sessions, users } from '../db/schema';
import { newSessionToken } from '../lib/ids';

export const SESSION_COOKIE = 'ps_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionUser = { sessionId: string; userId: string; email: string; name: string };

// Creates a session row for a user and returns its opaque id, which becomes the cookie value.
export async function createSession(db: Db, userId: string, now = Date.now()): Promise<string> {
  const id = newSessionToken();
  await runBatch(db, [
    db.insert(sessions).values({ id, userId, createdAt: now, expiresAt: now + SESSION_TTL_MS }),
  ]);
  return id;
}

// Resolves a cookie value to the signed-in user, or undefined when the session is unknown or
// expired. One join keeps this to a single query on the hot path of every API request.
export async function findSessionUser(
  db: Db,
  sessionId: string,
  now = Date.now(),
): Promise<SessionUser | undefined> {
  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);
  return rows[0];
}

// Deletes one session (sign-out).
export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await runBatch(db, [db.delete(sessions).where(eq(sessions.id, sessionId))]);
}

// Deletes every expired session.
// Future: called from a Cron Trigger in the deployment phase, never from inside a request.
export async function deleteExpiredSessions(db: Db, now = Date.now()): Promise<void> {
  await runBatch(db, [db.delete(sessions).where(lt(sessions.expiresAt, now))]);
}
