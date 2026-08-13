// Route-level tests: authentication, the capability check, workspace scoping, /api/me's
// create-and-seed behaviour, and the snapshot ETag.
import { describe, expect, it } from 'vitest';
import { createUser } from '../src/repo/accounts';
import { createPage } from '../src/repo/pages';
import { createSession } from '../src/repo/sessions';
import { apiFetch, createAccount, OWNER_EMAIL, testDb } from './helpers';

describe('GET /api/health', () => {
  it('is unauthenticated', async () => {
    const response = await apiFetch('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('authentication and capabilities', () => {
  it('returns 401 without a session', async () => {
    const response = await apiFetch('/api/me');
    expect(response.status).toBe(401);
  });

  it('returns 401 for an unknown session cookie', async () => {
    const response = await apiFetch('/api/me', { sessionId: 'not-a-session' });
    expect(response.status).toBe(401);
  });

  it('returns 403 for a signed-in account that is not the allowed address', async () => {
    const stranger = await createAccount({ email: 'stranger@example.com' });
    const response = await apiFetch('/api/me', { sessionId: stranger.sessionId });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'account_not_allowed' });
  });

  it('lets a viewer read but returns 403 when it tries to write', async () => {
    const viewer = await createAccount({ email: OWNER_EMAIL, role: 'viewer' });

    const read = await apiFetch(`/api/workspaces/${viewer.workspaceId}/snapshot`, {
      sessionId: viewer.sessionId,
    });
    expect(read.status).toBe(200);

    const write = await apiFetch(`/api/workspaces/${viewer.workspaceId}/sync`, {
      method: 'POST',
      sessionId: viewer.sessionId,
      body: JSON.stringify({ ops: [] }),
    });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: 'forbidden' });
  });
});

describe('GET /api/me', () => {
  it('returns the user and their memberships', async () => {
    const owner = await createAccount({ workspaceName: 'My Space' });
    const response = await apiFetch('/api/me', { sessionId: owner.sessionId });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: { id: owner.userId, email: OWNER_EMAIL, name: 'Test Owner' },
      memberships: [{ workspaceId: owner.workspaceId, name: 'My Space', role: 'owner' }],
    });
  });

  it('creates and seeds a workspace on first call for a user without one', async () => {
    // A user row with no workspace: exactly the state after a first sign-in.
    const db = testDb();
    const user = await createUser(db, { email: OWNER_EMAIL, name: 'New Owner' });
    const sessionId = await createSession(db, user.id);

    const response = await apiFetch('/api/me', { sessionId });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      memberships: { workspaceId: string; role: string }[];
    };
    expect(body.memberships).toHaveLength(1);
    const workspaceId = body.memberships[0]!.workspaceId;

    const snapshot = await apiFetch(`/api/workspaces/${workspaceId}/snapshot`, { sessionId });
    const payload = (await snapshot.json()) as {
      pages: { title: string; icon: string | null; parentId: string | null }[];
    };
    expect(payload.pages.length).toBeGreaterThan(10);
    // Row pages are accessed from the table view and have no icon; all other seeded pages do.
    const nonRowPages = payload.pages.filter((page) => (page as { kind?: string }).kind !== 'row');
    expect(nonRowPages.every((page) => page.icon !== null && page.icon !== '')).toBe(true);
    // The seeded tree is nested, not a flat list.
    expect(payload.pages.some((page) => page.parentId !== null)).toBe(true);

    // Calling /api/me again neither creates a second workspace nor re-seeds the first.
    const second = await apiFetch('/api/me', { sessionId });
    const secondBody = (await second.json()) as { memberships: unknown[] };
    expect(secondBody.memberships).toHaveLength(1);
    const reread = await apiFetch(`/api/workspaces/${workspaceId}/snapshot`, { sessionId });
    const rereadPayload = (await reread.json()) as { pages: unknown[] };
    expect(rereadPayload.pages).toHaveLength(payload.pages.length);
  });
});

describe('GET /api/workspaces/:workspaceId/snapshot', () => {
  it('returns 404 for a workspace the session is not a member of', async () => {
    const owner = await createAccount();
    const other = await createAccount({ email: 'other@example.com' });

    const response = await apiFetch(`/api/workspaces/${other.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
    });
    expect(response.status).toBe(404);
  });

  it('returns 404 rather than 403 for a workspace id that does not exist', async () => {
    const owner = await createAccount();
    const response = await apiFetch(`/api/workspaces/${crypto.randomUUID()}/snapshot`, {
      sessionId: owner.sessionId,
    });
    expect(response.status).toBe(404);
  });

  it('returns the page tree with a strong ETag and answers 304 to a matching If-None-Match', async () => {
    const owner = await createAccount();
    const page = await createPage(owner.db, owner.ctx, { title: 'Journal', icon: '📓' });

    const first = await apiFetch(`/api/workspaces/${owner.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
    });
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    expect(etag?.startsWith('W/')).toBe(false);
    expect(await first.json()).toEqual({
      workspaceId: owner.workspaceId,
      pages: [
        {
          id: page.id,
          parentId: null,
          title: 'Journal',
          icon: '📓',
          sortKey: page.sortKey,
          kind: 'page',
          version: 1,
          updatedAt: page.updatedAt,
        },
      ],
      // The blocks, properties and values keys are always present, empty when nothing exists yet.
      blocks: [],
      properties: [],
      values: [],
    });

    const cached = await apiFetch(`/api/workspaces/${owner.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
      headers: { 'If-None-Match': etag! },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');

    // A write moves the ETag, so the client stops being served a stale 304.
    await createPage(owner.db, owner.ctx, { title: 'Recipes', icon: '🍜' });
    const after = await apiFetch(`/api/workspaces/${owner.workspaceId}/snapshot`, {
      sessionId: owner.sessionId,
      headers: { 'If-None-Match': etag! },
    });
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
  });
});
