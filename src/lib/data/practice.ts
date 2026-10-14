import type { DayKey } from '@/lib/domain/time';
import type { Tables } from '@/lib/types/database';
import type { EnergyValues, ReflectionValues } from '@/lib/validation/schemas';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Daily practice: energy check-ins and the end-of-day reflection.
 *
 * Both are *for* the user and never used against them. Nothing here gates a
 * task, a streak or a reward, and both can be filled in after the fact — the
 * reflection in particular is explicitly "never a lock-out", so a missed day can
 * always be written up later.
 */

export type EnergyLog = Tables<'daily_energy_logs'>;
export type Reflection = Tables<'daily_reflections'>;

export async function listEnergyLogs(
  db: Db,
  from: DayKey,
  to: DayKey,
): Promise<Result<EnergyLog[]>> {
  const { data, error } = await db
    .from('daily_energy_logs')
    .select('*')
    .gte('log_date', from)
    .lte('log_date', to)
    .order('log_date', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your energy check-ins.');
  return ok(data ?? []);
}

/**
 * Records or replaces one check-in.
 *
 * Re-checking in replaces the answer rather than adding a second row: there is
 * one value per slot per day, so "I said 2 this morning but I'm actually a 3"
 * corrects the record instead of contradicting it.
 */
export async function upsertEnergyLog(
  db: Db,
  userId: string,
  values: EnergyValues,
): Promise<Result<EnergyLog>> {
  const { data, error } = await db
    .from('daily_energy_logs')
    .upsert(
      {
        user_id: userId,
        log_date: values.log_date,
        slot: values.slot,
        level: values.level,
        tags: values.tags,
        note: emptyToNull(values.note),
      },
      { onConflict: 'user_id,log_date,slot' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That check-in was not saved.');
  return ok(data);
}

export async function deleteEnergyLog(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.from('daily_energy_logs').delete().eq('id', id);
  if (error) return fromPostgrest(error, 'That check-in was not removed.');
  return ok(null);
}

export async function listReflections(
  db: Db,
  from: DayKey,
  to: DayKey,
): Promise<Result<Reflection[]>> {
  const { data, error } = await db
    .from('daily_reflections')
    .select('*')
    .gte('reflection_date', from)
    .lte('reflection_date', to)
    .order('reflection_date', { ascending: false });

  if (error) return fromPostgrest(error, 'We could not load your reflections.');
  return ok(data ?? []);
}

export async function upsertReflection(
  db: Db,
  userId: string,
  values: ReflectionValues,
): Promise<Result<Reflection>> {
  const { data, error } = await db
    .from('daily_reflections')
    .upsert(
      {
        user_id: userId,
        reflection_date: values.reflection_date,
        win_of_day: emptyToNull(values.win_of_day),
        notes: emptyToNull(values.notes),
        mood: values.mood,
      },
      { onConflict: 'user_id,reflection_date' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That reflection was not saved.');
  return ok(data);
}

/** Energy check-ins for one day, keyed by slot, for the dashboard's three cards. */
export function energyBySlotForDay(
  logs: EnergyLog[],
  day: DayKey,
): Partial<Record<EnergyLog['slot'], EnergyLog>> {
  const out: Partial<Record<EnergyLog['slot'], EnergyLog>> = {};
  for (const log of logs) {
    if (log.log_date === day) out[log.slot] = log;
  }
  return out;
}

export function reflectionForDay(reflections: Reflection[], day: DayKey): Reflection | null {
  return reflections.find((row) => row.reflection_date === day) ?? null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
