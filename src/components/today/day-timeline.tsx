'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Cake, Flag, Timer } from 'lucide-react';

import type { CalendarItem } from '@/lib/domain/calendar';
import type { MicroStep, TaskSession, TaskSessionPause } from '@/lib/data/tasks';
import {
  intervalsForSessions,
  mergeIntervals,
  nowMarkerPercent,
  placeOnTimeline,
  type TimelineBlock,
} from '@/lib/domain/intervals';
import { dayKeyOf, formatDuration, minutesToClock, MINUTES_PER_DAY, type DayKey } from '@/lib/domain/time';
import { CATEGORY_META, EVENT_KIND_LABELS } from '@/lib/domain/vocabulary';
import { categorySurface } from '@/lib/ui-style';
import { cn } from '@/lib/utils';

/**
 * The day as a 24-hour column: what was planned, and what actually happened.
 *
 * Two layers, drawn in the same space because the interesting question is not
 * "what did I plan" or "what did I do" but how the two line up. Plan is
 * category-coloured and labelled; actual is a warm translucent band drawn
 * underneath, so an hour worked outside the plan is visible as *work*, not as
 * absence. A gap in the plan that has work in it is good news, and the screen
 * should not be able to misrepresent it as a failure.
 *
 * Only the *stored* timestamps are drawn — no interpolation, no smoothing. If
 * the user paused for twenty minutes, the band has a twenty-minute hole in it,
 * because that is what happened.
 *
 * Accessibility: the interactive blocks are real buttons carrying a full
 * sentence of context, and the decorative grid is hidden from assistive
 * technology. A summary of the whole day in words sits above the column for
 * anyone who would rather read it than measure it.
 */

const HOUR_HEIGHT = 48;
const COLUMN_HEIGHT = 24 * HOUR_HEIGHT;

export interface DayTimelineProps {
  day: DayKey;
  timeZone: string;
  now: Date;
  items: CalendarItem[];
  sessions: TaskSession[];
  pauses: TaskSessionPause[];
  microSteps?: MicroStep[];
  onSelect?: (item: CalendarItem) => void;
  className?: string;
}

