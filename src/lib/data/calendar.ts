import {
  type CalendarItem,
  buildCalendarItems,
  type CalendarBuildInput,
} from '@/lib/domain/calendar';
import { expandEventSeries, type CalendarOccurrence } from '@/lib/domain/recurrence';
import {
  type DayKey,
  type TimeString,
  addDaysToKey,
  combineLocalDateTime,
  dayKeyOf,
  instantToLocalMinutes,
  minutesToTimeString,
} from '@/lib/domain/time';
import type { CalendarEventRow, EventStatus, Tables } from '@/lib/types/database';
import type { EventValues } from '@/lib/validation/schemas';
import { fromPostgrest, ok, type Result } from './result';
import type { Db } from './types';

/**
 * Calendar access.
 *
 * The calendar is not a separate store with its own copy of anything:
 *
 *   · tasks  → read from `scheduled_tasks` (the same rows the task list writes)
 *   · events → read from `calendar_events`, with series expanded in memory
 *
 * So "edit the event from the calendar" and "edit the task from the task list"
 * are the same write to the same row. There is no sync step, which is the only
 * reliable way to avoid the two views drifting apart.
 */

export type CalendarEvent = Tables<'calendar_events'>;
export type ImportantPeriod = Tables<'important_events'>;

export interface CalendarWindow {
  items: CalendarItem[];
  events: CalendarOccurrence[];
  /** The series definitions behind those occurrences, needed to write to one. */
  masters: CalendarEvent[];
  periods: ImportantPeriod[];
}

const EVENT_COLUMNS =
  'id,user_id,parent_event_id,title,description,kind,category,priority,status,goal_id,is_all_day,starts_at,ends_at,timezone,location,reminder_minutes,recurrence,weekdays,recurrence_starts_on,recurrence_ends_on,occurrence_date,original_starts_at,cancelled_at,completed_at,created_at,updated_at';

/* ── Reads ──────────────────────────────────────────────────────────────── */

/**
 * Every event row that can affect the window.
 *
 * Two queries rather than one: masters (series definitions and one-off events)
 * and exception rows (a single occurrence that was moved or cancelled). The
 * expander needs them separately, and a series with an exception must never
 * also render its original slot.
 */
export async function listEventRows(
  db: Db,
  from: DayKey,
  to: DayKey,
  timeZone: string,
): Promise<Result<{ masters: CalendarEvent[]; exceptions: CalendarEvent[] }>> {
  // Pad by a day on each side so an event that starts before the window and
  // ends inside it is still available to the renderer.
  const fromInstant = combineLocalDateTime(from, '00:00', timeZone).toISOString();
  const toInstant = combineLocalDateTime(to, '23:59', timeZone).toISOString();

  const [mastersResult, exceptionsResult] = await Promise.all([
    db
      .from('calendar_events')
      .select(EVENT_COLUMNS)
      .is('parent_event_id', null)
      .or(`recurrence.neq.none,and(starts_at.gte.${fromInstant},starts_at.lte.${toInstant})`)
      .order('starts_at', { ascending: true }),
    db
      .from('calendar_events')
      .select(EVENT_COLUMNS)
      .not('parent_event_id', 'is', null)
      .gte('occurrence_date', from)
      .lte('occurrence_date', to)
      .order('occurrence_date', { ascending: true }),
  ]);

  if (mastersResult.error) {
    return fromPostgrest(mastersResult.error, 'We could not load your calendar.');
  }
  if (exceptionsResult.error) {
    return fromPostgrest(exceptionsResult.error, 'We could not load your calendar.');
  }

  return ok({
    masters: (mastersResult.data ?? []) as CalendarEvent[],
    exceptions: (exceptionsResult.data ?? []) as CalendarEvent[],
  });
}

/** Important periods (exams, deadlines, trips) shown as all-day bands. */
export async function listImportantPeriods(
  db: Db,
  from: DayKey,
  to: DayKey,
): Promise<Result<ImportantPeriod[]>> {
  const { data, error } = await db
    .from('important_events')
    .select('*')
    .lte('starts_on', to)
    .or(`ends_on.is.null,ends_on.gte.${from}`)
    .order('starts_on', { ascending: true });

  if (error) return fromPostgrest(error, 'We could not load your important periods.');
  return ok(data ?? []);
}

/**
 * The composed window the calendar screens render.
 *
 * `goalTitles` is passed in rather than fetched here so a screen showing the
 * calendar and, say, the goal list does not issue the same query twice.
 */
