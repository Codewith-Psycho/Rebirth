import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from '@/lib/types/database';
import { type RecoveryProblem, readRecoveryProblem } from '@/lib/viewer-recovery';
import { getSupabaseEnv } from './env';

export type ServerSupabaseClient = SupabaseClient<Database>;

/**
 * Request-scoped Supabase client for Server Components, Server Actions and
 * Route Handlers.
 *
 * Returns `null` when the environment is not configured, so pages can render a
 * setup screen instead of throwing an opaque error. Callers that genuinely
 * require a client use `requireServerClient`.
 */
export async function getServerClient(): Promise<ServerSupabaseClient | null> {
  const env = getSupabaseEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is
          // read-only. The middleware refreshes the session instead, so this
          // is safe to ignore — it is the documented @supabase/ssr pattern.
        }
      },
    },
  });
}

export async function requireServerClient(): Promise<ServerSupabaseClient> {
  const client = await getServerClient();
  if (!client) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  return client;
}

/** The signed-in user, or `null`. Never throws on a missing session. */
export async function getCurrentUser() {
  const client = await getServerClient();
  if (!client) return null;
  const {
    data: { user },
  } = await client.auth.getUser();
  return user;
}

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Preferences = Database['public']['Tables']['user_preferences']['Row'];

export interface ViewerContext {
  userId: string;
  email: string | null;
  profile: Profile | null;
  preferences: Preferences | null;
  /**
   * Empty when the self-healing path did everything it was asked to. A missing
   * row on its own is not a problem — only a step that failed is.
   */
  recovery: RecoveryProblem[];
}

/**
 * Everything the app shell needs about the viewer in one round trip.
 * `rpc_ensure_user` repairs accounts that predate the sign-up trigger, so this
 * is also the self-healing path for a missing profile or preferences row.
 *
 * That repair and both read-backs report their failures rather than discarding
 * them: the difference between "the row is not there" and "the read was
 * refused" is the difference between waiting and fixing something, and the
 * shell cannot tell the user which it is if this function throws the evidence
 * away.
 */
export async function getViewerContext(): Promise<ViewerContext | null> {
  const client = await getServerClient();
  if (!client) return null;

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  // The repair runs first, so a missing row is created before it is read back.
  const { error: ensureError } = await client.rpc('rpc_ensure_user');

  const [profileRead, preferencesRead] = await Promise.all([
    client.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    client.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle(),
  ]);

  const recovery = [
    readRecoveryProblem('ensure_user', ensureError),
    readRecoveryProblem('load_profile', profileRead.error),
    readRecoveryProblem('load_preferences', preferencesRead.error),
  ].filter((problem): problem is RecoveryProblem => problem !== null);

  if (recovery.length > 0) {
    // The step and its short code, and nothing else: no user id, no raw
    // Postgres text. A `maybeSingle()` that matched no row is not a failure —
    // it reports `error: null` and never reaches this branch.
    console.error(
      '[viewer] account recovery did not finish',
      recovery.map(({ step, code }) => ({ step, code })),
    );
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: profileRead.data ?? null,
    preferences: preferencesRead.data ?? null,
    recovery,
  };
}
