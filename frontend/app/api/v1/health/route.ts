import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '../../../../lib/db/client';

export const dynamic = 'force-dynamic';

/** Liveness plus a database round-trip. Deliberately reveals nothing else. */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`SELECT 1`);
  } catch {
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
  return NextResponse.json({ status: 'ok' });
}