export async function loadCalendarWindow(
  db: Db,
  params: {
    from: DayKey;
    to: DayKey;
    asOf: DayKey;
    timeZone: string;
    tasks: CalendarBuildInput['tasks'];
    goalTitles: Map<string, string>;
  },
): Promise<Result<CalendarWindow>> {
  const { from, to, asOf, timeZone, tasks, goalTitles } = params;

  const [rows, periods] = await Promise.all([
    listEventRows(db, from, to, timeZone),
    listImportantPeriods(db, from, to),
  ]);

  if (!rows.ok) return rows;
  if (!periods.ok) return periods;

  const occurrences = expandEventSeries(rows.data.masters, rows.data.exceptions, from, to);

  const items = buildCalendarItems({
    tasks,
    events: occurrences.map((occurrence) => ({
      rowId: occurrence.rowId,
      seriesId: occurrence.seriesId,
      title: occurrence.title,
      description: occurrence.description,
      category: occurrence.category,
      priority: occurrence.priority,
      status: occurrence.status,
      kind: occurrence.kind,
      goalId: occurrence.goalId,
      isAllDay: occurrence.isAllDay,
      start: occurrence.start,
      end: occurrence.end,
      location: occurrence.location,
      isRecurring: occurrence.isRecurring,
      occurrenceDate: occurrence.occurrenceDate,
      occurrenceKey: occurrence.key,
    })),
    goalTitles,
    timeZone,
    asOf,
    combine: combineLocalDateTime,
    dayKeyOf,
  });

  return ok({ items, events: occurrences, masters: rows.data.masters, periods: periods.data });
}

/* ── Writes ─────────────────────────────────────────────────────────────── */

export type EventScope = 'occurrence' | 'series';

/** Local wall-clock range → the instants stored in the database. */
function instantsFor(values: EventValues, timeZone: string): { startsAt: Date; endsAt: Date } {
  if (values.is_all_day) {
    // All-day events cover whole days. The form's end date is inclusive, so it
    // is stored as the *following* midnight: storing the end date itself would
    // make a one-day event and a two-day event produce the same span, and the
    // form could then never read back what it had written.
    const startsAt = combineLocalDateTime(values.start_date, '00:00', timeZone);
    const lastDay = values.end_date >= values.start_date ? values.end_date : values.start_date;
    const endsAt = combineLocalDateTime(addDaysToKey(lastDay, 1), '00:00', timeZone);
    return { startsAt, endsAt };
  }
  return {
    startsAt: combineLocalDateTime(values.start_date, values.start_time, timeZone),
    endsAt: combineLocalDateTime(values.end_date, values.end_time, timeZone),
  };
}

export async function createEvent(
  db: Db,
  userId: string,
  values: EventValues,
  timeZone: string,
): Promise<Result<CalendarEvent>> {
  const { startsAt, endsAt } = instantsFor(values, timeZone);

  const { data, error } = await db
    .from('calendar_events')
    .insert({
      user_id: userId,
      parent_event_id: null,
      title: values.title,
      description: emptyToNull(values.description),
      kind: values.kind,
      category: values.category,
      priority: values.priority,
      goal_id: values.goal_id,
      is_all_day: values.is_all_day,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: timeZone,
      location: emptyToNull(values.location),
      reminder_minutes: values.reminder_minutes,
      recurrence: values.recurrence,
      weekdays: values.weekdays,
      recurrence_starts_on: values.recurrence === 'none' ? null : values.start_date,
      recurrence_ends_on: values.recurrence_ends_on,
      occurrence_date: null,
    })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That event was not saved.');
  return ok(data);
}

