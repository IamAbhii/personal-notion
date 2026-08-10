// The one place the D1 binding is turned into a database handle. Nothing above the repository layer
// sees `env.DB` or any other Workers global, so moving off Cloudflare (to Node + SQLite, or Turso)
// means replacing this file and the repository modules, and nothing else.
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Db = ReturnType<typeof createDb>;

// Wraps a D1 binding in Drizzle. Called once per request by the API middleware.
export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}
