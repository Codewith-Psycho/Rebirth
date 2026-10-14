/**
 * Supabase environment configuration.
 *
 * REBIRTH is a real client of a real database. There is no localStorage
 * fallback and no mock backend: if the environment is not configured, the app
 * says so plainly and tells you exactly which file to edit, rather than
 * silently pretending to save your data.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
  siteUrl: string;
}

function readUrl(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) return null;
  // A project URL is always https://<ref>.supabase.co — reject obvious mistakes
  // early, because a wrong URL produces confusing runtime errors later.
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      return null;
    }
    return value.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function readAnonKey(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return value && value.length > 20 ? value : null;
}

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = readUrl();
  const anonKey = readAnonKey();
  if (!url || !anonKey) return null;
  return {
    url,
    anonKey,
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, ''),
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export class SupabaseConfigError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Copy .env.example to .env.local and set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your Supabase project settings.',
    );
    this.name = 'SupabaseConfigError';
  }
}

export function requireSupabaseEnv(): SupabaseEnv {
  const env = getSupabaseEnv();
  if (!env) throw new SupabaseConfigError();
  return env;
}

/** Human-readable list of what is still missing, for the setup screen. */
export function missingEnvKeys(): string[] {
  const missing: string[] = [];
  if (!readUrl()) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!readAnonKey()) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}
