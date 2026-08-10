// Tests for the access seam itself: resolveAccess, the capability table and the production config
// guard, independent of any route.
import { describe, expect, it } from 'vitest';
import { requiredCapability, roleHasCapability } from '../src/auth/capabilities';
import { DEV_OWNER, resolveAccess } from '../src/auth/resolveAccess';
import { configErrors, type Env } from '../src/env';
import { createUser, createWorkspaceForUser } from '../src/repo/accounts';
import { createAccount, OWNER_EMAIL, testDb } from './helpers';

const baseEnv = { ALLOWED_EMAIL: OWNER_EMAIL } as unknown as Env;

describe('resolveAccess', () => {
  it('refuses an address that is not the allowed one', async () => {
    const db = testDb();
    expect(await resolveAccess({ db, env: baseEnv }, { email: 'stranger@example.com' })).toBeNull();
  });

  it('creates the user row on first sign-in and leaves the workspace unset', async () => {
    const db = testDb();
    const identity = await resolveAccess({ db, env: baseEnv }, { email: OWNER_EMAIL });
    expect(identity).toMatchObject({ workspaceId: null, role: 'owner' });

    // A second call finds the same user rather than creating another.
    const again = await resolveAccess({ db, env: baseEnv }, { email: OWNER_EMAIL });
    expect(again?.userId).toBe(identity?.userId);
  });

  it('returns the role from the membership row, not a hardcoded owner', async () => {
    const viewer = await createAccount({ email: OWNER_EMAIL, role: 'viewer' });
    const identity = await resolveAccess({ db: viewer.db, env: baseEnv }, { email: OWNER_EMAIL });
    expect(identity).toMatchObject({ workspaceId: viewer.workspaceId, role: 'viewer' });
  });

  it('matches the allowed address case-insensitively', async () => {
    const db = testDb();
    const identity = await resolveAccess(
      { db, env: baseEnv },
      { email: OWNER_EMAIL.toUpperCase() },
    );
    expect(identity).not.toBeNull();
  });

  it('admits the synthetic owner when AUTH_DISABLED is on and no address is configured', async () => {
    const db = testDb();
    const env = { AUTH_DISABLED: 'true' } as unknown as Env;
    expect(await resolveAccess({ db, env }, DEV_OWNER)).not.toBeNull();
    expect(await resolveAccess({ db, env }, { email: 'someone@else.com' })).toBeNull();
  });

  it('picks up an existing membership so a returning user lands in their workspace', async () => {
    const db = testDb();
    const user = await createUser(db, { email: OWNER_EMAIL, name: 'Owner' });
    const membership = await createWorkspaceForUser(db, user.id, 'My Space');
    const identity = await resolveAccess({ db, env: baseEnv }, { email: OWNER_EMAIL });
    expect(identity).toEqual({
      userId: user.id,
      workspaceId: membership.workspaceId,
      role: 'owner',
    });
  });
});

describe('capabilities', () => {
  it('gives owner and editor writes, viewer reads only', () => {
    expect(roleHasCapability('owner', 'workspace.write')).toBe(true);
    expect(roleHasCapability('editor', 'workspace.write')).toBe(true);
    expect(roleHasCapability('viewer', 'workspace.read')).toBe(true);
    expect(roleHasCapability('viewer', 'workspace.write')).toBe(false);
  });

  it('maps reads to workspace.read and everything else to workspace.write', () => {
    expect(requiredCapability('GET')).toBe('workspace.read');
    expect(requiredCapability('HEAD')).toBe('workspace.read');
    expect(requiredCapability('POST')).toBe('workspace.write');
    expect(requiredCapability('DELETE')).toBe('workspace.write');
  });
});

describe('configuration guard', () => {
  it('accepts any configuration outside production', () => {
    expect(configErrors({ AUTH_DISABLED: 'true' } as unknown as Env)).toEqual([]);
  });

  it('refuses the auth bypass in production', () => {
    const errors = configErrors({
      NODE_ENV: 'production',
      AUTH_DISABLED: 'true',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'session',
      PUBLIC_ORIGIN: 'https://space.test',
      ALLOWED_EMAIL: OWNER_EMAIL,
    } as unknown as Env);
    expect(errors).toEqual(['AUTH_DISABLED must not be set in production']);
  });

  it('refuses production without the required secrets', () => {
    const errors = configErrors({ NODE_ENV: 'production' } as unknown as Env);
    expect(errors).toEqual([
      'GOOGLE_CLIENT_ID is required in production',
      'GOOGLE_CLIENT_SECRET is required in production',
      'SESSION_SECRET is required in production',
      'PUBLIC_ORIGIN is required in production',
      'ALLOWED_EMAIL is required in production',
    ]);
  });
});
