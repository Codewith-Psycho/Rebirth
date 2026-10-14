import type { PersonalRecords, Tables } from '@/lib/types/database';
import type { RewardValues } from '@/lib/validation/schemas';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Rewards, XP and personal records.
 *
 * XP is *summed from an append-only ledger*, never read from a counter, which
 * is what makes "XP is never removed as punishment" a property of the schema
 * rather than a promise. The check constraint on `xp_events.amount > 0` means
 * there is no way to express a deduction at all.
 */

export type Reward = Tables<'rewards'>;
export type RewardClaim = Tables<'reward_claims'>;
export type XpEvent = Tables<'xp_events'>;
export type Achievement = Tables<'user_achievements'>;

export async function listRewards(db: Db): Promise<Result<Reward[]>> {
  const { data, error } = await db
    .from('rewards')
    .select('*')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your rewards.');
  return ok(data ?? []);
}

export async function createReward(
  db: Db,
  userId: string,
  values: RewardValues,
): Promise<Result<Reward>> {
  const { data, error } = await db
    .from('rewards')
    .insert({
      user_id: userId,
      name: values.name,
      description: emptyToNull(values.description),
      reward_type: values.reward_type,
      condition_kind: values.condition_kind,
      condition_task_id: values.condition_task_id,
      condition_goal_id: values.condition_goal_id,
      condition_milestone_id: values.condition_milestone_id,
      condition_sessions: values.condition_sessions,
      condition_minutes: values.condition_minutes,
      condition_weekly_consistency: values.condition_weekly_consistency,
      xp_value: values.xp_value,
      is_repeatable: values.is_repeatable,
      repeat_period: values.repeat_period,
      is_active: values.is_active,
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That reward was not saved.');
  return ok(data);
}

export async function updateReward(
  db: Db,
  id: string,
  values: Partial<RewardValues>,
): Promise<Result<Reward>> {
  const patch: Record<string, unknown> = {};
  const assign = <K extends keyof RewardValues>(key: K, column: string) => {
    const value = values[key];
    if (value !== undefined) patch[column] = value;
  };

  assign('name', 'name');
  assign('reward_type', 'reward_type');
  assign('condition_kind', 'condition_kind');
  assign('condition_task_id', 'condition_task_id');
  assign('condition_goal_id', 'condition_goal_id');
  assign('condition_milestone_id', 'condition_milestone_id');
  assign('condition_sessions', 'condition_sessions');
  assign('condition_minutes', 'condition_minutes');
  assign('condition_weekly_consistency', 'condition_weekly_consistency');
  assign('xp_value', 'xp_value');
  assign('is_repeatable', 'is_repeatable');
  assign('repeat_period', 'repeat_period');
  assign('is_active', 'is_active');
  if (values.description !== undefined) patch['description'] = emptyToNull(values.description);

  const { data, error } = await db.from('rewards').update(patch).eq('id', id).select('*').single();
  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

export async function deleteReward(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.from('rewards').delete().eq('id', id);
  if (error) return fromPostgrest(error, 'That reward was not deleted.');
  return ok(null);
}

export async function listRewardClaims(db: Db, limit = 100): Promise<Result<RewardClaim[]>> {
  const { data, error } = await db
    .from('reward_claims')
    .select('*')
    .order('claimed_at', { ascending: false })
    .limit(limit);

  if (error) return fromPostgrest(error, 'We could not load your reward history.');
  return ok(data ?? []);
}

/**
 * Claims a reward.
 *
 * The database re-checks the condition before writing, and the unique key on
 * `(reward_id, period_key)` rejects a second claim for the same period. So a
 * stale screen showing "unlocked" cannot turn into a double claim.
 */
export async function claimReward(
  db: Db,
  rewardId: string,
  note: string | null = null,
): Promise<Result<RewardClaim>> {
  const { data, error } = await db.rpc('rpc_claim_reward', {
    p_reward_id: rewardId,
    p_note: note ?? undefined,
  });

  if (error) return fromPostgrest(error, 'That reward was not claimed.');
  if (!data) return fromPostgrest(null, 'That reward was not claimed.');
  return ok(data);
}

/* ── XP ─────────────────────────────────────────────────────────────────── */

/**
 * The ledger, newest first, plus the total.
 *
 * The total is a sum of rows rather than a stored balance so that a display bug
 * can never permanently disagree with the record.
 */
export async function listXpEvents(db: Db, limit = 500): Promise<Result<XpEvent[]>> {
  const { data, error } = await db
    .from('xp_events')
    .select('*')
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) return fromPostgrest(error, 'We could not load your XP history.');
  return ok(data ?? []);
}

export function sumXp(events: XpEvent[]): number {
  return events.reduce((total, event) => total + event.amount, 0);
}

export async function listAchievements(db: Db): Promise<Result<Achievement[]>> {
  const { data, error } = await db
    .from('user_achievements')
    .select('*')
    .order('unlocked_at', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your milestones.');
  return ok(data ?? []);
}

/**
 * Records that an achievement was reached for the first time.
 *
 * Achievements are *derived* from records on every read; this only stores the
 * moment so the first time is not announced again on every visit. It is
 * idempotent, so calling it from a render path is safe.
 */
export async function unlockAchievement(
  db: Db,
  key: string,
  meta: Record<string, unknown> = {},
): Promise<Result<boolean>> {
  const { data, error } = await db.rpc('rpc_unlock_achievement', { p_key: key, p_meta: meta });
  if (error) return fromPostgrest(error, 'That milestone was not recorded.');
  return ok(data === true);
}

/** Personal records: every comparison is against the user's own history only. */
export async function personalRecords(db: Db): Promise<Result<PersonalRecords>> {
  const { data, error } = await db.rpc('rpc_personal_records');
  if (error) return fromPostgrest(error, 'We could not read your records.');
  return ok((data ?? {}) as PersonalRecords);
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
