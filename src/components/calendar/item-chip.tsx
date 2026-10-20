'use client';

import { Cake, Flag, MapPin, Repeat2, Sparkles } from 'lucide-react';

import { CALENDAR_STATUS_LABELS, type CalendarItem } from '@/lib/domain/calendar';
import { formatDuration, formatInstant } from '@/lib/domain/time';
import { CATEGORY_META, EVENT_KIND_LABELS } from '@/lib/domain/vocabulary';
import { categorySurface } from '@/lib/ui-style';
import { useTimeZone } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';

/**
 * One thing on the calendar.
 *
 * The chip carries four independent signals — colour for category, a glyph for
 * status, an icon for the kind of event, and a written label — so no single one
 * of them is load-bearing. A user who cannot distinguish the colours still sees
 * the glyph; a user who cannot see the glyph still reads the title.
 *
 * The distinction the whole calendar turns on is planned vs. done vs. missed:
 * completed items are struck through, missed items are greyed and labelled,
 * cancelled items are faded and labelled. Nothing is red.
 */

export interface ItemChipProps {
  item: CalendarItem;
  /** `chip` for dense grids, `block` for the time grid. */
  variant?: 'chip' | 'block';
  /** Minutes of tracked work recorded against this item today. */
  trackedMinutes?: number | null;
  onClick?: (item: CalendarItem) => void;
  className?: string;
  /** Set while this chip is being dragged. */
  dragging?: boolean;
}

export function ItemChip({
  item,
  variant = 'chip',
  trackedMinutes = null,
  onClick,
  className,
  dragging = false,
}: ItemChipProps) {
  const timeZone = useTimeZone();
  const timeLabel = item.isAllDay ? 'All day' : timeRangeLabel(item, timeZone);

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      draggable
      onDragStart={(event) => {
        // The key is the only thing carried: the drop handler looks the item up
        // in the loaded window rather than trusting the drag payload.
        event.dataTransfer.setData('text/plain', item.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      aria-label={describeItem(item, trackedMinutes)}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-md border text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        variant === 'chip' ? 'px-1.5 py-1 text-2xs' : 'px-2 py-1 text-xs',
        item.status === 'completed' && 'opacity-70',
        (item.status === 'cancelled' || item.status === 'skipped') && 'opacity-45',
        item.status === 'missed' && 'opacity-80',
        item.priority === 'main' && 'ring-1 ring-accent/50',
        dragging && 'opacity-40',
        className,
      )}
      style={categorySurface(item.category, item.status === 'completed' ? 0.1 : 0.18)}
    >
      {item.eventKind === 'deadline' ? (
        <Flag className="size-3 shrink-0" aria-hidden="true" />
      ) : item.eventKind === 'celebration' ? (
        <Cake className="size-3 shrink-0" aria-hidden="true" />
      ) : item.kind === 'task' && item.priority === 'main' ? (
        <Sparkles className="size-3 shrink-0" aria-hidden="true" />
      ) : null}

      <span className={cn('min-w-0 flex-1 truncate', item.status === 'completed' && 'line-through')}>
        {item.title}
      </span>

      {item.isRecurring ? (
        <Repeat2 className="size-3 shrink-0 opacity-70" aria-hidden="true" />
      ) : null}

      {variant === 'chip' ? (
        <span className="shrink-0 tabular-nums opacity-75">{timeLabel}</span>
      ) : null}
    </button>
  );
}

