# 11 — Auth and authorization

> [docs/AUTH_FLOW.md](../AUTH_FLOW.md) is the operational reference: where every key lives, how to
> configure it from scratch, the known wrinkles, and where the implementation differs from the
> architecture doc. Read it when you need to _set this up_. Read this page to understand the code.
>
> Decision record: [`docs/architecture/auth.md`](../architecture/auth.md).

## The model in five sentences

Google Sign-In, server-side **authorization-code flow** with OIDC. The frontend **never holds a
Google token** — the backend exchanges the code, verifies the ID token, and issues **its own opaque
session**. Exactly one email address is allowed in, decided by one function. Every `/api` route
behind one middleware: no session → `401`, wrong role → `403`. Authorization is role- and
capability-based from the start even though only `owner` exists today.

## The files

```
src/routes/auth.ts        the OAuth endpoints: /google, /callback, /signout
src/auth/middleware.ts    requireAccess (every /api route) and requireWorkspace (workspace routes)
src/auth/resolveAccess.ts the single place that decides who gets in and with what role
src/auth/capabilities.ts  the role → capability table
src/repo/sessions.ts      session rows, lookup, delete, expiry sweep
src/repo/accounts.ts      users, workspaces, memberships
src/env.ts                the fail-closed configuration check
```

## The sign-in flow

### `GET /api/auth/google`

1. Mints a random `nonce` (`crypto.randomUUID()`).
2. Sets it in a short-lived cookie: `ps_oauth_state`, `httpOnly`, `Secure`, `SameSite=Lax`,
   `maxAge: 300`.
3. Redirects (302) to Google's consent screen with
   `client_id`, `redirect_uri = ${PUBLIC_ORIGIN}/api/auth/callback`, `response_type=code`,
   `scope=openid email profile`, `state=<nonce>`, `access_type=offline`, `prompt=select_account`.

**Redirect, not popup.** Popup and One Tap flows are unreliable in an installed PWA running in
standalone display mode.

### `GET /api/auth/callback`

In order, and each step has its own redirect on failure:

1. **Double-submit CSRF check** — `state` query param must be present and equal the
   `ps_oauth_state` cookie. A genuine CSRF attempt and an expired state cookie are
   indistinguishable here, and both correctly produce `expired` with no session created. A warning
   is logged, because the response is a 302 and would otherwise be invisible in Workers metrics.
2. **`error` param** → the user denied on Google's consent screen.
3. **No `code`** → should not happen in a normal flow.
4. **Exchange + verify, as one injectable step.** The default implementation POSTs to Google's token
   endpoint, then `jwtVerify`s the `id_token` against Google's JWKS with `issuer` and `audience`
   checked. The JWK set is created at **module level** so it is initialised once per isolate and its
   cache is reused across requests, rather than re-fetched on every callback.
5. **`email_verified`** must be true.
6. **`resolveAccess`** — the allow-list check. Returns `null` for anyone not allowed.
7. **`createSession`** and set the session cookie.
8. Redirect to `/`.

Every failure redirects to `/?auth_error=<code>` rather than returning an error status, because the
user is mid-navigation in a browser. The frontend reads that param, shows a sentence, and strips it
from the URL.

| `auth_error`       | Cause                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `expired`          | State cookie missing or mismatched: timed out, back button, another tab, or CSRF             |
| `denied`           | Cancelled on Google's consent screen                                                         |
| `no_code`          | Google returned no authorization code                                                        |
| `provider_error`   | Token exchange or ID-token verification failed — usually misconfiguration or a Google outage |
| `email_unverified` | Google account email not verified                                                            |
| `not_allowed`      | Authenticated, but not the allow-listed address                                              |

The mapping to user-facing copy is `authErrorMessages` in
`packages/frontend/src/screens/SignInScreen/SignInScreen.tsx`, with a fallback for unknown codes.
**Add a code on the server and you must add it there too.**

### `POST /api/auth/signout`

Deletes the session **row**, then clears the cookie with `maxAge: 0`. Returns JSON rather than a
redirect, so the frontend controls the navigation. `WorkspaceShell.handleSignOut` then does
`window.location.href = '/'` — a **full page reload**, so all in-memory state is cleared. With no
valid session, `/` hits the `401` path and `StatusScreens.AppError` renders `SignInScreen`.

## Sessions

`src/repo/sessions.ts`:

