// The Worker's bindings and configuration, plus the fail-closed check that runs before the app
// serves anything.

export type Env = {
  DB: D1Database;
  ASSETS?: Fetcher;
  NODE_ENV?: string;
  // Dev-only bypass: runs the app as a fixed synthetic owner with no sign-in.
  AUTH_DISABLED?: string;
  ALLOWED_EMAIL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
};

// Secrets and settings that must be present in production. Missing any of them is a startup
// failure, never a silent fallback to an insecure default.
const REQUIRED_IN_PRODUCTION = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'PUBLIC_ORIGIN',
  'ALLOWED_EMAIL',
] as const;

// True when the dev-only sign-in bypass is on.
export function isAuthDisabled(env: Env): boolean {
  return env.AUTH_DISABLED === 'true';
}

// True when the Worker is running as production.
export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

// Validates configuration and returns the reasons it is unusable, empty when the config is fine.
// Fail closed: in production the auth bypass is forbidden outright and every secret must be set.
export function configErrors(env: Env): string[] {
  const errors: string[] = [];
  if (!isProduction(env)) return errors;
  if (isAuthDisabled(env)) {
    errors.push('AUTH_DISABLED must not be set in production');
  }
  for (const key of REQUIRED_IN_PRODUCTION) {
    if (!env[key]) errors.push(`${key} is required in production`);
  }
  return errors;
}
