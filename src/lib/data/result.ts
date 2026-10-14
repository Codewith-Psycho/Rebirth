import type { PostgrestError } from '@supabase/supabase-js';
import { explainDatabaseError } from '@/lib/domain/limits';

/**
 * Every database call in REBIRTH returns a `Result`.
 *
 * The point is that a failure has to be *looked at* before the data can be
 * used. There is no path where a failed write silently becomes a success
 * toast: `errorMessage()` is non-null exactly when the write did not happen.
 */

export interface Failure {
  ok: false;
  /** Calm, human copy — never a raw Postgres string. */
  error: string;
  /** Raw Postgres hint, kept for logging and for the "replace it?" flows. */
  hint: string | null;
  code: string | null;
}

export interface Success<T> {
  ok: true;
  data: T;
}

export type Result<T> = Success<T> | Failure;

export function ok<T>(data: T): Success<T> {
  return { ok: true, data };
}

export function fail(error: string, hint: string | null = null, code: string | null = null): Failure {
  return { ok: false, error, hint, code };
}

export function errorMessage(result: Result<unknown>): string | null {
  return result.ok ? null : result.error;
}

/**
 * Turns a PostgrestError into a `Failure` with human copy.
 *
 * `explainDatabaseError` recognises the hints our own RPCs raise (the daily cap,
 * a second timer, a duplicate reward claim) and returns the calm sentence for
 * each. Anything unrecognised keeps the fallback rather than leaking SQL.
 */
export function fromPostgrest(
  error: PostgrestError | null,
  fallback: string,
): Failure {
  if (!error) return fail(fallback);
  const explained = explainDatabaseError(error.message ?? '', error.hint ?? null);
  return fail(explained, error.hint ?? null, error.code ?? null);
}

/** PostgREST's "no rows" code, which is a normal outcome for `.single()`. */
export const NO_ROWS = 'PGRST116';

/** A thrown (rather than returned) error, e.g. from a JS-level failure. */
export function fromThrown(error: unknown, fallback: string): Failure {
  if (error instanceof Error) {
    return fail(explainDatabaseError(error.message, null), null, null);
  }
  return fail(fallback);
}

/** Unwraps a `Result`, throwing the message. For server-side call sites only. */
export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(result.error);
}
