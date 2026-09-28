// Google OAuth authorization-code flow: start login, handle the callback, and sign out.
// The state cookie (double-submit cookie pattern) ties the callback to the originating browser,
// preventing CSRF on the callback endpoint.
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { createDb } from '../db/client';
import { resolveAccess } from '../auth/resolveAccess';
import { createSession, deleteSession, SESSION_COOKIE, SESSION_TTL_MS } from '../repo/sessions';
import type { AppEnv } from '../types';

const OAUTH_STATE_COOKIE = 'ps_oauth_state';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUER = 'https://accounts.google.com';

// The remote JWK set is module-level so it is initialised once per isolate and its cache is reused
// across requests, rather than re-fetched every callback.
const GOOGLE_JWKS = createRemoteJWKSet(new URL(GOOGLE_CERTS_URL));

export type GoogleProfile = { email: string; name: string; sub: string; email_verified: boolean };

// Combines the token exchange and ID token verification into one injectable step so tests can stub
// both without making any network calls.
export type ExchangeCodeForProfile = (
  code: string,
  opts: { clientId: string; clientSecret: string; redirectUri: string },
) => Promise<GoogleProfile>;

// Default implementation: exchanges the code with Google and verifies the resulting ID token.
async function defaultExchangeCodeForProfile(
  code: string,
  opts: { clientId: string; clientSecret: string; redirectUri: string },
): Promise<GoogleProfile> {
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    console.error('Token exchange failed', await tokenResponse.text());
    throw new Error('token_exchange_failed');
  }

  const tokens = (await tokenResponse.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error('no_id_token');

  const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
    issuer: GOOGLE_ISSUER,
    audience: opts.clientId,
  });
  return {
    email: payload['email'] as string,
    name: (payload['name'] as string) ?? '',
    sub: payload['sub'] as string,
    email_verified: payload['email_verified'] as boolean,
  };
}

// Builds the auth router. Accepts an optional exchangeCodeForProfile so tests can stub the network
// calls without real Google credentials.
export function createAuthRoutes(
  exchangeCodeForProfile: ExchangeCodeForProfile = defaultExchangeCodeForProfile,
) {
  const app = new Hono<AppEnv>();

  // GET /api/auth/google — starts the OAuth flow.
  // Generates a random nonce, stores it in a short-lived cookie, then redirects to Google's consent
  // screen. The state parameter travels through Google and comes back on the callback so the server
  // can confirm it is still the same browser.
  app.get('/google', (c) => {
    const nonce = crypto.randomUUID();
    setCookie(c, OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 300,
      path: '/',
    });

    const params = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: `${c.env.PUBLIC_ORIGIN}/api/auth/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state: nonce,
      access_type: 'offline',
      prompt: 'select_account',
    });

    return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
  });

  // GET /api/auth/callback — Google redirects here after the user approves or denies.
  // Validates the state cookie (CSRF check), exchanges the code for tokens, verifies the ID token
  // signature and claims, checks email_verified, calls resolveAccess to enforce the allow-list, then
  // creates a session and sets the session cookie.
  app.get('/callback', async (c) => {
    const stateParam = c.req.query('state');
    const stateCookie = getCookie(c, OAUTH_STATE_COOKIE);

    // Double-submit CSRF check: both halves must be present and identical.
    if (!stateParam || !stateCookie || stateParam !== stateCookie) {
      return c.json({ error: 'invalid_state', message: 'OAuth state mismatch.' }, 400);
    }

    // User denied the request on Google's consent screen.
    const errorParam = c.req.query('error');
    if (errorParam) {
      clearStateCookie(c);
      return c.redirect('/?auth_error=denied', 302);
    }

    const code = c.req.query('code');
    if (!code) {
      return c.json({ error: 'missing_code', message: 'No authorization code received.' }, 400);
    }

    // Exchange the code and verify the ID token in one step.
    let profile: GoogleProfile;
    try {
      profile = await exchangeCodeForProfile(code, {
        clientId: c.env.GOOGLE_CLIENT_ID ?? '',
        clientSecret: c.env.GOOGLE_CLIENT_SECRET ?? '',
        redirectUri: `${c.env.PUBLIC_ORIGIN}/api/auth/callback`,
      });
    } catch (err) {
      console.error(
        'Token exchange or verification failed',
        err instanceof Error ? err.message : String(err),
      );
      return c.json(
        { error: 'token_exchange_failed', message: 'Failed to complete sign-in.' },
        502,
      );
    }

    if (!profile.email_verified) {
      clearStateCookie(c);
      return c.redirect('/?auth_error=not_allowed', 302);
    }

    const db = createDb(c.env.DB);
    const identity = await resolveAccess(
      { db, env: c.env },
      { email: profile.email, name: profile.name, googleSub: profile.sub },
    );

    if (!identity) {
      clearStateCookie(c);
      return c.redirect('/?auth_error=not_allowed', 302);
    }

    const sessionId = await createSession(db, identity.userId);

    // Session cookie: httpOnly, Secure, SameSite=Lax, 30-day expiry.
    setCookie(c, SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      path: '/',
    });

    clearStateCookie(c);
    return c.redirect('/', 302);
  });

  // POST /api/auth/signout — deletes the session row server-side so the cookie stops working even if
  // it is stolen. Returns JSON; the frontend handles the redirect so the service worker can clear
  // its caches before the page unloads.
  app.post('/signout', async (c) => {
    const sessionId = getCookie(c, SESSION_COOKIE);
    if (sessionId) {
      const db = createDb(c.env.DB);
      await deleteSession(db, sessionId);
    }
    setCookie(c, SESSION_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0,
      path: '/',
    });
    return c.json({ ok: true });
  });

  return app;
}

// Clears the OAuth state cookie by setting Max-Age=0.
function clearStateCookie(c: Parameters<typeof setCookie>[0]) {
  setCookie(c, OAUTH_STATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 0,
    path: '/',
  });
}

// The default export uses the real Google verifier. Tests use createAuthRoutes directly with a fake.
export const authRoutes = createAuthRoutes();
