'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';

import { ItemBlock } from './item-chip';
import type { CalendarItem } from '@/lib/domain/calendar';
import {
  nowMarkerPercent,
  placeOnTimeline,
  type TimelineBlock,
} from '@/lib/domain/intervals';
import {
  MINUTES_PER_DAY,
  dayKeyOf,
  instantToLocalMinutes,
  minutesToClock,
  parseDayKey,
  type DayKey,
} from '@/lib/domain/time';
import { useTimeZone } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';

/**
 * The time grid, used for both the week view and the day view.
 *
 * One column per day, one shared 24-hour axis. The day view is this component
 * with a single column rather than a separate implementation, so the two can
 * never drift apart in how they place or label a block.
 *
 * Two deliberate choices:
 *
 *   · **Empty space is a control.** Clicking a blank stretch of a column opens
 *     the event dialog already filled with that time — which is how most events
 *     actually get created — and dragging a block onto a column moves it to the
 *     snapped time under the pointer.
 *   · **The drop target shows itself.** While a drag is over a column a hairline
 *     marks the exact slot the item would land in, so a move is never a guess
 *     followed by a surprise.
 */

const HOUR_HEIGHT = 44;
const COLUMN_HEIGHT = HOUR_HEIGHT * 24;
const GUTTER_WIDTH = '3.5rem';
/** Moves and quick-adds land on quarter-hours, which is as fine as anyone plans. */
const SNAP_MINUTES = 15;
const DEFAULT_ANCHOR_MINUTES = 8 * 60;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface TimeGridProps {
  /** Seven days for the week view, one for the day view. */
  days: DayKey[];
  itemsByDay: Map<DayKey, CalendarItem[]>;
  trackedByItem?: Map<string, number>;
  today: DayKey;
  now: Date;
  /** How tall the scrolling area may grow. */
  maxHeight?: string;
  onSelectDay: (day: DayKey) => void;
  onSelectItem: (item: CalendarItem) => void;
  onQuickAdd: (day: DayKey, startMinutes: number) => void;
  onMoveItem: (itemId: string, day: DayKey, startMinutes: number) => void;
}

