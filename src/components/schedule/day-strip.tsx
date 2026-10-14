'use client';

import { format } from 'date-fns';

import { weekdayShort, weekdayName } from '@/lib/domain/recurrence';
import { dayOfWeek, parseDayKey, type DayKey } from '@/lib/domain/time';
import { cn } from '@/lib/utils';

/**
 * The next few weeks, one button per day.
 *
 * A strip rather than a calendar grid, because the question this screen answers
 * is "how does the next stretch of time look", and a month grid spends most of
 * its pixels on days that are already behind the user.
 *
 * Each day carries its open-task count as text, not as a colour: "4" and "0" are
 * readable to everyone, and a dot whose meaning has to be memorised is not.
 */

export interface DayStripProps {
  days: DayKey[];
  day: DayKey;
  today: DayKey;
  countByDay: Map<DayKey, number>;
  onSelect: (day: DayKey) => void;
}

export function DayStrip({ days, day, today, countByDay, onSelect }: DayStripProps) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-2">
      <ul className="flex min-w-max gap-1.5">
        {days.map((entry) => {
          const count = countByDay.get(entry) ?? 0;
          const selected = entry === day;
          const isToday = entry === today;
          const date = parseDayKey(entry);

          return (
            <li key={entry}>
              <button
                type="button"
                onClick={() => onSelect(entry)}
                aria-pressed={selected}
                aria-label={`${weekdayName(dayOfWeek(entry))} ${format(date, 'd MMMM')} — ${
                  count === 0 ? 'nothing planned' : `${count} open ${count === 1 ? 'task' : 'tasks'}`
                }. Show this day.`}
                className={cn(
                  'flex w-16 min-h-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-md border px-1.5 py-2 transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected
                    ? 'border-primary bg-primary-soft text-foreground'
                    : 'border-border bg-surface text-muted-foreground hover:bg-muted/60',
                )}
              >
                <span className="text-2xs uppercase tracking-wide">
                  {weekdayShort(dayOfWeek(entry))}
                </span>
                <span
                  className={cn(
                    'font-serif text-lg font-semibold tabular-nums',
                    selected ? 'text-foreground' : 'text-foreground/90',
                  )}
                >
                  {format(date, 'd')}
                </span>
                <span
                  className={cn(
                    'text-2xs tabular-nums',
                    count > 0 ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {count > 0 ? count : '—'}
                </span>
                {isToday ? <span className="sr-only">Today</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
