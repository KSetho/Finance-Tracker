/**
 * Drizzle over Neon's WebSocket Pool: unlike the HTTP driver it supports interactive transactions
 * and SELECT ... FOR UPDATE, which the services rely on (same semantics as the SQLAlchemy session).
 */
import { neonConfig, Pool } from '@neondatabase/serverless';
import { drizzle, type NeonDatabase } from 'drizzle-orm/neon-serverless';
import ws from 'ws';

import { getSettings } from '../config';
import * as schema from './schema';

neonConfig.webSocketConstructor = ws;

export type Database = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pooled database or an open transaction. */
export type Executor = Database | Tx;

let instance: Database | undefined;

/** Accept provider-style and SQLAlchemy-style URLs (postgresql+psycopg://...). */
function connectionString(url: string): string {
  return url.replace(/^postgres(?:ql)?\+\w+:\/\//, 'postgresql://');
}

export function getDb(): Database {
  if (!instance) {
    const pool = new Pool({ connectionString: connectionString(getSettings().databaseUrl) });
    instance = drizzle(pool, { schema });
  }
  return instance;
}

/** Postgres integrity-constraint violations (SQLSTATE class 23), however drizzle wraps them. */
export function isIntegrityError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && code.startsWith('23')) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
