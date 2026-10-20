/**
 * The vocabulary of the missing-profile recovery path.
 *
 * Two things are decided here, and neither needs a database to decide them:
 * whether a viewer is signed out, incomplete or ready, and how a failed
 * recovery step should be described.
 *
 * A `RecoveryProblem` deliberately carries only the step, the database's short
 * code and a sentence written in this file. The raw Postgres message is not
 * even accepted as input, so it has no route into a log line or a page: the
 * code is the diagnostic, and the sentence is the explanation.
 */

export type RecoveryStep = 'ensure_user' | 'load_profile' | 'load_preferences';

/**
 * The part of a `PostgrestError` this module reads. Structural on purpose —
 * it keeps the module free of runtime imports so it can be unit-tested without
 * a database, a client or credentials.
 */
export interface RecoveryErrorLike {
  code?: string | null;
}

export interface RecoveryProblem {
  step: RecoveryStep;
  /** Postgres/PostgREST code, e.g. `PGRST202`. Safe to log and to show. */
  code: string | null;
  /** Calm copy for the screen — never a raw database string. */
  message: string;
}

const STEP_COPY: Record<RecoveryStep, string> = {
  ensure_user: 'The automatic repair of your starting details did not run.',
  load_profile: 'Your starting details could not be read back.',
  load_preferences: 'Your settings could not be read back.',
};

/**
 * Codes worth explaining precisely. The sentence depends on the step as well as
 * the code, because `P0001` means "not authenticated" when the repair raises it
 * and something else entirely if it ever surfaced from a read.
 *
 * Anything unlisted falls back to the step's sentence, so an unfamiliar code
 * still reads calmly instead of as a bare number.
 */
const CODE_COPY: Record<RecoveryStep, Record<string, string>> = {
  ensure_user: {
    PGRST202:
      'The repair function is missing from the database, so the latest migration has not been applied.',
    '42501': 'The database refused the repair call.',
    P0001: 'The database did not accept this session, so the repair could not run.',
  },
  load_profile: {
    '42501': 'The database refused to read your starting details.',
  },
  load_preferences: {
    '42501': 'The database refused to read your settings.',
  },
};

/**
 * Reads a step's outcome. `null` in means the step worked — including a
 * `maybeSingle()` that matched no row, which reports `error: null` — so the
 * normal path produces no diagnostic at all.
 */
export function readRecoveryProblem(
  step: RecoveryStep,
  error: RecoveryErrorLike | null,
): RecoveryProblem | null {
  if (!error) return null;

  const code = error.code ?? null;
  const explained = code === null ? undefined : CODE_COPY[step]?.[code];

  return { step, code, message: explained ?? STEP_COPY[step] };
}

/**
 * One sentence for the recovery screen: the first problem, with its short code.
 *
 * Order is the caller's responsibility and meaningful — the repair step is
 * reported before the read-backs, because when it fails it is almost always
 * the reason the reads found nothing to report.
 */
export function recoveryDiagnostic(problems: RecoveryProblem[]): string | null {
  const first = problems[0];
  if (!first) return null;

  return first.code === null ? first.message : `${first.message} (${first.code})`;
}

export type ViewerState = 'no-session' | 'incomplete' | 'ready';

/** The rows the shell needs before it can render anything: present or not. */
export interface RecoveryContext {
  profile: object | null;
  preferences: object | null;
}

/**
 * Whether an account is complete enough to render.
 *
 * Presence is the test, not emptiness: a row that exists is a row, and a screen
 * must not invent a name or a timezone to stand in for one that is missing.
 *
 * A signed-out visitor is `false` as well — there is no session to be ready
 * about — so no caller can mistake one for a complete account. It is written as
 * a type predicate so the shell can narrow the rows it is about to hand to the
 * client without a non-null assertion.
 */
export function hasCompleteAccount<T extends RecoveryContext>(
  context: T | null,
): context is T & {
  profile: NonNullable<T['profile']>;
  preferences: NonNullable<T['preferences']>;
} {
  return context !== null && context.profile !== null && context.preferences !== null;
}

/** The same rule as a three-way name, for callers that only need to report it. */
export function viewerStateFor(context: RecoveryContext | null): ViewerState {
  if (context === null) return 'no-session';
  return hasCompleteAccount(context) ? 'ready' : 'incomplete';
}
