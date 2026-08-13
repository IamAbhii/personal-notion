// The single place that decides who gets in and with what role.
import type { Db } from '../db/client';
import { isAuthDisabled, type Env } from '../env';
import { createUser, findUserByEmail, listMemberships } from '../repo/accounts';
import type { Identity } from '../repo/context';

// The synthetic owner used when AUTH_DISABLED=true, so local development and end-to-end tests need
// no Google credentials.
export const DEV_OWNER = {
  email: 'dev@personal.space',
  name: 'Local Owner',
  googleSub: 'dev-owner',
};

export type SignedInProfile = {
  email: string;
  name?: string;
  googleSub?: string;
};

// The one address allowed in. With the dev bypass on and no ALLOWED_EMAIL configured, the synthetic
// owner's address is the allowed one.
function allowedEmail(env: Env): string | null {
  if (env.ALLOWED_EMAIL) return env.ALLOWED_EMAIL;
  return isAuthDisabled(env) ? DEV_OWNER.email : null;
}

// Decides whether an authenticated email may use this space, and with which identity and role.
// Returns null for anyone who is not allowed - they receive no workspace data at any point.
// The user row is created here on first sign-in; the workspace is not, so workspaceId is null until
// GET /api/me creates and seeds it.
// Future: to support many users, drop the ALLOWED_EMAIL comparison and let membership in
// workspace_members alone decide access; nothing outside this function changes.
export async function resolveAccess(
  deps: { db: Db; env: Env },
  profile: SignedInProfile,
): Promise<Identity | null> {
  const allowed = allowedEmail(deps.env);
  if (!allowed || profile.email.toLowerCase() !== allowed.toLowerCase()) return null;

  const user =
    (await findUserByEmail(deps.db, profile.email)) ??
    (await createUser(deps.db, {
      email: profile.email,
      name: profile.name ?? profile.email,
      googleSub: profile.googleSub,
    }));

  // Today a user has at most one membership, so the first one is "their workspace". The role comes
  // from the membership row rather than being hardcoded, which is what makes editor and viewer a
  // data change later.
  // Future: for multi-workspace, resolve the workspace from the route segment and check it against
  // this list instead of taking the first element.
  const memberships = await listMemberships(deps.db, user.id);
  const first = memberships[0];
  return {
    userId: user.id,
    workspaceId: first?.workspaceId ?? null,
    role: first?.role ?? 'owner',
  };
}
