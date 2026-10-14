/**
 * Shared auth types and helpers.
 *
 * Kept out of `actions.ts` on purpose: a `'use server'` module may only export
 * async functions, so the state shape and the redirect guard live here where
 * both the server actions and the client forms can import them.
 */

export interface AuthState {
  status: 'idle' | 'error' | 'sent' | 'success';
  message?: string;
  /** Field name → message, for inline display. */
  fieldErrors?: Record<string, string>;
}

export const IDLE_AUTH_STATE: AuthState = { status: 'idle' };

/**
 * Only same-site, absolute-path targets are honoured.
 *
 * A `next` parameter is attacker-controllable, so `//host` and `/\host` — both
 * of which a browser reads as protocol-relative — are rejected along with
 * anything carrying its own scheme.
 */
export function safeRedirectTarget(value: FormDataEntryValue | null, fallback = '/today'): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (trimmed.includes('://')) return fallback;
  return trimmed;
}
