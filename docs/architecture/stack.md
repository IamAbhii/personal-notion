# Stack (fixed)

- **Frontend:** React + TypeScript, built with Vite, using the **TanStack** stack:
  - TanStack Router for navigation, TanStack Query for server state, TanStack Table for the
    database table view, and TanStack Form where a form is warranted. Use TanStack pieces where
    they fit; do not force them where a plain component is simpler.
- **Progressive Web App:** the frontend is an installable PWA — a web app manifest, icons, and a
  service worker (via `vite-plugin-pwa` or equivalent) so it installs and launches from a phone or
  desktop home screen. It works offline for both reading and **editing**, with a durable local write
  queue that syncs when the network returns — see [Offline and sync](./offline-sync.md). HTTPS is required for the
  service worker, so every deployment serves over HTTPS.
- **Backend:** **TypeScript on Cloudflare Workers**, with **Hono** as the router (small, Workers-native,
  well supported). The same Worker serves the API and the built PWA static assets via the Workers
  static-assets binding, so the whole app is one origin. There is no Node server, no process to
  supervise and no OS to patch.
- **Storage:** **Cloudflare D1** — SQLite, managed. Access it through **Drizzle ORM** over the D1
  binding. D1's constraints are real and shape the design; they are listed in [D1 constraints](./d1-constraints.md).
- **Authentication:** **Google Sign-In (OAuth 2.0 / OpenID Connect)** implemented **in the app**, not
  at the edge, so it is portable and testable. Details in [Authentication and access](./auth.md).
- **Testing:** frontend unit tests in Vitest; backend unit tests in Vitest via
  **`@cloudflare/vitest-pool-workers`**, so handlers run in the real `workerd` runtime against a local
  D1 rather than against a mock. End-to-end tests with **Playwright** under `e2e/`, driving
  `wrangler dev`.
