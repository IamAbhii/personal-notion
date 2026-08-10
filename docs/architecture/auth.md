# Authentication and access (fixed)

- **Provider:** Google Sign-In, server-side **authorization-code flow** with OIDC. The frontend
  never holds a Google token. The backend exchanges the code, verifies the ID token signature,
  issuer, audience and `email_verified`, then issues its own session.
- **Redirect, not popup:** full-page redirect. Popup and One Tap flows are unreliable in an installed
  PWA running in standalone display mode. Carry a signed `state` value through the redirect and
  reject any callback whose `state` does not match.
- **Sessions:** an opaque random session id in a cookie — `httpOnly`, `Secure`, `SameSite=Lax`,
  with a sliding expiry (target: sign in once per device, roughly 30 days of inactivity). Sessions
  are a table in D1; sign-out deletes the row server-side, so a stolen cookie dies with it. Expired
  sessions are swept by a **Cron Trigger** (free on Workers), not by a timer inside a request.
- **Who is allowed in:** one environment variable, `ALLOWED_EMAIL`, holding a single address. Any
  other Google account completes the flow and is then refused with a clear "you do not have access to
  this space" screen, and receives no workspace data at any point.
  The check lives in **one function** — `resolveAccess(email): { userId, workspaceId, role } | null` —
  which is the single place that decides who gets in and with what role. Today it compares against
  `ALLOWED_EMAIL` and returns `role: 'owner'`. Making the app multi-user later means changing this one
  function to read the `workspace_members` table; nothing else moves.
- **Enforcement is server-side and role-aware from the start.** One middleware guards every `/api`
  route: no valid session returns `401`, and a request whose role lacks the needed capability returns
  `403`. Today only `owner` exists and it can do everything, so the `403` path is exercised only by
  tests — but the capability check is real code, not a stub, so adding `editor` and `viewer` later is
  a data change rather than a new enforcement layer.
- **Unauthenticated surfaces** are exactly: the sign-in screen, the OAuth callback, the health
  endpoint, and the static PWA assets. Everything else requires a session.
- **Service worker and privacy:** the app shell is cached; API responses and the sign-in redirect
  never are. Sign-out clears the session server-side and drops the service worker caches, so a
  shared or lost device cannot show the previous person's workspace.
- **Dev-only bypass:** `AUTH_DISABLED=true` runs the app with no sign-in as a fixed synthetic owner.
  The server **refuses to start** if this is set while `NODE_ENV=production`. In production the server
  also refuses to start unless `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`,
  `PUBLIC_ORIGIN` and `ALLOWED_EMAIL` are present — fail closed, never fail open.
- **Secrets:** all of the above live in `.env`, never committed and unreadable to the agents. Ship a
  committed `.env.example`, and document in README.md how to create the Google Cloud OAuth client and
  which redirect URI to register.
- **Tests:** unit-test the middleware, `resolveAccess`, the capability check (including a `403` for a
  synthetic viewer role) and the session lifecycle against a stubbed token verifier. End-to-end tests
  run with the bypass by default; a dedicated spec runs the real flow against a local fake OIDC issuer,
  covering sign-in, refusal of a non-allowlisted account, and sign-out — so the suite needs no internet.
