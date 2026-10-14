'use client';

import { useState } from 'react';
import { CalendarPlus, Flag, Plus } from 'lucide-react';

import { ItemChip } from './item-chip';
import type { CalendarItem } from '@/lib/domain/calendar';
import type { ImportantPeriod } from '@/lib/data/calendar';
import { dayOfWeek, formatDayKey, parseDayKey, type DayKey } from '@/lib/domain/time';
import { cn } from '@/lib/utils';

/**
 * The month grid.
 *
 * Cells are drop targets as well as display: dragging a chip onto a day is the
 * fast path, and every chip also opens a dialog where the same move can be made
 * with the keyboard — the drag is a convenience, never the only way to do it.
 *
 * Each day shows a bounded number of chips and then "and N more", which opens
 * that day. That is deliberate: a month cell that silently truncates its list
 * would make a full day look like a light one.
 */

const WEEKDAY_HEADINGS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface MonthGridProps {
  days: DayKey[];
  itemsByDay: Map<DayKey, CalendarItem[]>;
  periods: ImportantPeriod[];
  today: DayKey;
  anchor: DayKey;
  weekStartsOn: number;
  trackedByItem?: Map<string, number>;
  onSelectDay: (day: DayKey) => void;
  onSelectItem: (item: CalendarItem) => void;
  onQuickAdd: (day: DayKey) => void;
  onMoveItem: (itemId: string, day: DayKey) => void;
}

export function MonthGrid({
  days,
  itemsByDay,
  periods,
  today,
  anchor,
  weekStartsOn,
  trackedByItem,
  onSelectDay,
  onSelectItem,
  onQuickAdd,
  onMoveItem,
}: MonthGridProps) {
  const [dragOver, setDragOver] = useState<DayKey | null>(null);

  const headings = Array.from({ length: 7 }, (_, index) => (weekStartsOn + index) % 7);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="grid grid-cols-7 border-b border-border bg-muted/30" aria-hidden="true">
        {headings.map((weekday) => (
          <div
            key={weekday}
            className="px-2 py-2 text-center text-2xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            <span className="hidden sm:inline">{WEEKDAY_FULL[weekday]}</span>
            <span className="sm:hidden">{WEEKDAY_HEADINGS[weekday]}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = itemsByDay.get(day) ?? [];
          const inMonth = day.slice(0, 7) === anchor.slice(0, 7);
          const isToday = day === today;
          const isPast = day < today;
          const activePeriods = periods.filter(
            (period) => period.starts_on <= day && (period.ends_on ?? period.starts_on) >= day,
          );

          const shown = items.slice(0, 3);
          const hidden = items.length - shown.length;

          return (
            <div
              key={day}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes('text/plain')) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDragOver(day);
              }}
              onDragLeave={() => setDragOver((current) => (current === day ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const itemId = event.dataTransfer.getData('text/plain');
                if (itemId) onMoveItem(itemId, day);
              }}
              className={cn(
                'group relative min-h-[6.5rem] border-b border-r border-border p-1.5 transition-colors duration-150 sm:min-h-[7.5rem]',
                !inMonth && 'bg-muted/25',
                isPast && inMonth && 'bg-muted/10',
                dragOver === day && 'bg-accent/10 ring-1 ring-inset ring-accent/50',
              )}
            >
              <div className="mb-1 flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs tabular-nums transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    isToday
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : inMonth
                        ? 'text-foreground hover:bg-muted'
                        : 'text-muted-foreground hover:bg-muted',
                  )}
                  aria-label={`Open ${day}`}
                  aria-current={isToday ? 'date' : undefined}
                >
                  {parseDayKey(day).getDate()}
                </button>

                <div className="flex items-center gap-1">
                  {activePeriods.length > 0 ? (
                    <span
                      className="inline-flex items-center"
                      title={activePeriods.map((period) => period.title).join(', ')}
                    >
                      <Flag className="size-3 text-accent" aria-hidden="true" />
                      <span className="sr-only">
                        Important period: {activePeriods.map((period) => period.title).join(', ')}
                      </span>
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onQuickAdd(day)}
                    className={cn(
                      'flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity duration-150',
                      'hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      'group-hover:opacity-100',
                    )}
                    aria-label={`Add something on ${day}`}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>

              <ul className="space-y-1">
                {shown.map((item) => (
                  <li key={item.id}>
                    <ItemChip
                      item={item}
                      trackedMinutes={trackedByItem?.get(item.id) ?? null}
                      onClick={onSelectItem}
                    />
                  </li>
                ))}
              </ul>

              {hidden > 0 ? (
                <button
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={cn(
                    'mt-1 w-full rounded-md px-1.5 py-0.5 text-left text-2xs tabular-nums text-muted-foreground',
                    'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  and {hidden} more
                </button>
              ) : null}

              {items.length === 0 && inMonth ? (
                <button
                  type="button"
                  onClick={() => onQuickAdd(day)}
                  className={cn(
                    'mt-1 flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-2xs text-muted-foreground/70',
                    'opacity-0 transition-opacity duration-150 hover:bg-muted hover:text-muted-foreground',
                    'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'group-hover:opacity-100',
                  )}
                >
                  <CalendarPlus className="size-3" aria-hidden="true" />
                  Add
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { dayOfWeek, formatDayKey };
