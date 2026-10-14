import type {
  CalendarEventRow,
  CategoryKind,
  EventKind,
  TaskPriority,
  TaskStatus,
} from '@/lib/types/database';
import type { CalendarOccurrence } from './recurrence';
import type { DayKey } from './time';

/**
 * The unified calendar model.
 *
 * The calendar has exactly one source of truth per entity and never a copy:
 *
 *   · tasks  → `scheduled_tasks` rows (already materialised by the recurrence
 *              RPC, so a recurring task is a real, completable record)
 *   · events → `calendar_events` rows, with series expanded in memory
 *
 * Both are projected into `CalendarItem` so the month/week/day grid, the
 * agenda sidebar, the filters and the search only ever deal with one shape.
 * Because a task *is* its calendar entry, rescheduling from the calendar and
 * rescheduling from the task list are the same write to the same row — there is
 * no second record to drift out of sync.
 */

export type CalendarItemStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'missed'
  | 'skipped'
  | 'cancelled';

export interface CalendarItem {
  /** Unique across both kinds, so React keys never collide. */
  id: string;
  kind: 'task' | 'event';
  sourceId: string;
  seriesId: string | null;
  title: string;
  description: string | null;
  /** Local calendar day in the user's configured timezone. */
  date: DayKey;
  start: Date;
  end: Date;
  minutes: number;
  isAllDay: boolean;
  category: CategoryKind;
  priority: TaskPriority;
  status: CalendarItemStatus;
  goalId: string | null;
  goalTitle: string | null;
  eventKind: EventKind | null;
  location: string | null;
  isRecurring: boolean;
  /** Set when this instance was moved away from its original slot. */
  rescheduledFrom: DayKey | null;
  /** True when the underlying task is in a terminal state. */
  isTerminal: boolean;
}

export interface CalendarItemSource {
  taskId: string | null;
  eventOccurrenceKey: string | null;
}

export function calendarItemKey(kind: 'task' | 'event', id: string): string {
  return `${kind}:${id}`;
}

/**
 * The series row behind an item.
 *
 * For an occurrence of a series the master is `seriesId`; for a one-off event
 * (and for a moved one-off, whose exception row is what is on screen) it is the
 * row the item was built from. Getting this wrong means editing someone else's
 * series, so the lookup lives in one place and both the dialog and the
 * drag-and-drop path use it.
 */
export function masterForItem(
  item: CalendarItem,
  masters: CalendarEventRow[],
): CalendarEventRow | null {
  const id = item.seriesId ?? item.sourceId;
  return masters.find((row) => row.id === id) ?? null;
}

/**
 * The expanded occurrence behind an item.
 *
 * Matched on the row *and* the slot first, because every unmoved occurrence of a
 * series shares its master's row id; the row alone is only unambiguous for an
 * exception, which has a row of its own.
 */
export function occurrenceForItem(
  item: CalendarItem,
  occurrences: CalendarOccurrence[],
): CalendarOccurrence | null {
  const exact = occurrences.find(
    (row) => row.rowId === item.sourceId && row.occurrenceDate === item.date,
  );
  if (exact) return exact;
  return occurrences.find((row) => row.rowId === item.sourceId) ?? null;
}

/** The slot a divergent write must name: the series day, not the moved day. */
export function slotDateForItem(
  item: CalendarItem,
  occurrences: CalendarOccurrence[],
): DayKey {
  return occurrenceForItem(item, occurrences)?.occurrenceDate ?? item.date;
}

export function terminalStatus(status: CalendarItemStatus): boolean {
  return status === 'completed' || status === 'skipped' || status === 'cancelled';
}

/** Maps a stored task status plus its date to the calendar's display status. */
export function deriveTaskStatus(
  status: TaskStatus,
  day: DayKey,
  asOf: DayKey,
): CalendarItemStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    case 'in_progress':
      return 'in_progress';
    case 'scheduled':
    default:
      // A task whose day has passed without action is *missed*, not completed.
      // The app never assumes the scheduled time implies the outcome.
      return day < asOf ? 'missed' : 'planned';
  }
}

