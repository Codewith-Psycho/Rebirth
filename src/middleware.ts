import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * Session refresh and route protection.
 *
 * Kept to a two-line delegation on purpose: the logic lives next to the
 * Supabase integration it depends on, and this file only wires it into Next.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Auth cookies have
     * to be refreshed on real navigations, so the exclusions are kept tight.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2)$).*)',
  ],
};
