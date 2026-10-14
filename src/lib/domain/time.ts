import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfMonth,
  format,
  parse,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Time handling for REBIRTH.
 *
 * Two distinct kinds of value flow through the app and they must never be
 * confused:
 *
 *   · **Local-day keys** — `YYYY-MM-DD` strings. Task schedules, energy logs
 *     and consistency scoring all live on these. They are compared and
 *     arithmetic'd as calendar days and are never shifted by a timezone.
 *   · **Instants** — `Date` objects / ISO `timestamptz` strings, used for
 *     session timestamps and timer maths.
 *
 * `combineLocalDateTime` is the single bridge between them, and it is the only
 * place where a timezone is allowed to affect the result.
 */

export type DayKey = string; // YYYY-MM-DD
export type TimeString = string; // HH:MM or HH:MM:SS

export const MINUTES_PER_DAY = 24 * 60;

/* ── Local-day keys ─────────────────────────────────────────────────────── */

/** Today's calendar date in `timeZone`, as `YYYY-MM-DD`. */
export function todayInZone(timeZone: string, at: Date = new Date()): DayKey {
  return formatInTimeZone(at, timeZone, 'yyyy-MM-dd');
}

/** Converts an instant to the calendar date it falls on in `timeZone`. */
export function dayKeyOf(instant: Date | string, timeZone: string): DayKey {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return formatInTimeZone(value, timeZone, 'yyyy-MM-dd');
}

/** Parses a `YYYY-MM-DD` key into a Date at *local midnight* (never UTC). */
export function parseDayKey(day: DayKey): Date {
  return parseISO(day);
}

export function formatDayKey(date: Date): DayKey {
  return format(date, 'yyyy-MM-dd');
}

/** Day arithmetic on keys, safe across DST because it never touches instants. */
export function addDaysToKey(day: DayKey, amount: number): DayKey {
  return formatDayKey(addDays(parseDayKey(day), amount));
}

export function diffInDays(a: DayKey, b: DayKey): number {
  return differenceInCalendarDays(parseDayKey(a), parseDayKey(b));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(day: DayKey): number {
  return parseDayKey(day).getDay();
}

export function startOfWeekKey(day: DayKey, weekStartsOn: number): DayKey {
  return formatDayKey(startOfWeek(parseDayKey(day), { weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6 }));
}

/** First day of the month containing `day`. */
export function startOfMonthKey(day: DayKey): DayKey {
  return formatDayKey(startOfMonth(parseDayKey(day)));
}

/** Last day of the month containing `day`. */
export function endOfMonthKey(day: DayKey): DayKey {
  return formatDayKey(endOfMonth(parseDayKey(day)));
}

export function eachDayKey(from: DayKey, to: DayKey): DayKey[] {
  if (diffInDays(to, from) < 0) return [];
  const out: DayKey[] = [];
  let cursor = from;
  // Guard against pathological ranges rather than looping forever.
  for (let i = 0; i <= 3660; i += 1) {
    out.push(cursor);
    if (cursor === to) break;
    cursor = addDaysToKey(cursor, 1);
  }
  return out;
}

export function clampDayKey(day: DayKey, min: DayKey, max: DayKey): DayKey {
  if (diffInDays(day, min) < 0) return min;
  if (diffInDays(day, max) > 0) return max;
  return day;
}

/* ── Time-of-day strings ────────────────────────────────────────────────── */

/** `'09:30'` / `'09:30:00'` → minutes since local midnight. */
export function timeToMinutes(time: TimeString): number {
  const [h, m] = time.split(':');
  const hours = Number.parseInt(h ?? '0', 10);
  const minutes = Number.parseInt(m ?? '0', 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

/** Minutes since midnight → `HH:MM:SS`, the form PostgreSQL `time` expects. */
export function minutesToTimeString(minutes: number): string {
  const safe = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/** Minutes since midnight → `HH:MM` for display. */
export function minutesToClock(minutes: number, use24Hour = true): string {
  const safe = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (use24Hour) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** `1h 05m 09s` — used by the focus timer, which must not jitter. */
export function formatStopwatch(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function endTimeString(startTime: TimeString, durationMinutes: number): string {
  return minutesToClock(timeToMinutes(startTime) + durationMinutes);
}

/* ── The bridge: local day + local time + zone → instant ────────────────── */

export function combineLocalDateTime(day: DayKey, time: TimeString, timeZone: string): Date {
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  // `fromZonedTime` reads the wall-clock string *as if* it were in `timeZone`
  // and returns the corresponding UTC instant. This is the DST-correct
  // direction — the opposite of `toZonedTime`.
  return fromZonedTime(`${day}T${hhmmss}`, timeZone);
}

/** Instant → wall-clock minutes since midnight in `timeZone`. */
export function instantToLocalMinutes(instant: Date, timeZone: string): number {
  const zoned = toZonedTime(instant, timeZone);
  return zoned.getHours() * 60 + zoned.getMinutes();
}

export function formatInstant(instant: Date | string, timeZone: string, pattern = 'HH:mm'): string {
  const value = typeof instant === 'string' ? new Date(instant) : instant;
  return formatInTimeZone(value, timeZone, pattern);
}

/**
 * Offset-aware "now" for the timer.
 *
 * The client measures elapsed time against the server clock so that a device
 * with a wrong clock cannot inflate or erase tracked minutes.
 */
export interface ClockOffset {
  offsetMs: number;
}

export function clockOffsetFrom(serverNow: Date, clientNow: Date = new Date()): ClockOffset {
  return { offsetMs: serverNow.getTime() - clientNow.getTime() };
}

export function correctedNow(offset: ClockOffset, clientNow: Date = new Date()): Date {
  return new Date(clientNow.getTime() + offset.offsetMs);
}

/* ── Display helpers ────────────────────────────────────────────────────── */

export function humanDay(day: DayKey, referenceDay: DayKey): string {
  const delta = diffInDays(day, referenceDay);
  if (delta === 0) return 'Today';
  if (delta === 1) return 'Tomorrow';
  if (delta === -1) return 'Yesterday';
  return format(parseDayKey(day), 'EEE d MMM');
}

export function longDay(day: DayKey): string {
  return format(parseDayKey(day), 'EEEE, d MMMM yyyy');
}

export function parseClockInput(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const h = Number.parseInt(match[1] ?? '', 10);
  const m = Number.parseInt(match[2] ?? '', 10);
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return h * 60 + m;
}

export function parseDateInput(value: string): DayKey | null {
  try {
    const parsed = parse(value, 'yyyy-MM-dd', new Date());
    if (Number.isNaN(parsed.getTime())) return null;
    return formatDayKey(parsed);
  } catch {
    return null;
  }
}

/** Duration between two instants, floored at zero. */
export function minutesBetween(start: Date, end: Date): number {
  return Math.max(0, differenceInMinutes(end, start));
}

/** Number of days in the window that have elapsed, inclusive of today. */
export function elapsedDaysIn(from: DayKey, to: DayKey, asOf: DayKey): number {
  const end = diffInDays(to, asOf) > 0 ? asOf : to;
  const total = diffInDays(end, from) + 1;
  return Math.max(0, total);
}