export interface CalendarBuildInput {
  tasks: Array<{
    id: string;
    template_id: string | null;
    title: string;
    description: string | null;
    category: CategoryKind;
    priority: TaskPriority;
    status: TaskStatus;
    scheduled_date: DayKey;
    start_time: string;
    duration_minutes: number;
    goal_id: string | null;
    rescheduled_from_date: DayKey | null;
  }>;
  events: Array<{
    rowId: string;
    seriesId: string | null;
    title: string;
    description: string | null;
    category: CategoryKind;
    priority: TaskPriority;
    status: 'scheduled' | 'completed' | 'cancelled';
    kind: EventKind;
    goalId: string | null;
    isAllDay: boolean;
    start: Date;
    end: Date;
    location: string | null;
    isRecurring: boolean;
    occurrenceDate: DayKey;
    occurrenceKey: string;
  }>;
  goalTitles: Map<string, string>;
  timeZone: string;
  asOf: DayKey;
  /** Injected so the module stays pure and testable. */
  combine: (day: DayKey, time: string, timeZone: string) => Date;
  dayKeyOf: (instant: Date, timeZone: string) => DayKey;
}

export function buildCalendarItems(input: CalendarBuildInput): CalendarItem[] {
  const { tasks, events, goalTitles, timeZone, asOf, combine, dayKeyOf } = input;
  const items: CalendarItem[] = [];

  for (const task of tasks) {
    const start = combine(task.scheduled_date, task.start_time, timeZone);
    items.push({
      id: calendarItemKey('task', task.id),
      kind: 'task',
      sourceId: task.id,
      seriesId: task.template_id,
      title: task.title,
      description: task.description,
      date: task.scheduled_date,
      start,
      end: new Date(start.getTime() + task.duration_minutes * 60_000),
      minutes: task.duration_minutes,
      isAllDay: false,
      category: task.category,
      priority: task.priority,
      status: deriveTaskStatus(task.status, task.scheduled_date, asOf),
      goalId: task.goal_id,
      goalTitle: task.goal_id ? (goalTitles.get(task.goal_id) ?? null) : null,
      eventKind: null,
      location: null,
      isRecurring: task.template_id !== null,
      rescheduledFrom: task.rescheduled_from_date,
      isTerminal: terminalStatus(deriveTaskStatus(task.status, task.scheduled_date, asOf)),
    });
  }

  for (const event of events) {
    const day = event.isAllDay ? dayKeyOf(event.start, timeZone) : dayKeyOf(event.start, timeZone);
    const status: CalendarItemStatus =
      event.status === 'cancelled' ? 'cancelled' : event.status === 'completed' ? 'completed' : 'planned';
    items.push({
      id: calendarItemKey('event', event.occurrenceKey),
      kind: 'event',
      sourceId: event.rowId,
      seriesId: event.seriesId,
      title: event.title,
      description: event.description,
      date: day,
      start: event.start,
      end: event.end,
      minutes: Math.max(0, Math.round((event.end.getTime() - event.start.getTime()) / 60_000)),
      isAllDay: event.isAllDay,
      category: event.category,
      priority: event.priority,
      status,
      goalId: event.goalId,
      goalTitle: event.goalId ? (goalTitles.get(event.goalId) ?? null) : null,
      eventKind: event.kind,
      location: event.location,
      isRecurring: event.isRecurring,
      rescheduledFrom: null,
      isTerminal: terminalStatus(status),
    });
  }

  return items.sort((a, b) => {
    // All-day entries float to the top of their day, then chronological order.
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return a.start.getTime() - b.start.getTime();
  });
}

