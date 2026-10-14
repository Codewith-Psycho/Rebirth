import { addMonths, format, parseISO } from 'date-fns';

import {
  addDaysToKey,
  startOfMonthKey,
  endOfMonthKey,
  startOfWeekKey,
  type DayKey,
} from './time';

/**
 * Which days each calendar view actually covers.
 *
 * Kept out of the components because it is the one piece of calendar logic that
 * is easy to get subtly wrong — a month view that starts on the 1st instead of
 * the first day of its first week leaves a ragged first row, and a week view
 * that ignores the user's `week_starts_on` preference shows them a week that
 * begins on the wrong day.
 *
 * Every range is inclusive, and every range is computed the same way regardless
 * of which view asked for it, so paging and re-loading can never disagree about
 * what is on screen.
 */

export type CalendarView = 'month' | 'week' | 'day';

export interface CalendarRange {
  from: DayKey;
  to: DayKey;
}

export const CALENDAR_VIEWS: CalendarView[] = ['month', 'week', 'day'];

export const VIEW_LABELS: Record<CalendarView, string> = {
  month: 'Month',
  week: 'Week',
  day: 'Day',
};

export function rangeFor(view: CalendarView, anchor: DayKey, weekStartsOn: number): CalendarRange {
  if (view === 'day') return { from: anchor, to: anchor };

  if (view === 'week') {
    const first = startOfWeekKey(anchor, weekStartsOn);
    return { from: first, to: addDaysToKey(first, 6) };
  }

  // A month view is whole weeks: from the start of the week containing the 1st
  // to the end of the week containing the last day.
  const first = startOfWeekKey(startOfMonthKey(anchor), weekStartsOn);
  const last = addDaysToKey(startOfWeekKey(endOfMonthKey(anchor), weekStartsOn), 6);
  return { from: first, to: last };
}

/** How many days the range spans, inclusive. */
export function rangeLength(range: CalendarRange): number {
  const from = parseISO(range.from).getTime();
  const to = parseISO(range.to).getTime();
  return Math.round((to - from) / 86_400_000) + 1;
}

/** The days in a range, in order. */
export function daysInRange(range: CalendarRange): DayKey[] {
  const days: DayKey[] = [];
  let cursor = range.from;
  // Bounded rather than `while(true)`: a corrupt range should not hang a tab.
  for (let guard = 0; guard < 400; guard += 1) {
    days.push(cursor);
    if (cursor >= range.to) break;
    cursor = addDaysToKey(cursor, 1);
  }
  return days;
}

/**
 * Moving forward or back through time.
 *
 * Month paging moves by calendar month rather than by 30 days, and clamps the
 * day-of-month so that paging from the 31st lands on the last day of a shorter
 * month instead of skipping into the next one.
 */
export function shiftAnchor(view: CalendarView, anchor: DayKey, direction: 1 | -1): DayKey {
  if (view === 'day') return addDaysToKey(anchor, direction);
  if (view === 'week') return addDaysToKey(anchor, direction * 7);

  const date = parseISO(anchor);
  const moved = addMonths(date, direction);
  const wanted = date.getDate();
  const lastDay = new Date(moved.getFullYear(), moved.getMonth() + 1, 0).getDate();
  moved.setDate(Math.min(wanted, lastDay));
  return format(moved, 'yyyy-MM-dd');
}

/** A human label for the range a view is showing. */
export function rangeLabel(view: CalendarView, anchor: DayKey, range: CalendarRange): string {
  try {
    if (view === 'day') return format(parseISO(anchor), 'EEEE d MMMM yyyy');
    if (view === 'week') {
      const from = parseISO(range.from);
      const to = parseISO(range.to);
      const sameMonth = from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear();
      return sameMonth
        ? `${format(from, 'd')}–${format(to, 'd MMMM yyyy')}`
        : `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
    }
    return format(parseISO(anchor), 'MMMM yyyy');
  } catch {
    return anchor;
  }
}

/** Whether `day` falls inside the range. */
export function rangeContains(range: CalendarRange, day: DayKey): boolean {
  return day >= range.from && day <= range.to;
}