/** A full-width chip used on the day and week grids, with its own time line. */
export function ItemBlock({
  item,
  trackedMinutes,
  onClick,
  className,
}: {
  item: CalendarItem;
  trackedMinutes?: number | null;
  onClick?: (item: CalendarItem) => void;
  className?: string;
}) {
  const timeZone = useTimeZone();
  const planned = item.minutes;
  const tracked = trackedMinutes ?? 0;
  // A 15-minute block is roughly one line tall. Showing a second line in it
  // would clip both, so short blocks keep the title and put the time and
  // status in the accessible name, where they are never truncated.
  const compact = !item.isAllDay && item.minutes < 45;
  const showTrackedText = !compact && tracked > 0 && item.minutes >= 75;
  const showLocation = item.location !== null && (item.isAllDay || item.minutes >= 90);
  const status = CALENDAR_STATUS_LABELS[item.status];

  return (
    <button
      type="button"
      onClick={() => onClick?.(item)}
      aria-label={describeItem(item, trackedMinutes ?? null)}
      className={cn(
        'relative flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-md border text-left transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        'hover:brightness-[0.97] dark:hover:brightness-110',
        compact ? 'px-1.5 pt-0.5 pb-1' : 'px-2 py-1',
        tracked > 0 && !compact && 'pb-2.5',
        item.status === 'completed' && 'opacity-70',
        (item.status === 'cancelled' || item.status === 'skipped') && 'opacity-45',
        item.status === 'missed' && 'opacity-80',
        item.priority === 'main' && 'ring-1 ring-accent/50',
        className,
      )}
      style={categorySurface(item.category, item.status === 'completed' ? 0.1 : 0.2)}
    >
      <span
        className={cn(
          'truncate font-medium leading-tight',
          compact ? 'text-[11px]' : 'text-xs',
          item.status === 'completed' && 'line-through',
        )}
      >
        {item.title}
      </span>

      {!compact ? (
        <span className="truncate text-2xs tabular-nums opacity-80">
          {item.isAllDay
            ? (item.eventKind ? EVENT_KIND_LABELS[item.eventKind] : 'All day')
            : `${timeRangeLabel(item, timeZone)}${item.status === 'planned' ? '' : ` · ${status}`}`}
        </span>
      ) : null}

      {showTrackedText ? (
        <span className="truncate text-2xs tabular-nums opacity-90">
          {formatDuration(tracked)} tracked
        </span>
      ) : null}

      {showLocation && item.location ? (
        <span className="flex items-center gap-1 truncate text-2xs opacity-80">
          <MapPin className="size-2.5 shrink-0" aria-hidden="true" />
          {item.location}
        </span>
      ) : null}

      {/* Tracked time is a mark on the block, not another line of text, so it
          cannot push the title out of a short block or cover any label. */}
      {tracked > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 bottom-1 h-0.5 overflow-hidden rounded-full bg-foreground/10"
        >
          <span
            className="block h-full rounded-full bg-accent"
            style={{ width: `${Math.min(100, (tracked / Math.max(1, planned)) * 100)}%` }}
          />
        </span>
      ) : null}
    </button>
  );
}

/** A tooltip/screen-reader sentence built from the item's own fields. */
export function describeItem(item: CalendarItem, trackedMinutes: number | null): string {
  const parts: string[] = [item.title];
  parts.push(item.isAllDay ? 'all day' : `${formatDuration(item.minutes)}`);
  parts.push(CATEGORY_META[item.category]?.label ?? 'Other');
  if (item.kind === 'event' && item.eventKind) parts.push(EVENT_KIND_LABELS[item.eventKind]);
  if (item.priority === 'main') parts.push('the main priority');
  parts.push(statusWord(item));
  if (item.isRecurring) parts.push('part of a repeating series');
  if (item.rescheduledFrom) parts.push(`moved from ${item.rescheduledFrom}`);
  if (item.goalTitle) parts.push(`linked to ${item.goalTitle}`);
  if (trackedMinutes && trackedMinutes > 0) parts.push(`${trackedMinutes} minutes tracked`);
  return parts.join(', ');
}

function statusWord(item: CalendarItem): string {
  return CALENDAR_STATUS_LABELS[item.status].toLowerCase();
}

/**
 * The wall-clock range, formatted in the *user's* timezone.
 *
 * Not `Date#getHours()`: that reads the browser's zone, which is the wrong
 * answer whenever the two differ, and the label would then contradict the
 * position the block was drawn at.
 */
function timeRangeLabel(item: CalendarItem, timeZone: string): string {
  return `${formatInstant(item.start, timeZone, 'HH:mm')}–${formatInstant(item.end, timeZone, 'HH:mm')}`;
}
