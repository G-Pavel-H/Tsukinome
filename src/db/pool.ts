import { Pool } from 'pg';

/**
 * Create a Postgres connection pool. SSL is driven by the connection string's
 * `sslmode` (so Neon's `?sslmode=require` works), while a plain local URL — as
 * used by the CI service container — connects without SSL.
 */
export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}