export function TimeGrid({
  days,
  itemsByDay,
  trackedByItem,
  today,
  now,
  maxHeight = 'calc(100dvh - 22rem)',
  onSelectDay,
  onSelectItem,
  onQuickAdd,
  onMoveItem,
}: TimeGridProps) {
  const timeZone = useTimeZone();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dropTarget, setDropTarget] = useState<{ day: DayKey; minutes: number } | null>(null);

  const gridTemplate = `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))`;
  const windowKey = `${days.length}:${days[0] ?? ''}`;

  // The scroll position is remembered through a ref so that the effect below
  // can stay keyed to the visible window only — otherwise it would re-scroll
  // every time the clock ticked and yank the view out from under the user.
  const anchorRef = useRef(DEFAULT_ANCHOR_MINUTES);
  const lastWindowKey = useRef<string | null>(null);

  useEffect(() => {
    anchorRef.current = instantToLocalMinutes(now, timeZone);
  }, [now, timeZone]);

  useEffect(() => {
    if (lastWindowKey.current === windowKey) return;
    lastWindowKey.current = windowKey;
    const element = scrollRef.current;
    if (!element) return;
    const minutes = days.includes(today) ? anchorRef.current : DEFAULT_ANCHOR_MINUTES;
    element.scrollTop = Math.max(0, (minutes / 60) * HOUR_HEIGHT - HOUR_HEIGHT * 2);
  }, [windowKey, days, today]);

  const placedByDay = useMemo(() => {
    const out = new Map<DayKey, Map<string, TimelineBlock>>();
    for (const day of days) {
      const timed = (itemsByDay.get(day) ?? []).filter((item) => !item.isAllDay);
      out.set(
        day,
        placeOnTimeline(
          timed.map((item) => ({ key: item.id, start: item.start, end: item.end })),
          timeZone,
        ),
      );
    }
    return out;
  }, [days, itemsByDay, timeZone]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      {/* Day headings */}
      <div className="flex border-b border-border bg-muted/30">
        <div className="shrink-0" style={{ width: GUTTER_WIDTH }} aria-hidden="true" />
        <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
          {days.map((day) => {
            const isToday = day === today;
            const count = (itemsByDay.get(day) ?? []).length;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelectDay(day)}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${parseDayKey(day).toDateString()}, ${count} ${count === 1 ? 'item' : 'items'}`}
                className={cn(
                  'flex flex-col items-center gap-0.5 border-l border-border px-2 py-2 transition-colors duration-150',
                  'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                )}
              >
                <span className="text-2xs uppercase tracking-wide text-muted-foreground">
                  {WEEKDAY_SHORT[parseDayKey(day).getDay()]}
                </span>
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                    isToday ? 'bg-primary font-semibold text-primary-foreground' : 'text-foreground',
                  )}
                >
                  {parseDayKey(day).getDate()}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The all-day strip. Kept even when empty so the axis below it does not
          shift between one window and the next. */}
      <div className="flex border-b border-border bg-muted/10">
        <div
          className="flex shrink-0 items-start justify-end px-2 py-1.5 text-2xs uppercase tracking-wide text-muted-foreground"
          style={{ width: GUTTER_WIDTH }}
        >
          All day
        </div>
        <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
          {days.map((day) => {
            const allDay = (itemsByDay.get(day) ?? []).filter((item) => item.isAllDay);
            return (
              <div key={day} className="min-h-[2rem] space-y-1 border-l border-border p-1">
                {allDay.map((item) => (
                  <ItemBlock
                    key={item.id}
                    item={item}
                    trackedMinutes={trackedByItem?.get(item.id) ?? null}
                    onClick={onSelectItem}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* The scrolling time axis */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight }}>
        <div className="flex">
          <div className="shrink-0" style={{ width: GUTTER_WIDTH }} aria-hidden="true">
            <div className="relative" style={{ height: COLUMN_HEIGHT }}>
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-2xs tabular-nums text-muted-foreground"
                  style={{ top: hour * HOUR_HEIGHT }}
                >
                  {hour === 0 ? '' : minutesToClock(hour * 60)}
                </div>
              ))}
            </div>
          </div>

          <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
            {days.map((day) => {
              const items = (itemsByDay.get(day) ?? []).filter((item) => !item.isAllDay);
              const placed = placedByDay.get(day);
              const dropping = dropTarget?.day === day ? dropTarget.minutes : null;
              const marker = nowMarkerPercent(now, day, timeZone, dayKeyOf);

              return (
                <div
                  key={day}
                  className="relative border-l border-border"
                  style={{ height: COLUMN_HEIGHT }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes('text/plain')) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTarget({ day, minutes: minutesFromPointer(event, event.currentTarget) });
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDropTarget((current) => (current?.day === day ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const minutes = minutesFromPointer(event, event.currentTarget);
                    setDropTarget(null);
                    const itemId = event.dataTransfer.getData('text/plain');
                    if (itemId) onMoveItem(itemId, day, minutes);
                  }}
                >
                  {/* Hour lines */}
                  <div className="absolute inset-0" aria-hidden="true">
                    {Array.from({ length: 24 }, (_, hour) => (
                      <div
                        key={hour}
                        className="absolute inset-x-0 border-t border-grid/60"
                        style={{ top: hour * HOUR_HEIGHT }}
                      />
                    ))}
                  </div>

                  {/* The blank column is itself the quick-add target: its rect is
                      the column's rect, so the pointer position inside it is the
                      time of day the user pointed at. */}
                  <button
                    type="button"
                    onClick={(event) => onQuickAdd(day, minutesFromPointer(event, event.currentTarget))}
                    className={cn(
                      'absolute inset-0 z-0 w-full cursor-default text-left transition-colors duration-150',
                      'hover:bg-accent/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    )}
                    aria-label={`Add something on ${day} at a chosen time`}
                  />

                  {dropping !== null ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-accent bg-accent/10"
                      style={{
                        top: (dropping / 60) * HOUR_HEIGHT,
                        height: (SNAP_MINUTES / 60) * HOUR_HEIGHT,
                      }}
                      aria-hidden="true"
                    />
                  ) : null}

                  {marker !== null ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30 border-t border-accent"
                      style={{ top: `${marker}%` }}
                      aria-hidden="true"
                    >
                      <span className="absolute -left-1 -top-[3px] size-1.5 rounded-full bg-accent" />
                    </div>
                  ) : null}

                  {items.map((item) => {
                    const block = placed?.get(item.id);
                    if (!block) return null;
                    const laneWidth = 100 / block.laneCount;
                    return (
                      <div
                        key={item.id}
                        className="absolute z-10 pr-1"
                        style={{
                          top: (block.topPercent / 100) * COLUMN_HEIGHT,
                          height: Math.max(
                            (block.heightPercent / 100) * COLUMN_HEIGHT,
                            SNAP_MINUTES * (HOUR_HEIGHT / 60),
                          ),
                          left: `${block.lane * laneWidth}%`,
                          width: `${laneWidth}%`,
                        }}
                      >
                        <ItemBlock
                          item={item}
                          trackedMinutes={trackedByItem?.get(item.id) ?? null}
                          onClick={onSelectItem}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-2xs text-muted-foreground">
          Click a blank stretch to add something at that time, or drag a block to move it. Either way the same change
          can be made from the item&rsquo;s own dialog, with the keyboard.
        </p>
        <span className="hidden shrink-0 items-center gap-1 text-2xs text-muted-foreground sm:flex">
          <CalendarPlus className="size-3" aria-hidden="true" />
          {SNAP_MINUTES}-minute steps
        </span>
      </div>
    </div>
  );
}

/** Snaps a pointer position inside a column to a quarter-hour of the day. */
function minutesFromPointer(event: { clientY: number }, element: HTMLElement | null): number {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  const ratio = (event.clientY - rect.top) / rect.height;
  const snapped = Math.round((ratio * MINUTES_PER_DAY) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(MINUTES_PER_DAY - SNAP_MINUTES, Math.max(0, snapped));
}
