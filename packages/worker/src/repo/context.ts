// The access context every repository function takes. It is derived from the session by
// resolveAccess and is the only way a workspace id reaches a query, so there is no code path that
// can read or write another workspace's rows even by accident.
export const ROLES = ['owner', 'editor', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

// A resolved identity without a workspace yet: the first request from a brand new user, before
// GET /api/me creates the workspace and seeds it.
export type Identity = {
  userId: string;
  role: Role;
  workspaceId: string | null;
};

// A resolved identity scoped to one workspace. Repository functions take this.
export type Ctx = {
  userId: string;
  workspaceId: string;
  role: Role;
};

// Narrows an identity to a Ctx once a workspace is known.
// Future: for multi-workspace, workspaceId comes from the route segment after checking it against
// the session's memberships; today there is exactly one membership so it is effectively constant.
export function contextFor(identity: Identity, workspaceId: string): Ctx {
  return { userId: identity.userId, workspaceId, role: identity.role };
}
