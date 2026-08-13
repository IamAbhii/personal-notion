// The Worker entry point: one Hono app serving the API and, through the static-assets binding, the
// built PWA, so the whole product is one origin.
import { Hono } from 'hono';
import { requireAccess } from './auth/middleware';
import { configErrors, type Env } from './env';
import { meRoutes } from './routes/me';
import { workspaceRoutes } from './routes/workspaces';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Fail closed on bad configuration. Workers has no startup hook, so "refuses to start" means every
// request is refused with 503 and the reasons logged, rather than the app running with the auth
// bypass on in production or with a missing session secret.
app.use('*', async (c, next) => {
  const errors = configErrors(c.env);
  if (errors.length > 0) {
    console.error('Refusing to serve: invalid configuration:', errors.join('; '));
    return c.json({ error: 'misconfigured', message: 'The server is not configured.' }, 503);
  }
  await next();
});

// GET /api/health - liveness for deploys and uptime checks. Registered before the auth middleware
// because it is one of the deliberately unauthenticated surfaces.
app.get('/api/health', (c) => c.json({ status: 'ok', time: Date.now() }));

// One middleware over every other /api route: 401 without a session, 403 when the role lacks the
// capability the request needs.
app.use('/api/*', requireAccess);

// Future: the Google OAuth redirect and callback handlers (GET /auth/google, GET /auth/google/callback
// and POST /auth/signout) are added in the deployment phase behind this same seam - they exchange the
// code, verify the ID token, call resolveAccess and create a session row. Nothing else moves: the
// middleware, resolveAccess and the capability table are already the enforcement path.

app.route('/api', meRoutes);
app.route('/api', workspaceRoutes);

// Unknown API paths are JSON 404s, never the SPA shell, so a mistyped fetch fails loudly.
app.all('/api/*', (c) => c.json({ error: 'not_found', message: 'No such endpoint.' }, 404));

// Everything else is the PWA. Static assets normally never reach the Worker (the assets binding
// serves them first); this fallback exists for the case where they do, and for `wrangler dev`
// running the Worker ahead of the asset router.
app.all('*', async (c) => {
  if (!c.env.ASSETS) return c.text('Not found', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app satisfies ExportedHandler<Env>;
