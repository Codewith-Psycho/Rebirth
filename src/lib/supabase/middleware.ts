import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseEnv } from './env';

/** Routes that require a session. */
export const PROTECTED_PREFIXES = [
  '/today',
  '/schedule',
  '/calendar',
  '/insights',
  '/goals',
  '/rewards',
  '/settings',
] as const;

/** Routes that a signed-in user should be redirected away from. */
export const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

/**
 * Refreshes the Supabase session cookie on every request and enforces route
 * protection.
 *
 * Two things are deliberate here:
 *
 *   · The response object is created once and cookies are written *onto it*.
 *     Creating a fresh `NextResponse.next()` inside the cookie callback loses
 *     the refreshed cookies and produces intermittent sign-outs.
 *   · `getUser()` is used rather than `getSession()`. `getSession()` reads the
 *     cookie without validating it, so it is not a safe basis for an
 *     authorisation decision. The middleware is a convenience redirect; the
 *     real guarantee is Row Level Security, which applies to every query
 *     regardless of what the middleware decided.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const env = getSupabaseEnv();
  if (!env) {
    // Unconfigured deployments still render the setup guidance rather than
    // bouncing every visitor to a login page that cannot work.
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && isProtectedPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/today';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