```ts
export const SESSION_COOKIE = 'ps_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
```

- The cookie value is an **opaque, high-entropy random token** (32 bytes of
  `crypto.getRandomValues`, hex-encoded) — random rather than derived from anything about the user,
  because sessions are looked up by this value.
- Cookie flags: `httpOnly`, `Secure`, `SameSite=Lax`, `path=/`.
- **Sessions are rows in D1, not signed cookies.** Sign-out (and a future "sign out everywhere")
  deletes them server-side, so a stolen cookie stops working. A signed stateless cookie could not be
  revoked.
- `findSessionUser` is **one join** (`sessions` × `users`) with the expiry check in the `WHERE`, so
  the hot path of every API request is a single query.
- Expired sessions are swept by the **Cron Trigger** (`0 3 * * *`), not by a timer inside a request.

## `resolveAccess` — the one decision point

`src/auth/resolveAccess.ts`. This function exists so that "who is allowed in" is a single place.

```ts
export async function resolveAccess(
  deps: { db: Db; env: Env },
  profile: SignedInProfile,
): Promise<Identity | null>;
```

1. Compare the email (case-insensitively) against `ALLOWED_EMAIL`. Not a match → `null`, and the
   caller receives **no workspace data at any point**.
2. Find the user by email, or **create the row here on first sign-in**.
3. List their memberships and return `{ userId, workspaceId, role }`.

Two details:

- **`workspaceId` is `null` until `GET /api/me` creates and seeds the workspace.** The user row is
  created here; the workspace is not. That is why `Identity.workspaceId` is `string | null` and
  `Ctx.workspaceId` is not.
- **The role comes from the membership row, not from a hardcoded string.** That is what makes
  `editor` and `viewer` a _data_ change later rather than new code.

```ts
// Future: to support many users, drop the ALLOWED_EMAIL comparison and let membership in
// workspace_members alone decide access; nothing outside this function changes.
```

That comment is the acceptance test for the design. See [13](./13-tenancy-and-multi-user.md).

## `requireAccess` — authentication and authorization in one middleware

`src/auth/middleware.ts`, mounted as `app.use('/api/*', requireAccess)`. **There is no route-level
opt-out**; the unauthenticated surfaces are mounted above it in `index.ts`.

```
create the Db handle and put it in c.var.db
  ↓
resolve a profile: DEV_OWNER if AUTH_DISABLED, else session cookie → findSessionUser
  ↓  no profile → 401 unauthorized
resolveAccess(profile)
  ↓  null → 403 account_not_allowed
requiredCapability(method) → roleHasCapability(identity.role, capability)
  ↓  false → 403 forbidden
c.set('identity', identity); next()
```

`401` means _no usable session_. `403` means _a known caller whose account or role is not
permitted_. Keep that distinction when adding anything.

## `requireWorkspace` — the tenancy check

Mounted on `/workspaces/:workspaceId/*`. It looks up `findMembershipRole(userId, workspaceId)` and:

- **Not a member → `404`, not `403`.** Deliberate: a `403` would confirm that a workspace id
  exists, so ids could be probed. Do not "fix" this to a 403.
- Builds the `Ctx` using **the role for _this_ workspace**, not the one `resolveAccess` happened to
  pick first — which matters the moment there is more than one membership.

## Capabilities

`src/auth/capabilities.ts`:

```ts
export const CAPABILITIES = ['workspace.read', 'workspace.write'] as const;

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ['workspace.read', 'workspace.write'],
  editor: ['workspace.read', 'workspace.write'],
  viewer: ['workspace.read'],
};

export function requiredCapability(method: string): Capability {
  return method === 'GET' || method === 'HEAD' ? 'workspace.read' : 'workspace.write';
}
```

- **`editor` and `viewer` already exist in the table** even though no data assigns them. The
  capability check is **real code, not a stub**, so adding a role later is a different string in
  `workspace_members` and not a new enforcement layer. The `403` path is exercised today only by a
  unit test using a synthetic viewer — keep that test.
- The method→capability rule is one line because `/sync` is the only write path in the product.
  A `// Future:` marker notes that per-page capabilities for sharing would resolve from the target
  row instead.

## The dev bypass

```
AUTH_DISABLED=true
```

Runs the app as a fixed synthetic owner — `dev@personal.space`, `Local Owner`, `googleSub:
'dev-owner'` (`DEV_OWNER` in `resolveAccess.ts`) — with no sign-in and no cookie. It is how the
suites run with no Google credentials and no internet.

