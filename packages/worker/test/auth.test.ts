// Unit tests for the three OAuth routes: start login, callback, and sign-out.
// The Google token exchange and ID token verification steps are replaced by fakes so no network
// calls are made and no real Google credentials are needed.
import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { createAuthRoutes, type ExchangeCodeForProfile } from '../src/routes/auth';
import type { AppEnv } from '../src/types';
import { createDb } from '../src/db/client';
import { createSession, findSessionUser, SESSION_COOKIE } from '../src/repo/sessions';
import { createUser } from '../src/repo/accounts';
import { OWNER_EMAIL, ORIGIN } from './helpers';

// Wraps an auth sub-router in a full Hono app mounted at /api/auth, so direct app.fetch() calls
// receive a URL that matches the sub-router's route registrations.
function wrapAuthRoutes(exchangeCodeForProfile: ExchangeCodeForProfile) {
  const app = new Hono<AppEnv>();
  app.route('/api/auth', createAuthRoutes(exchangeCodeForProfile));
  return app;
}

// A fake code exchanger that resolves to the allowed owner by default, with no network calls.
function fakeExchanger(
  overrides: Partial<{ email: string; name: string; sub: string; email_verified: boolean }> = {},
): ExchangeCodeForProfile {
  return async () => ({
    email: OWNER_EMAIL,
    name: 'Test Owner',
    sub: 'google-sub-123',
    email_verified: true,
    ...overrides,
  });
}

// Makes a request to the app mounted at the test SELF worker. The routes under test are mounted at
// /api/auth; callers pass the relative path segment.
function authFetch(
  path: string,
  options: RequestInit & { cookies?: Record<string, string> } = {},
): Promise<Response> {
  const { cookies, headers: rawHeaders, ...rest } = options;
  const headers = new Headers(rawHeaders);
  if (cookies && Object.keys(cookies).length > 0) {
    headers.set(
      'Cookie',
      Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  }
  return SELF.fetch(`${ORIGIN}/api/auth${path}`, { ...rest, headers, redirect: 'manual' });
}

// Extracts a named cookie value from a Set-Cookie response header list.
function getCookieFromResponse(response: Response, name: string): string | undefined {
  const all = response.headers.getSetCookie();
  for (const header of all) {
    const pair = header.split(';')[0];
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const cookieName = pair.slice(0, eqIdx).trim();
    const cookieValue = pair.slice(eqIdx + 1).trim();
    if (cookieName === name) return cookieValue;
  }
  return undefined;
}

describe('GET /api/auth/google', () => {
  it('redirects to Google with state and sets the state cookie', async () => {
    const res = await authFetch('/google');
    expect(res.status).toBe(302);
    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(location).toContain('response_type=code');
    // The state param is present in the URL.
    const url = new URL(location);
    expect(url.searchParams.get('state')).toBeTruthy();
    // A state cookie is set.
    const stateCookie = getCookieFromResponse(res, 'ps_oauth_state');
    expect(stateCookie).toBeTruthy();
    // Cookie and URL state must match.
    expect(url.searchParams.get('state')).toBe(stateCookie);
  });
});

describe('GET /api/auth/callback', () => {
  // --- failure paths: all must be 302 redirects with no session cookie set ---

  it('redirects to /?auth_error=expired when the state cookie is missing', async () => {
    const res = await authFetch('/callback?state=some-state&code=abc');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=expired');
    // No session cookie must be created on this path.
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=expired when state param does not match the state cookie', async () => {
    const res = await authFetch('/callback?state=wrong&code=abc', {
      cookies: { ps_oauth_state: 'correct' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=expired');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=denied when error param is present', async () => {
    const nonce = 'test-nonce-denied';
    const res = await authFetch(`/callback?state=${nonce}&error=access_denied`, {
      cookies: { ps_oauth_state: nonce },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=denied');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=no_code when no code param is present', async () => {
    const nonce = 'test-nonce-no-code';
    const res = await authFetch(`/callback?state=${nonce}`, {
      cookies: { ps_oauth_state: nonce },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=no_code');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=provider_error when exchangeCodeForProfile throws', async () => {
    const throwingExchanger: ExchangeCodeForProfile = async () => {
      throw new Error('upstream token endpoint returned 400');
    };
    const app = wrapAuthRoutes(throwingExchanger);

    const nonce = 'test-nonce-provider-error';
    const req = new Request(`${ORIGIN}/api/auth/callback?state=${nonce}&code=xyz`, {
      headers: { Cookie: `ps_oauth_state=${nonce}` },
      redirect: 'manual',
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=provider_error');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=email_unverified when email_verified is false', async () => {
    const unverifiedExchanger = fakeExchanger({ email_verified: false });
    const app = wrapAuthRoutes(unverifiedExchanger);

    const nonce = 'test-nonce-email-unverified';
    const req = new Request(`${ORIGIN}/api/auth/callback?state=${nonce}&code=xyz`, {
      headers: { Cookie: `ps_oauth_state=${nonce}` },
      redirect: 'manual',
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=email_unverified');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('redirects to /?auth_error=not_allowed when resolveAccess returns null', async () => {
    // Returns a different email that is not in the allow-list.
    const notAllowedVerifier = fakeExchanger({ email: 'stranger@example.com' });
    const app = wrapAuthRoutes(notAllowedVerifier);

    const nonce = 'test-nonce-not-allowed';
    const req = new Request(`${ORIGIN}/api/auth/callback?state=${nonce}&code=xyz`, {
      headers: { Cookie: `ps_oauth_state=${nonce}` },
      redirect: 'manual',
    });

    // Mount against the env from cloudflare:test so the D1 binding and config are real.
    const res = await app.fetch(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/?auth_error=not_allowed');
    const sessionCookie = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionCookie).toBeUndefined();
  });

  it('creates a session and sets the session cookie on success', async () => {
    const verifier = fakeExchanger();
    const app = wrapAuthRoutes(verifier);

    const nonce = 'test-nonce-success';
    const req = new Request(`${ORIGIN}/api/auth/callback?state=${nonce}&code=xyz`, {
      headers: { Cookie: `ps_oauth_state=${nonce}` },
      redirect: 'manual',
    });

    const res = await app.fetch(req, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');

    // The session cookie must be present and non-empty.
    const sessionId = getCookieFromResponse(res, SESSION_COOKIE);
    expect(sessionId).toBeTruthy();

    // The session row exists in D1.
    const db = createDb(env.DB);
    const session = await findSessionUser(db, sessionId!);
    expect(session).toBeDefined();
    expect(session?.email).toBe(OWNER_EMAIL);

    // The OAuth state cookie must be cleared.
    const stateCookie = res.headers.getSetCookie().find((h) => h.startsWith('ps_oauth_state='));
    expect(stateCookie).toContain('Max-Age=0');
  });
});

describe('POST /api/auth/signout', () => {
  it('deletes the session row and clears the session cookie', async () => {
    const db = createDb(env.DB);
    const user = await createUser(db, { email: OWNER_EMAIL, name: 'Owner' });
    const sessionId = await createSession(db, user.id);

    const res = await authFetch('/signout', {
      method: 'POST',
      cookies: { [SESSION_COOKIE]: sessionId },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // Session row is gone.
    const session = await findSessionUser(db, sessionId);
    expect(session).toBeUndefined();

    // Cookie is cleared.
    const cookieHeader = res.headers.getSetCookie().find((h) => h.startsWith(`${SESSION_COOKIE}=`));
    expect(cookieHeader).toContain('Max-Age=0');
  });

  it('returns ok even when no session cookie is present', async () => {
    const res = await authFetch('/signout', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});
