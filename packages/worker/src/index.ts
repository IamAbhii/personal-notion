// The Worker entry point: one Hono app serving the API and, through the static-assets binding, the
// built PWA, so the whole product is one origin.
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAccess } from './auth/middleware';
import { configErrors, type Env } from './env';
import { createDb } from './db/client';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { isTestResetEnabled, testResetRoutes } from './routes/testReset';
import { workspaceRoutes } from './routes/workspaces';
import { deleteExpiredSessions } from './repo/sessions';
import type { AppEnv } from './types';

// Builds the app for a given environment. This is a function rather than a module-level constant
// because which routes exist depends on the environment - the test reset route is registered only
// under the dev bypass - and bindings are only available once a request arrives.
function createApp(env: Env): Hono<AppEnv> {
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

  // OAuth endpoints: registered before requireAccess because they are unauthenticated surfaces.
  // GET /api/auth/google starts the flow, GET /api/auth/callback handles Google's redirect,
  // POST /api/auth/signout ends the session.
  app.route('/api/auth', authRoutes);

  // One middleware over every other /api route: 401 without a session, 403 when the role lacks the
  // capability the request needs.
  app.use('/api/*', requireAccess);

  // The end-to-end suite's workspace reset, and nothing else, is conditional: with the bypass off the
  // route is never registered, so the path 404s from the API catch-all below like any other typo.
  if (isTestResetEnabled(env)) app.route('/api', testResetRoutes);

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

  // One handler for every unexpected throw, so no route can answer with Hono's default plain-text
  // "Internal Server Error": clients parse JSON, and a bare 500 tells them (and the log) nothing. The
  // message is deliberately generic - the detail goes to the log, not to the caller.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error(
      'Unhandled error',
      JSON.stringify({
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
    return c.json({ error: 'internal_error', message: 'Something went wrong on the server.' }, 500);
  });

  return app;
}

// The app is built once per isolate and reused, keyed on the one setting that changes its shape, so
// a request pays no route-registration cost.
let cached: { app: Hono<AppEnv>; testReset: boolean } | undefined;

function appFor(env: Env): Hono<AppEnv> {
  const testReset = isTestResetEnabled(env);
  if (!cached || cached.testReset !== testReset) {
    cached = { app: createApp(env), testReset };
  }
  return cached.app;
}

export default {
  fetch(request, env, ctx) {
    return appFor(env).fetch(request, env, ctx);
  },
  // Cron Trigger: sweeps expired sessions once a day (configured in wrangler.jsonc).
  // Running this outside of request handling means the sessions table stays small without
  // touching the hot path.
  async scheduled(_event, env) {
    const db = createDb(env.DB);
    await deleteExpiredSessions(db);
  },
} satisfies ExportedHandler<Env>;