Its guardrails, which are the interesting part:

1. **`configErrors()` refuses to serve** (`503` on every request) if `AUTH_DISABLED` is set while
   `NODE_ENV=production`. Workers has no startup hook, so "refuses to start" means every request is
   refused, with the reasons logged.
2. **`wrangler.jsonc` sets `NODE_ENV=production`** as a var, so deployed Workers are _always_ in
   production mode and local dev overrides it downward via `.dev.vars`. The safe direction.
3. **`allowedEmail()` falls back to `DEV_OWNER.email`** only when the bypass is on and no
   `ALLOWED_EMAIL` is configured.
4. **The test-reset route is registered only under the bypass**, so with it off there is no code
   path from a production request to the reset logic at all
   ([09](./09-backend-architecture.md)).

## Configuration and secrets

| Where                       | What                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/worker/.dev.vars` | Local secrets. Gitignored. `.dev.vars.example` is committed.                                      |
| `wrangler secret put`       | Production secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_EMAIL` |
| `wrangler.jsonc` `vars`     | Non-secret defaults only: `NODE_ENV`. Committed.                                                  |
| repo-root `.env`            | The **agent build** and `wrangler deploy` — _not_ application runtime config                      |

Required in production, all five, or the Worker refuses to serve: `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_ORIGIN`, `ALLOWED_EMAIL`.

`PUBLIC_ORIGIN` is read, never hardcoded, because moving hostnames means re-registering the Google
OAuth redirect URI.

Setting up the Google OAuth client from scratch: [docs/AUTH_FLOW.md](../AUTH_FLOW.md) and
[`docs/architecture/deployment.md`](../architecture/deployment.md). The short version: a Web
application client with redirect URI `https://<worker>.workers.dev/api/auth/callback`, consent
screen kept in Testing mode with your own account as the only test user. The app issues its own
session and never stores a Google refresh token, so the 7-day refresh-token expiry for unverified
apps is irrelevant here.

## The service-worker interaction you must not break

Both legs of the OAuth round trip (`/api/auth/google` and `/api/auth/callback`) are top-level
**document** navigations to `/api/*`. Workbox's `navigateFallback` would answer them from the
precache and the Cloudflare Worker would never see the request — sign-in silently breaks. Hence:

```ts
navigateFallbackDenylist: [/^\/api\//];
```

in `packages/frontend/vite.config.ts`. Do not remove it. See [03](./03-frontend-architecture.md).

## Testing auth

- `createAuthRoutes(exchangeCodeForProfile)` takes the exchange-and-verify step as a parameter, so
  unit tests stub it and make **no network calls**. Copy this pattern for any external service.
- Unit-test the middleware, `resolveAccess`, the capability check (including a `403` for a
  synthetic viewer) and the session lifecycle.
- E2E runs with the bypass by default. The decision record calls for a dedicated spec running the
  real flow against a local fake OIDC issuer, so the suite needs no internet.

## Known gaps

Tracked in [12 — Security](./12-security.md), summarised here so you do not go looking:

- There is **no rate limiting** in front of the sign-in and callback routes yet.
- **`SESSION_SECRET` is required but unused.** `env.ts` lists it among the production requirements,
  so the Worker `503`s without it, yet nothing in `src/` reads it. It is a leftover from a design
  where the session was a signed cookie. Sessions are 256-bit random tokens looked up in D1, so
  there is nothing to sign — dead configuration, not a security gap.
- **The OAuth `state` is an unsigned nonce in an `httpOnly` cookie**, where
  [`docs/architecture/auth.md`](../architecture/auth.md) calls for a _signed_ value. The property
  that matters — a callback cannot be forged without the browser's own cookie — is the same.
- **The session expiry is fixed, not sliding.** `expiresAt` is set at sign-in and never extended, so
  an active user is signed out 30 days after signing in rather than after 30 days of inactivity.
  Making it sliding means refreshing `expiresAt` in `findSessionUser`.

[docs/AUTH_FLOW.md](../AUTH_FLOW.md) has the full list, including the `PUBLIC_ORIGIN` and
client-id/secret pitfalls that produce misleading failure symptoms.

## Next

- [12 — Security](./12-security.md)
- [13 — Tenancy and multi-user](./13-tenancy-and-multi-user.md)