export function DayTimeline({
  day,
  timeZone,
  now,
  items,
  sessions,
  pauses,
  microSteps = [],
  onSelect,
  className,
}: DayTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nowPercent = nowMarkerPercent(now, day, timeZone, dayKeyOf);

  // Blocks that occupy time: all-day items are listed separately, since drawing
  // a marker or a deadline across the whole column would claim it was occupied.
  const timed = useMemo(() => items.filter((item) => !item.isAllDay && item.minutes > 0), [items]);
  const allDay = useMemo(() => items.filter((item) => item.isAllDay), [items]);

  const placed = useMemo(() => {
    const input = timed.map((item) => ({
      key: item.id,
      start: item.start,
      end: item.end,
    }));
    return placeOnTimeline(input, timeZone, { minHeightPercent: 1.2 });
  }, [timed, timeZone]);

  const actual = useMemo(
    () => mergeIntervals(intervalsForSessions(sessions, pauses, now), 120),
    [sessions, pauses, now],
  );

  const actualPlaced = useMemo(() => {
    const input = actual.map((interval, index) => ({
      key: `actual-${index}`,
      start: interval.start,
      end: interval.end,
    }));
    return placeOnTimeline(input, timeZone, { minHeightPercent: 0.4 });
  }, [actual, timeZone]);

  // Open where the day currently is. A 24-hour column that always starts at
  // midnight makes the user scroll to find their own morning.
  const isToday = nowPercent !== null;
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const target = isToday
      ? Math.max(0, ((nowPercent ?? 0) / 100) * COLUMN_HEIGHT - node.clientHeight / 3)
      : 7 * HOUR_HEIGHT;
    node.scrollTop = target;
    // Only when the day changes — following the clock would fight the user for
    // control of the scroll position.
  }, [day, isToday, nowPercent]);

  const trackedMinutes = Math.round(
    actual.reduce((sum, interval) => sum + interval.seconds, 0) / 60,
  );

  return (
    <div className={cn('space-y-3', className)}>
      <p className="sr-only">
        {timed.length === 0
          ? 'Nothing is planned in the day column yet.'
          : `${timed.length} timed ${timed.length === 1 ? 'block' : 'blocks'} planned, ${formatDuration(
              timed.reduce((sum, item) => sum + item.minutes, 0),
            )} in total, with ${formatDuration(trackedMinutes)} of tracked work recorded so far.`}
      </p>

      {allDay.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {allDay.map((item) => (
            <li key={item.id}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium"
                style={categorySurface(item.category, 0.14)}
              >
                {item.eventKind === 'deadline' ? (
                  <Flag className="size-3" aria-hidden="true" />
                ) : item.eventKind === 'celebration' ? (
                  <Cake className="size-3" aria-hidden="true" />
                ) : null}
                {item.title}
                <span className="opacity-75">
                  {item.eventKind ? EVENT_KIND_LABELS[item.eventKind] : 'All day'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        ref={scrollRef}
        className="relative max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-surface lg:max-h-[36rem]"
      >
        <div className="relative flex" style={{ height: COLUMN_HEIGHT }}>
          {/* Hour gutter */}
          <div className="relative w-12 shrink-0 border-r border-border/70" aria-hidden="true">
            {Array.from({ length: 25 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-2xs tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour === 24 ? '' : minutesToClock(hour * 60)}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            {/* Grid */}
            <div className="absolute inset-0" aria-hidden="true">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className={cn(
                    'absolute inset-x-0 border-t',
                    hour % 6 === 0 ? 'border-border/80' : 'border-border/40',
                    hour === 0 && 'border-t-0',
                  )}
                  style={{ top: hour * HOUR_HEIGHT }}
                />
              ))}
            </div>

            {/* Actual — drawn first so the plan reads on top of it. */}
            <div className="absolute inset-0" aria-hidden="true">
              {actual.map((interval, index) => {
                const block = actualPlaced.get(`actual-${index}`);
                if (!block) return null;
                return (
                  <div
                    key={`actual-${index}`}
                    className="absolute rounded-sm border-l-2 bg-accent/15 border-accent/70"
                    style={{
                      top: `${block.topPercent}%`,
                      height: `${block.heightPercent}%`,
                      left: 0,
                      right: 0,
                    }}
                  />
                );
              })}
            </div>

            {/* Planned */}
            <div className="absolute inset-0">
              {timed.map((item) => {
                const block: TimelineBlock | undefined = placed.get(item.id);
                if (!block) return null;
                const width = 100 / block.laneCount;
                const meta = CATEGORY_META[item.category];
                const steps = microSteps.filter((step) => step.task_id === item.sourceId);
                const done = steps.filter((step) => step.state === 'done').length;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect?.(item)}
                    aria-label={`${item.title}, ${minutesToClock(block.startMinutes)} to ${minutesToClock(
                      block.endMinutes,
                    )}, ${formatDuration(item.minutes)}, ${meta?.label ?? 'Other'}, ${describeStatus(item)}${
                      item.rescheduledFrom ? `, moved from ${item.rescheduledFrom}` : ''
                    }`}
                    className={cn(
                      'absolute overflow-hidden rounded-md border px-2 py-1 text-left transition-colors duration-150',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                      'hover:brightness-[0.97] dark:hover:brightness-110',
                      item.status === 'completed' && 'opacity-70',
                      (item.status === 'cancelled' || item.status === 'skipped') && 'opacity-45',
                      item.priority === 'main' && 'ring-1 ring-accent/60',
                    )}
                    style={{
                      top: `${block.topPercent}%`,
                      height: `calc(${block.heightPercent}% - 2px)`,
                      left: `calc(${block.lane * width}% + 3px)`,
                      width: `calc(${width}% - 6px)`,
                      ...categorySurface(item.category, item.status === 'completed' ? 0.1 : 0.18),
                    }}
                  >
                    <span
                      className={cn(
                        'block truncate text-xs font-medium leading-tight',
                        item.status === 'completed' && 'line-through decoration-1',
                      )}
                    >
                      {item.priority === 'main' ? (
                        <span className="mr-1 text-2xs uppercase tracking-wide opacity-80">Main</span>
                      ) : null}
                      {item.title}
                    </span>
                    {item.minutes >= 45 ? (
                      <span className="mt-0.5 block truncate text-2xs tabular-nums opacity-80">
                        {minutesToClock(block.startMinutes)}–{minutesToClock(block.endMinutes)}
                        {steps.length > 0 ? ` · ${done}/${steps.length} steps` : ''}
                      </span>
                    ) : (
                      <span className="sr-only">
                        {minutesToClock(block.startMinutes)} to {minutesToClock(block.endMinutes)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Now */}
            {nowPercent !== null ? (
              <div
                className="pointer-events-none absolute inset-x-0 z-20"
                style={{ top: `${nowPercent}%` }}
                aria-hidden="true"
              >
                <div className="relative h-px bg-accent">
                  <span className="absolute -left-1 -top-[3px] size-[7px] rounded-full bg-accent" />
                </div>
                <span className="absolute right-1 -translate-y-full pb-0.5 text-2xs tabular-nums text-accent">
                  {minutesToClock((nowPercent / 100) * MINUTES_PER_DAY)}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {timed.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-16">
            <p className="max-w-[16rem] text-center text-xs leading-relaxed text-muted-foreground">
              Nothing has a time yet. Add a start time to a task and it will appear here.
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-5 rounded-sm border bg-accent/15 border-accent/70"
          />
          Tracked time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-5 rounded-sm border border-border bg-muted" />
          Planned block
        </span>
        {trackedMinutes > 0 ? (
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Timer className="size-3" aria-hidden="true" />
            {formatDuration(trackedMinutes)} tracked
          </span>
        ) : null}
      </div>
    </div>
  );
}

function describeStatus(item: CalendarItem): string {
  if (item.isTerminal) return 'finished';
  if (item.status === 'in_progress') return 'in progress';
  if (item.kind === 'event') return 'an event';
  return 'not started';
}
