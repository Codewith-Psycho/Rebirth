'use client';

import { MapPin, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  CALENDAR_STATUS_LABELS,
  type CalendarItem,
} from '@/lib/domain/calendar';
import { formatDuration, formatInstant, longDay, parseDayKey, type DayKey } from '@/lib/domain/time';
import { CATEGORY_META } from '@/lib/domain/vocabulary';
import { useTimeZone } from '@/lib/hooks/use-viewer';
import { categoryFill } from '@/lib/ui-style';
import { cn } from '@/lib/utils';

/**
 * The week and day views on a narrow screen.
 *
 * A seven-column time grid is a desktop instrument: squeezed onto a phone it
 * produces unreadable slivers and overlapping labels. Phones get a readable
 * agenda for one day at a time instead, with a day strip for moving through the
 * week. Every action is the same as the desktop grid — open an item, add a task,
 * switch day — so the two surfaces never disagree about what is possible.
 */

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_ADD_MINUTES = 9 * 60;

export interface MobileAgendaProps {
  days: DayKey[];
  selectedDay: DayKey;
  itemsByDay: Map<DayKey, CalendarItem[]>;
  trackedByItem?: Map<string, number>;
  today: DayKey;
  onSelectDay: (day: DayKey) => void;
  onSelectItem: (item: CalendarItem) => void;
  onQuickAdd: (day: DayKey, startMinutes: number) => void;
}

export function MobileAgenda({
  days,
  selectedDay,
  itemsByDay,
  trackedByItem,
  today,
  onSelectDay,
  onSelectItem,
  onQuickAdd,
}: MobileAgendaProps) {
  const timeZone = useTimeZone();
  const day = days.includes(selectedDay) ? selectedDay : (days[0] ?? selectedDay);
  const items = [...(itemsByDay.get(day) ?? [])].sort((a, b) => {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return a.start.getTime() - b.start.getTime();
  });

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {days.length > 1 ? (
        <div
          role="group"
          aria-label="Choose a day in this week"
          className="grid grid-cols-7 gap-1 border-b border-border p-1.5"
        >
          {days.map((entry) => {
            const date = parseDayKey(entry);
            const isToday = entry === today;
            const isSelected = entry === day;
            const count = (itemsByDay.get(entry) ?? []).length;

            return (
              <button
                key={entry}
                type="button"
                onClick={() => onSelectDay(entry)}
                aria-pressed={isSelected}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${longDay(entry)}, ${count} ${count === 1 ? 'item' : 'items'}`}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                  {WEEKDAY_SHORT[date.getDay()]}
                </span>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full text-sm tabular-nums',
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : isToday
                        ? 'font-semibold text-accent'
                        : 'text-foreground',
                  )}
                >
                  {date.getDate()}
                </span>
                <span
                  aria-hidden="true"
                  className={cn('size-1 rounded-full', count > 0 ? 'bg-accent' : 'bg-transparent')}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-1 pt-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-foreground">{longDay(day)}</h2>
          <p className="text-2xs text-muted-foreground">
            {items.length === 0
              ? 'Nothing planned'
              : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
            {day === today ? ' · Today' : ''}
          </p>
        </div>
        {items.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onQuickAdd(day, DEFAULT_ADD_MINUTES)}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add task
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="p-3">
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center">
            <p className="text-sm font-medium text-foreground">Nothing planned for this day.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              One task is enough to start. You can add the rest as you go.
            </p>
            <Button size="sm" className="mt-3" onClick={() => onQuickAdd(day, DEFAULT_ADD_MINUTES)}>
              <Plus className="size-3.5" aria-hidden="true" />
              Add task
            </Button>
          </div>
        </div>
      ) : (
        <ul className="space-y-2 p-3">
          {items.map((item) => {
            const tracked = trackedByItem?.get(item.id) ?? 0;
            const status = CALENDAR_STATUS_LABELS[item.status];

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectItem(item)}
                  aria-label={`${item.title}, ${status}`}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5 text-left transition-colors duration-150',
                    'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full"
                    style={categoryFill(item.category)}
                  />

                  <span className="w-12 shrink-0 pt-0.5 text-2xs tabular-nums text-muted-foreground">
                    {item.isAllDay ? (
                      'All day'
                    ) : (
                      <>
                        <span className="block">{formatInstant(item.start, timeZone, 'HH:mm')}</span>
                        <span className="block">{formatInstant(item.end, timeZone, 'HH:mm')}</span>
                      </>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'block truncate text-sm font-medium text-foreground',
                        item.status === 'completed' && 'line-through opacity-70',
                      )}
                    >
                      {item.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      <span>{CATEGORY_META[item.category].label}</span>
                      {tracked > 0 ? (
                        <span className="tabular-nums">{formatDuration(tracked)} tracked</span>
                      ) : null}
                      {item.location ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.location}</span>
                        </span>
                      ) : null}
                    </span>
                  </span>

                  {item.status !== 'planned' ? (
                    <span
                      className={cn(
                        'shrink-0 rounded-full border px-1.5 py-0.5 text-2xs font-medium',
                        item.status === 'completed'
                          ? 'border-success/35 bg-success/10 text-success'
                          : 'border-border bg-muted/50 text-muted-foreground',
                      )}
                    >
                      {status}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