export function groupItemsByDay(items: CalendarItem[]): Map<DayKey, CalendarItem[]> {
  const map = new Map<DayKey, CalendarItem[]>();
  for (const item of items) {
    const bucket = map.get(item.date);
    if (bucket) bucket.push(item);
    else map.set(item.date, [item]);
  }
  return map;
}

export function itemsInRange(items: CalendarItem[], from: DayKey, to: DayKey): CalendarItem[] {
  return items.filter((item) => item.date >= from && item.date <= to);
}

/** Past-day items that were never completed, cancelled or skipped. */
export function overdueItems(items: CalendarItem[], asOf: DayKey): CalendarItem[] {
  return items
    .filter((item) => item.kind === 'task' && item.status === 'missed')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function upcomingDeadlines(items: CalendarItem[], asOf: DayKey, days = 14): CalendarItem[] {
  const limit = new Date(`${asOf}T00:00:00`);
  limit.setDate(limit.getDate() + days);
  const limitKey = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(
    limit.getDate(),
  ).padStart(2, '0')}`;
  return items
    .filter(
      (item) =>
        item.date >= asOf &&
        item.date <= limitKey &&
        !item.isTerminal &&
        (item.eventKind === 'deadline' ||
          item.eventKind === 'exam' ||
          item.eventKind === 'interview' ||
          item.eventKind === 'competition'),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Today's remaining agenda: everything not finished, in time order. */
export function agendaForDay(items: CalendarItem[], day: DayKey): CalendarItem[] {
  return items
    .filter((item) => item.date === day)
    .sort((a, b) => {
      if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
      return a.start.getTime() - b.start.getTime();
    });
}

export interface ItemFilter {
  kinds: Array<'task' | 'event'>;
  categories: CategoryKind[];
  priorities: TaskPriority[];
  statuses: CalendarItemStatus[];
  goalIds: string[];
  query: string;
}

export const EMPTY_FILTER: ItemFilter = {
  kinds: [],
  categories: [],
  priorities: [],
  statuses: [],
  goalIds: [],
  query: '',
};

export function isFilterActive(filter: ItemFilter): boolean {
  return (
    filter.kinds.length > 0 ||
    filter.categories.length > 0 ||
    filter.priorities.length > 0 ||
    filter.statuses.length > 0 ||
    filter.goalIds.length > 0 ||
    filter.query.trim().length > 0
  );
}

export function applyFilter(items: CalendarItem[], filter: ItemFilter): CalendarItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter.kinds.length > 0 && !filter.kinds.includes(item.kind)) return false;
    if (filter.categories.length > 0 && !filter.categories.includes(item.category)) return false;
    if (filter.priorities.length > 0 && !filter.priorities.includes(item.priority)) return false;
    if (filter.statuses.length > 0 && !filter.statuses.includes(item.status)) return false;
    if (filter.goalIds.length > 0 && (item.goalId === null || !filter.goalIds.includes(item.goalId))) return false;
    if (query.length > 0) {
      const haystack = `${item.title} ${item.description ?? ''} ${item.goalTitle ?? ''} ${
        item.location ?? ''
      }`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

/* ── Planned vs completed per day, for the calendar's footer figures ────── */

export interface DayTotals {
  day: DayKey;
  plannedMinutes: number;
  completedMinutes: number;
  plannedTasks: number;
  completedTasks: number;
  missedTasks: number;
}

export function dayTotals(items: CalendarItem[], day: DayKey): DayTotals {
  const todays = items.filter((item) => item.date === day && item.kind === 'task');
  const active = todays.filter((t) => t.status !== 'cancelled');
  return {
    day,
    plannedMinutes: active.reduce((sum, t) => sum + t.minutes, 0),
    completedMinutes: todays
      .filter((t) => t.status === 'completed')
      .reduce((sum, t) => sum + t.minutes, 0),
    plannedTasks: active.length,
    completedTasks: todays.filter((t) => t.status === 'completed').length,
    missedTasks: todays.filter((t) => t.status === 'missed').length,
  };
}
