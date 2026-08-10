// Identity and tenancy data access: users, workspaces and memberships. Separate from pages because
// these rows are not workspace-scoped content - they are what decides which workspace a request may
// see in the first place.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { runBatch } from '../db/batch';
import { users, workspaces, workspaceMembers } from '../db/schema';
import { newId } from '../lib/ids';
import type { Role } from './context';

export type User = { id: string; email: string; name: string };
export type Membership = { workspaceId: string; name: string; role: Role };

// Looks a user up by email address. Email is the key today because that is what Google returns and
// what ALLOWED_EMAIL compares against.
// Future: match on google_sub instead, so a user who changes their Google email keeps their rows.
export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0];
}

// Looks a user up by id, for the /api/me response.
export async function findUserById(db: Db, id: string): Promise<User | undefined> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0];
}

// Creates the user row for a freshly signed-in identity.
export async function createUser(
  db: Db,
  input: { email: string; name: string; googleSub?: string },
): Promise<User> {
  const row = {
    id: newId(),
    googleSub: input.googleSub ?? null,
    email: input.email,
    name: input.name,
    createdAt: Date.now(),
  };
  await runBatch(db, [db.insert(users).values(row)]);
  return { id: row.id, email: row.email, name: row.name };
}

// Every workspace this user belongs to, with the role they hold in each. The API returns this as an
// array today holding one element; nothing may treat that as an invariant.
export async function listMemberships(db: Db, userId: string): Promise<Membership[]> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
  return rows.map((row) => ({ ...row, role: row.role as Role }));
}

// The role this user holds in one workspace, or undefined when they are not a member. This is the
// membership check behind every workspace-scoped route.
export async function findMembershipRole(
  db: Db,
  userId: string,
  workspaceId: string,
): Promise<Role | undefined> {
  const rows = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  return rows[0]?.role as Role | undefined;
}

// Creates a workspace and the caller's membership in it as one atomic batch, so a workspace can
// never exist with nobody able to reach it.
export async function createWorkspaceForUser(
  db: Db,
  userId: string,
  name: string,
  role: Role = 'owner',
): Promise<Membership> {
  const now = Date.now();
  const workspace = { id: newId(), name, createdAt: now };
  await runBatch(db, [
    db.insert(workspaces).values(workspace),
    db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role,
      createdAt: now,
    }),
  ]);
  return { workspaceId: workspace.id, name: workspace.name, role };
}
