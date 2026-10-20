import { describe, expect, it } from 'vitest';

import {
  type RecoveryContext,
  type RecoveryErrorLike,
  type RecoveryProblem,
  type RecoveryStep,
  hasCompleteAccount,
  readRecoveryProblem,
  recoveryDiagnostic,
  viewerStateFor,
} from '@/lib/viewer-recovery';

/**
 * The recovery path's vocabulary.
 *
 * None of this needs a database, and that is the point: the shell's decision
 * about a viewer, and the reason a failed repair is described calmly rather
 * than quoted verbatim, are both rules that can be held in place here even
 * though the SQL that raises the codes cannot be exercised from a unit test.
 */

const STEPS: RecoveryStep[] = ['ensure_user', 'load_profile', 'load_preferences'];

/** The problem for a failing step, with the null case treated as a test bug. */
function problem(step: RecoveryStep, error: RecoveryErrorLike): RecoveryProblem {
  const found = readRecoveryProblem(step, error);
  if (!found) throw new Error(`expected ${step} to report a problem`);
  return found;
}

describe('hasCompleteAccount', () => {
  it('is false for a signed-out visitor, so a shell can never treat one as ready', () => {
    expect(hasCompleteAccount(null)).toBe(false);
  });

  it('is true only once both rows are present', () => {
    expect(hasCompleteAccount({ profile: { id: 'u1' }, preferences: { user_id: 'u1' } })).toBe(true);
  });

  it('is false when the profile row is missing', () => {
    expect(hasCompleteAccount({ profile: null, preferences: { user_id: 'u1' } })).toBe(false);
  });

  it('is false when the preferences row is missing', () => {
    expect(hasCompleteAccount({ profile: { id: 'u1' }, preferences: null })).toBe(false);
  });

  it('is false when neither row is there', () => {
    expect(hasCompleteAccount({ profile: null, preferences: null })).toBe(false);
  });

  it('counts a row that exists but is empty as present', () => {
    // Presence is the test, not content. An all-defaults row is still a row,
    // and substituting a made-up one is the thing this screen exists to avoid.
    expect(hasCompleteAccount({ profile: {}, preferences: {} })).toBe(true);
  });
});

describe('viewerStateFor', () => {
  it('keeps a signed-out visitor apart from an incomplete account', () => {
    // The layout sends one to the sign-in page and shows the other a recovery
    // screen, so the two must never collapse into each other.
    expect(viewerStateFor(null)).toBe('no-session');
    expect(viewerStateFor({ profile: null, preferences: null })).toBe('incomplete');
  });

  it('agrees with hasCompleteAccount on every combination it can be given', () => {
    const contexts: RecoveryContext[] = [
      { profile: { id: 'u1' }, preferences: { user_id: 'u1' } },
      { profile: {}, preferences: {} },
      { profile: null, preferences: { user_id: 'u1' } },
      { profile: { id: 'u1' }, preferences: null },
      { profile: null, preferences: null },
    ];

    for (const context of contexts) {
      expect(viewerStateFor(context)).toBe(hasCompleteAccount(context) ? 'ready' : 'incomplete');
    }
  });
});

describe('readRecoveryProblem', () => {
  it('says nothing at all when a step worked', () => {
    for (const step of STEPS) {
      expect(readRecoveryProblem(step, null)).toBeNull();
    }
  });

  it('keeps the step and the short code', () => {
    const found = problem('ensure_user', { code: 'PGRST202' });
    expect(found.step).toBe('ensure_user');
    expect(found.code).toBe('PGRST202');
  });

  it('explains a missing repair function in plain words', () => {
    expect(problem('ensure_user', { code: 'PGRST202' }).message).toContain('migration');
  });

  it('does not describe a refusal as if the function were missing', () => {
    const missing = problem('ensure_user', { code: 'PGRST202' }).message;
    const refused = problem('ensure_user', { code: '42501' }).message;
    expect(refused).not.toBe(missing);
    expect(refused).toContain('refused');
  });

  it('explains the refusal the database raises for an unauthenticated call', () => {
    // `rpc_ensure_user()` raises `not_authenticated` (P0001) when `auth.uid()`
    // is null. Reaching it means the session did not survive to the function,
    // which is a session problem — not a missing row.
    expect(problem('ensure_user', { code: 'P0001' }).message).toContain('session');
  });

  it('falls back to the step sentence for an unfamiliar code', () => {
    const found = problem('load_profile', { code: 'XX999' });
    expect(found.code).toBe('XX999');
    expect(found.message.length).toBeGreaterThan(0);
    expect(found.message).not.toContain('XX999');
  });

  it('treats a missing code as no code rather than an empty string', () => {
    const found = problem('load_preferences', {});
    expect(found.code).toBeNull();
    expect(found.message.length).toBeGreaterThan(0);
  });
});

describe('recoveryDiagnostic', () => {
  it('shows nothing when every step worked', () => {
    expect(recoveryDiagnostic([])).toBeNull();
  });

  it('shows the sentence together with its short code', () => {
    expect(recoveryDiagnostic([problem('ensure_user', { code: 'PGRST202' })])).toContain(
      '(PGRST202)',
    );
  });

  it('leads with the repair failure when the read-back failed too', () => {
    // The order the shell builds these in is the contract: a failed repair step
    // is the root cause, so it is the line the screen carries.
    const problems: RecoveryProblem[] = [
      { step: 'ensure_user', code: 'PGRST202', message: 'The repair did not run.' },
      { step: 'load_profile', code: '42501', message: 'The read was refused.' },
    ];
    expect(recoveryDiagnostic(problems)).toContain('The repair did not run.');
  });

  it('adds no empty parentheses when a problem has no code', () => {
    const problems: RecoveryProblem[] = [
      { step: 'load_profile', code: null, message: 'The read was refused.' },
    ];
    expect(recoveryDiagnostic(problems)).toBe('The read was refused.');
  });
});

describe('what reaches the screen', () => {
  it('ignores raw database text even when it is handed some', () => {
    // A real `PostgrestError` also carries `message` and `details`. This stands
    // in for one, to prove the sentence shown comes from this module and not
    // from the database. A regression that began echoing the message would
    // surface the address below.
    const postgrestLike = {
      code: '42501',
      message: 'permission denied for table profiles (user someone@example.com)',
      details: 'select * from public.profiles where id = ...',
    };

    const found = problem('load_profile', postgrestLike);
    expect(found.message).not.toContain('example.com');
    expect(found.message).not.toContain('select');
    expect(JSON.stringify(found)).not.toContain('example.com');
  });
});
