'use client';

import { CalendarDays, CalendarRange, Check, CircleSlash, Clock, PencilLine, RotateCcw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/common/status-chip';
import { deriveTaskStatus } from '@/lib/domain/calendar';
import { categoryLabel, PRIORITY_LABELS } from '@/lib/domain/vocabulary';
import type { CalendarOccurrence } from '@/lib/domain/recurrence';
import { OPEN_STATUSES, taskDay } from '@/lib/domain/schedule';
import { endTimeString, longDay, type DayKey } from '@/lib/domain/time';
import type { ScheduledTask } from '@/lib/data/tasks';
import type { TaskStatus } from '@/lib/types/database';
import { cn } from '@/lib/utils';

/**
 * One day of the plan.
 *
 * The rows are the real `scheduled_tasks` of that day — the same rows Today
 * shows and the Calendar drops onto a grid — so marking one done here is a
 * completion everywhere, not a note on a plan.
 *
 * This screen does not offer a timer. Starting focus is a *doing* action and
 * belongs on Today, where the timer, the checklist and the two-minute escape
 * hatch live together. Offering to start work from the planning screen would be
 * the app nudging the user into doing something by accident.
 */

export interface DayPlanProps {
  day: DayKey;
  today: DayKey;
  tasks: ScheduledTask[];
  /** All-day calendar entries, which are context for the day rather than time in it. */
  allDayEvents: CalendarOccurrence[];
  goalTitle: (goalId: string | null) => string | null;
  onEdit: (task: ScheduledTask) => void;
  onMove: (task: ScheduledTask) => void;
  onSetStatus: (task: ScheduledTask, status: Extract<TaskStatus, 'completed' | 'skipped' | 'scheduled'>) => void;
  busyTaskId: string | null;
}

export function DayPlan({
  day,
  today,
  tasks,
  allDayEvents,
  goalTitle,
  onEdit,
  onMove,
  onSetStatus,
  busyTaskId,
}: DayPlanProps) {
  const ordered = [...tasks].sort((a, b) => {
    const aOpen = OPEN_STATUSES.includes(a.status);
    const bOpen = OPEN_STATUSES.includes(b.status);
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return a.start_time < b.start_time ? -1 : 1;
  });

  return (
    <section aria-label={`Plan for ${longDay(day)}`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {longDay(day)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {ordered.length === 0
              ? 'Nothing planned yet.'
              : `${ordered.length} ${ordered.length === 1 ? 'task' : 'tasks'} on this day.`}
          </p>
        </div>
        <p className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Clock className="size-3" aria-hidden="true" />
          Times are in your timezone
        </p>
      </div>

      {allDayEvents.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {allDayEvents.map((event) => (
            <li
              key={event.key}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-2xs text-muted-foreground"
            >
              <CalendarDays className="size-3" aria-hidden="true" />
              All day: <span className="text-foreground">{event.title}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {ordered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm leading-relaxed text-muted-foreground">
          {day === today
            ? 'Nothing is planned for today. You do not need to finish everything — if you want a place to start, two minutes counts.'
            : 'This day is empty. You can leave it that way; a routine landing here would appear on its own.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((task) => (
            <DayTaskRow
              key={task.id}
              task={task}
              today={today}
              goalTitle={goalTitle(task.goal_id)}
              busy={busyTaskId === task.id}
              onEdit={() => onEdit(task)}
              onMove={() => onMove(task)}
              onSetStatus={(status) => onSetStatus(task, status)}
            />
          ))}
        </ul>
      )}

      <p className="text-2xs leading-relaxed text-muted-foreground">
        {tasks.some((task) => task.rescheduled_from_date !== null)
          ? 'Some of these were moved here from another day. The original plan is kept in the record, so a change of plan never reads as a failure.'
          : 'Timers and focus sessions live on Today. This screen is for the plan.'}
      </p>
    </section>
  );
}

function DayTaskRow({
  task,
  today,
  goalTitle,
  busy,
  onEdit,
  onMove,
  onSetStatus,
}: {
  task: ScheduledTask;
  today: DayKey;
  goalTitle: string | null;
  busy: boolean;
  onEdit: () => void;
  onMove: () => void;
  onSetStatus: (status: Extract<TaskStatus, 'completed' | 'skipped' | 'scheduled'>) => void;
}) {
  const isOpen = OPEN_STATUSES.includes(task.status);
  // "Scheduled" and "not done" are different statements: one is a plan, the
  // other is a day that has been and gone. The status the user reads is derived
  // from the date, never assumed from the stored status alone.
  const displayStatus = deriveTaskStatus(task.status, taskDay(task), today);

  return (
    <li
      className={cn(
        'rounded-lg border border-border bg-surface p-3 shadow-subtle transition-opacity duration-150',
        !isOpen && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium tabular-nums text-foreground">
              {task.start_time.slice(0, 5)}–{endTimeString(task.start_time, task.duration_minutes)}
            </span>
            <span className={cn('text-sm text-foreground', !isOpen && 'line-through')}>
              {task.title}
            </span>
            {task.priority === 'main' ? <Badge variant="gold">{PRIORITY_LABELS.main}</Badge> : null}
            <StatusChip status={displayStatus} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {categoryLabel(task.category)} · {task.duration_minutes} min
            {goalTitle ? ` · ${goalTitle}` : ''}
            {task.template_id ? ' · from a routine' : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isOpen ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onSetStatus('completed')} disabled={busy}>
                <Check className="size-3.5" aria-hidden="true" />
                Done
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSetStatus('skipped')} disabled={busy}>
                <CircleSlash className="size-3.5" aria-hidden="true" />
                Not today
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onSetStatus('scheduled')} disabled={busy}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Put it back
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onMove} disabled={busy}>
            <CalendarRange className="size-3.5" aria-hidden="true" />
            Move
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} disabled={busy}>
            <PencilLine className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
        </div>
      </div>
    </li>
  );
}