/** Updates the whole series (or the single row, for a one-off event). */
export async function updateEventSeries(
  db: Db,
  eventId: string,
  values: EventValues,
  timeZone: string,
): Promise<Result<CalendarEvent>> {
  const { startsAt, endsAt } = instantsFor(values, timeZone);

  const { data, error } = await db
    .from('calendar_events')
    .update({
      title: values.title,
      description: emptyToNull(values.description),
      kind: values.kind,
      category: values.category,
      priority: values.priority,
      goal_id: values.goal_id,
      is_all_day: values.is_all_day,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      timezone: timeZone,
      location: emptyToNull(values.location),
      reminder_minutes: values.reminder_minutes,
      recurrence: values.recurrence,
      weekdays: values.weekdays,
      recurrence_starts_on: values.recurrence === 'none' ? null : values.start_date,
      recurrence_ends_on: values.recurrence_ends_on,
    })
    .eq('id', eventId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/**
 * Diverges one occurrence of a series.
 *
 * The exception row carries the series slot in `occurrence_date` while its own
 * `starts_at` holds the new time, and the unique index on
 * `(parent_event_id, occurrence_date)` means re-editing the same occurrence
 * updates it rather than stacking up duplicates.
 */
export async function upsertEventOccurrence(
  db: Db,
  userId: string,
  master: Pick<CalendarEvent, 'id' | 'timezone'>,
  occurrenceDate: DayKey,
  values: Omit<EventValues, 'recurrence' | 'weekdays' | 'recurrence_ends_on'>,
  timeZone: string,
): Promise<Result<CalendarEvent>> {
  const { startsAt, endsAt } = instantsFor({ ...values, recurrence: 'none', weekdays: [], recurrence_ends_on: null }, timeZone);

  const { data, error } = await db
    .from('calendar_events')
    .upsert(
      {
        user_id: userId,
        parent_event_id: master.id,
        title: values.title,
        description: emptyToNull(values.description),
        kind: values.kind,
        category: values.category,
        priority: values.priority,
        goal_id: values.goal_id,
        is_all_day: values.is_all_day,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        timezone: timeZone,
        location: emptyToNull(values.location),
        reminder_minutes: values.reminder_minutes,
        occurrence_date: occurrenceDate,
        status: 'scheduled' as EventStatus,
      },
      { onConflict: 'parent_event_id,occurrence_date' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That occurrence was not saved.');
  return ok(data);
}

/**
 * Writes a moved occurrence from explicit instants.
 *
 * Split out because two callers need it: a timed move (new day *and* new clock
 * times) and an all-day move, which shifts whole days and must keep its length.
 * Expressing the latter as a `(day, time)` pair is impossible — a two-day
 * all-day event ends past midnight — so both paths meet here instead.
 */
async function writeEventMove(
  db: Db,
  userId: string,
  master: CalendarEvent,
  occurrenceDate: DayKey,
  startsAt: Date,
  endsAt: Date,
): Promise<Result<CalendarEvent | null>> {
  // A one-off event has no series to diverge from — move the row itself and
  // keep `original_starts_at` as the record that it happened.
  if (master.recurrence === 'none' && master.parent_event_id === null) {
    const { data, error } = await db
      .from('calendar_events')
      .update({
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        original_starts_at: master.original_starts_at ?? master.starts_at,
      })
      .eq('id', master.id)
      .select('*')
      .single();
    if (error) return fromPostgrest(error, 'That event was not moved.');
    return ok(data);
  }

  const { data, error } = await db
    .from('calendar_events')
    .upsert(
      {
        user_id: userId,
        parent_event_id: master.id,
        title: master.title,
        description: master.description,
        kind: master.kind,
        category: master.category,
        priority: master.priority,
        goal_id: master.goal_id,
        is_all_day: master.is_all_day,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        timezone: master.timezone,
        location: master.location,
        reminder_minutes: master.reminder_minutes,
        status: 'scheduled' as EventStatus,
        occurrence_date: occurrenceDate,
        original_starts_at: master.starts_at,
      },
      { onConflict: 'parent_event_id,occurrence_date' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That event was not moved.');
  return ok(data);
}

/** Moves one occurrence to a new day and time. */
export async function moveEventOccurrence(
  db: Db,
  userId: string,
  master: CalendarEvent,
  occurrenceDate: DayKey,
  newDate: DayKey,
  newStartTime: TimeString,
  newEndTime: TimeString,
): Promise<Result<CalendarEvent | null>> {
  return writeEventMove(
    db,
    userId,
    master,
    occurrenceDate,
    combineLocalDateTime(newDate, newStartTime, master.timezone),
    combineLocalDateTime(newDate, newEndTime, master.timezone),
  );
}

/**
 * Moves an all-day occurrence onto another day, keeping its length.
 *
 * The shift is by whole days so that a three-day trip stays three days long, and
 * the span is taken from the row being moved so an occurrence that had already
 * been shortened stays short.
 */
export async function shiftEventOccurrence(
  db: Db,
  userId: string,
  master: CalendarEvent,
  occurrenceDate: DayKey,
  newDate: DayKey,
  span: { startsAt: string; endsAt: string },
): Promise<Result<CalendarEvent | null>> {
  const currentStart = new Date(span.startsAt);
  const durationMs = Math.max(0, new Date(span.endsAt).getTime() - currentStart.getTime());
  const startMinutes = instantToLocalMinutes(currentStart, master.timezone);
  const startsAt = combineLocalDateTime(newDate, minutesToTimeString(startMinutes), master.timezone);
  const endsAt = new Date(startsAt.getTime() + durationMs);
  return writeEventMove(db, userId, master, occurrenceDate, startsAt, endsAt);
}

export async function setEventStatus(
  db: Db,
  eventId: string,
  status: Extract<EventStatus, 'scheduled' | 'completed' | 'cancelled'>,
): Promise<Result<CalendarEvent>> {
  const patch: Record<string, unknown> = { status };
  // Keep the timestamps consistent with the status, the same way tasks do.
  if (status === 'cancelled') patch['cancelled_at'] = new Date().toISOString();
  if (status === 'completed') patch['completed_at'] = new Date().toISOString();
  if (status === 'scheduled') {
    patch['cancelled_at'] = null;
    patch['completed_at'] = null;
  }

  const { data, error } = await db
    .from('calendar_events')
    .update(patch)
    .eq('id', eventId)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/**
 * Sets the status of *one* occurrence.
 *
 * A recurring series keeps its definition on the master row, so marking one
 * Thursday complete cannot be written to the master — that would mark every
 * occurrence complete and silently rewrite history. The occurrence is therefore
 * diverged into an exception row carrying the series slot, which is the same
 * mechanism a moved occurrence uses, and re-marking it updates that row rather
 * than adding another.
 */
export async function setOccurrenceStatus(
  db: Db,
  userId: string,
  master: CalendarEvent,
  occurrenceDate: DayKey,
  span: { startsAt: string; endsAt: string },
  status: Extract<EventStatus, 'scheduled' | 'completed' | 'cancelled'>,
): Promise<Result<CalendarEvent>> {
  const trail: Record<string, unknown> = {};
  if (status === 'completed') trail['completed_at'] = new Date().toISOString();
  if (status === 'cancelled') trail['cancelled_at'] = new Date().toISOString();
  if (status === 'scheduled') {
    trail['completed_at'] = null;
    trail['cancelled_at'] = null;
  }

  const { data, error } = await db
    .from('calendar_events')
    .upsert(
      {
        user_id: userId,
        parent_event_id: master.id,
        title: master.title,
        description: master.description,
        kind: master.kind,
        category: master.category,
        priority: master.priority,
        goal_id: master.goal_id,
        is_all_day: master.is_all_day,
        starts_at: span.startsAt,
        ends_at: span.endsAt,
        timezone: master.timezone,
        location: master.location,
        reminder_minutes: master.reminder_minutes,
        occurrence_date: occurrenceDate,
        status,
        ...trail,
      },
      { onConflict: 'parent_event_id,occurrence_date' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

/** Removes a single occurrence by marking its slot cancelled. */
export async function cancelEventOccurrence(
  db: Db,
  userId: string,
  master: CalendarEvent,
  occurrenceDate: DayKey,
): Promise<Result<CalendarEvent>> {
  const { data, error } = await db
    .from('calendar_events')
    .upsert(
      {
        user_id: userId,
        parent_event_id: master.id,
        title: master.title,
        description: master.description,
        kind: master.kind,
        category: master.category,
        priority: master.priority,
        goal_id: master.goal_id,
        is_all_day: master.is_all_day,
        starts_at: master.starts_at,
        ends_at: master.ends_at,
        timezone: master.timezone,
        location: master.location,
        reminder_minutes: master.reminder_minutes,
        status: 'cancelled' as EventStatus,
        occurrence_date: occurrenceDate,
        cancelled_at: new Date().toISOString(),
      },
      { onConflict: 'parent_event_id,occurrence_date' },
    )
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That occurrence was not removed.');
  return ok(data);
}

/** Deletes a one-off event, or an entire series. */
export async function deleteEvent(db: Db, eventId: string): Promise<Result<null>> {
  const { error } = await db.from('calendar_events').delete().eq('id', eventId);
  if (error) return fromPostgrest(error, 'That event was not deleted.');
  return ok(null);
}

/* ── Important periods ──────────────────────────────────────────────────── */

export interface ImportantPeriodInput {
  title: string;
  kind: ImportantPeriod['kind'];
  starts_on: DayKey;
  ends_on: DayKey | null;
  pressure_mode_enabled: boolean;
  pressure_lead_days: number;
  recovery_days: number;
  notes: string | null;
}

export async function createImportantPeriod(
  db: Db,
  userId: string,
  input: ImportantPeriodInput,
): Promise<Result<ImportantPeriod>> {
  const { data, error } = await db
    .from('important_events')
    .insert({ user_id: userId, ...input })
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That period was not saved.');
  return ok(data);
}

export async function updateImportantPeriod(
  db: Db,
  id: string,
  input: Partial<ImportantPeriodInput>,
): Promise<Result<ImportantPeriod>> {
  const { data, error } = await db
    .from('important_events')
    .update(input)
    .eq('id', id)
    .select('*')
    .single();

  if (error) return fromPostgrest(error, 'That change was not saved.');
  return ok(data);
}

export async function deleteImportantPeriod(db: Db, id: string): Promise<Result<null>> {
  const { error } = await db.from('important_events').delete().eq('id', id);
  if (error) return fromPostgrest(error, 'That period was not removed.');
  return ok(null);
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

export function isRecurringMaster(event: CalendarEvent): boolean {
  return event.parent_event_id === null && event.recurrence !== 'none';
}

/** The master row behind an expanded occurrence, if the series is loaded. */
export function findMaster(
  masters: CalendarEvent[],
  occurrence: CalendarOccurrence,
): CalendarEvent | null {
  if (occurrence.isException) {
    return masters.find((m) => m.id === occurrence.seriesId) ?? null;
  }
  return masters.find((m) => m.id === occurrence.rowId) ?? null;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
