'use client';

import { CalendarClock, Flag, Hourglass, MoveRight } from 'lucide-react';

import { ItemChip } from './item-chip';
import type { CalendarItem } from '@/lib/domain/calendar';
import { agendaForDay, overdueItems, upcomingDeadlines } from '@/lib/domain/calendar';
import type { ImportantPeriod } from '@/lib/data/calendar';
import { diffInDays, humanDay, type DayKey } from '@/lib/domain/time';
import { useTimeZone } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';

/**
 * The calendar's side panel: what is actually coming.
 *
 * Three lists, kept honestly separate:
 *
 *   · **Today** — everything on the day, in time order, including what is done.
 *   · **Coming up** — deadlines, exams, interviews and competitions inside the
 *     next fortnight. These are the things that punish silence.
 *   · **Still open** — tasks from earlier days that were never finished. They
 *     are offered as a move, never as a count of failures.
 */

export interface AgendaPanelProps {
  /** The day the panel describes — today's date, not the anchor. */
  day: DayKey;
  items: CalendarItem[];
  periods: ImportantPeriod[];
  trackedByItem?: Map<string, number>;
  onSelectItem: (item: CalendarItem) => void;
  /** Opens the move dialog for a task carried over from an earlier day. */
  onMoveItem: (item: CalendarItem) => void;
}

export function AgendaPanel({
  day,
  items,
  periods,
  trackedByItem,
  onSelectItem,
  onMoveItem,
}: AgendaPanelProps) {
  const timeZone = useTimeZone();

  const agenda = agendaForDay(items, day);
  const deadlines = upcomingDeadlines(items, day, 14);
  const overdue = overdueItems(items, day).slice(0, 6);
  const livePeriods = periods.filter(
    (period) => period.starts_on <= day && (period.ends_on ?? period.starts_on) >= day,
  );

  return (
    <div className="space-y-5">
      {livePeriods.length > 0 ? (
        <section className="rounded-lg border border-accent/40 bg-accent/[0.06] p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Flag className="size-3.5 text-accent" aria-hidden="true" />
            In the middle of
          </h2>
          <ul className="space-y-1.5">
            {livePeriods.map((period) => (
              <li key={period.id} className="text-sm">
                <p className="font-medium text-foreground">{period.title}</p>
                <p className="text-xs text-muted-foreground">
                  {period.ends_on
                    ? `${humanDay(period.starts_on, day)} to ${humanDay(period.ends_on, day)}`
                    : `From ${humanDay(period.starts_on, day)}`}
                  {period.pressure_mode_enabled
                    ? ` · planning relaxes ${period.pressure_lead_days} ${
                        period.pressure_lead_days === 1 ? 'day' : 'days'
                      } before`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          Today
        </h2>
        {agenda.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs leading-relaxed text-muted-foreground">
            Nothing is on today&rsquo;s calendar yet. That is a fine place to start from.
          </p>
        ) : (
          <ul className="space-y-1">
            {agenda.map((item) => (
              <li key={item.id}>
                <ItemChip
                  item={item}
                  variant="block"
                  trackedMinutes={trackedByItem?.get(item.id) ?? null}
                  onClick={onSelectItem}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Hourglass className="size-3.5" aria-hidden="true" />
          Coming up
        </h2>
        {deadlines.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No deadlines, exams or interviews in the next two weeks.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {deadlines.map((item) => {
              const days = diffInDays(item.date, day);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(item)}
                    className={cn(
                      'flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                      'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">{item.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {overdue.length > 0 ? (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Still open from earlier
          </h2>
          <ul className="space-y-1.5">
            {overdue.map((item) => (
              <li
                key={item.id}
                className="rounded-md border border-border bg-surface px-2 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectItem(item)}
                    className="min-w-0 flex-1 truncate text-left text-xs text-foreground hover:underline"
                  >
                    {item.title}
                  </button>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {humanDay(item.date, day)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onMoveItem(item)}
                  className={cn(
                    'mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-2xs text-muted-foreground',
                    'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                >
                  <MoveRight className="size-3" aria-hidden="true" />
                  Move it to today
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs leading-relaxed text-muted-foreground">
            Yesterday is data, not a verdict. Moving one of these forward is a complete answer.
          </p>
        </section>
      ) : null}

      <p className="text-2xs leading-relaxed text-muted-foreground">
        Times shown in {timeZone.replace(/_/g, ' ')}.
      </p>
    </div>
  );
}
