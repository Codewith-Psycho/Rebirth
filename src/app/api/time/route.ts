import { NextResponse } from 'next/server';

/**
 * The server's current instant.
 *
 * Used to correct the device clock so a focus timer reports the same elapsed
 * time as the database. Deliberately unauthenticated and trivial: it exposes
 * nothing but the time, and routing it through the session would make the
 * correction fail exactly when a session is in a bad state.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { now: new Date().toISOString() },
    { headers: { 'cache-control': 'no-store' } },
  );
}
