import type { Json, Tables } from '@/lib/types/database';
import type { PreferencesValues, ProfileValues } from '@/lib/validation/schemas';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Settings.
 *
 * Every preference here does something real. `daily_task_cap` is read by the
 * database trigger that enforces the day's limit; `timezone` is what the whole
 * app uses to decide which local day an instant belongs to; `quiet_hours_*` is
 * what suppresses nudges. None of them are decorative.
 */

export type Preferences = Tables<'user_preferences'>;
export type Profile = Tables<'profiles'>;

export async function getPreferences(db: Db, userId: string): Promise<Result<Preferences | null>> {
  const { data, error } = await db
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return fromPostgrest(error, 'We could not load your settings.');
  return ok(data ?? null);
}

export async function updatePreferences(
  db: Db,
  userId: string,
  values: Partial<PreferencesValues>,
): Promise<Result<Preferences>> {
  const patch: Record<string, unknown> = {};
  // Null-checked rather than truthy-checked: `false` and `0` are real settings.
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (key === 'pre_focus_checklist' || key === 'quote_tones') {
      patch[key] = value as Json;
    } else {
      patch[key] = value;
    }
  }

  const { data, error } = await db
    .from('user_preferences')
    .update(patch)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'Those settings were not saved.');
  return ok(data);
}

export async function updateProfile(
  db: Db,
  userId: string,
  values: ProfileValues,
): Promise<Result<Profile>> {
  const { data, error } = await db
    .from('profiles')
    .update({ display_name: values.display_name, timezone: values.timezone })
    .eq('id', userId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'Your profile was not saved.');
  return ok(data);
}

export async function completeOnboarding(db: Db, userId: string): Promise<Result<null>> {
  const { error } = await db
    .from('user_preferences')
    .update({ onboarding_completed: true })
    .eq('user_id', userId);

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(null);
}

/* ── Derived settings helpers ───────────────────────────────────────────── */

/** The three check-in prompts, in the order the day meets them. */
export const ENERGY_SLOTS = ['morning', 'afternoon', 'evening'] as const;

/**
 * Whether the app should stay quiet right now.
 *
 * Quiet hours are allowed to wrap past midnight (22:00 → 07:00 is the default),
 * which a naive `start <= now && now <= end` comparison gets wrong.
 */
export function withinQuietHours(preferences: Preferences, minutesNow: number): boolean {
  const start = timeToMinutes(preferences.quiet_hours_start);
  const end = timeToMinutes(preferences.quiet_hours_end);
  if (start === end) return false;
  if (start < end) return minutesNow >= start && minutesNow < end;
  return minutesNow >= start || minutesNow < end;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours ?? 0) * 60 + Number(minutes ?? 0);
}

/** The owner-editable pre-focus checklist, defensively coerced to strings. */
export function readChecklist(preferences: Preferences): string[] {
  const raw = preferences.pre_focus_checklist;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

export function readEnergyTags(preferences: Preferences): string[] {
  const raw = preferences.energy_tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}

export function readQuoteTones(preferences: Preferences): string[] {
  return preferences.quote_tones ?? [];
}
