'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database';
import { requireSupabaseEnv } from './env';

export type RebirthClient = SupabaseClient<Database>;

let browserClient: RebirthClient | null = null;

/**
 * The single browser client for the whole app.
 *
 * A module-level singleton matters here: creating several `createBrowserClient`
 * instances produces several GoTrue instances, which fight over the auth
 * cookies and can produce spurious sign-outs.
 */
export function getSupabaseBrowserClient(): RebirthClient {
  if (browserClient) return browserClient;
  const { url, anonKey } = requireSupabaseEnv();
  browserClient = createBrowserClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
    realtime: {
      params: { eventsPerSecond: 5 },
    },
  });
  return browserClient;
}
