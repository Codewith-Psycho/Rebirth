'use client';

import { CalendarClock, CirclePause, CirclePlay, PencilLine, Repeat, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { categoryLabel } from '@/lib/domain/vocabulary';
import type { RoutineSummary } from '@/lib/domain/schedule';
import { endTimeString, humanDay, longDay, type DayKey } from '@/lib/domain/time';
import { cn } from '@/lib/utils';

/**
 * The routines, as they are actually stored.
 *
 * Every line on a card is read from the template row — the repeat pattern is
 * written by the same `describeRecurrence` the editor uses, and the count of
 * finished days comes from real occurrences rather than a running total kept in
 * the browser. Nothing here is reconstructed from a cached summary, which is why
 * editing a routine on another device changes this card within seconds.
 *
 * Actions are deliberately few. A routine has one job — turn up — and the ways to
 * change it (edit, pause, remove) are the only ones that do not quietly rewrite
 * what already happened.
 */

export interface RoutineListProps {
  routines: RoutineSummary[];
  today: DayKey;
  goalTitle: (goalId: string | null) => string | null;
  onEdit: (routine: RoutineSummary) => void;
  onRemove: (routine: RoutineSummary) => void;
  onTogglePause: (routine: RoutineSummary) => void;
  /** The template currently mid-write, so its own controls can show it. */
  busyTemplateId: string | null;
  onNew: () => void;
}

export function RoutineList({
  routines,
  today,
  goalTitle,
  onEdit,
  onRemove,
  onTogglePause,
  busyTemplateId,
  onNew,
}: RoutineListProps) {
  if (routines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface/60 px-5 py-6 text-center">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-muted/40">
          <Repeat className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="mt-3 font-serif text-lg font-semibold text-foreground">No routines yet</p>
        <p className="mx-auto mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
          A routine is for the things you want to happen on a rhythm — study sessions, practice,
          winding down. It appears on its own days without you re-adding it every week.
        </p>
        <Button className="mt-4" size="sm" onClick={onNew}>
          <Repeat className="size-4" aria-hidden="true" />
          New routine
        </Button>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {routines.map((routine) => (
        <RoutineCard
          key={routine.template.id}
          routine={routine}
          today={today}
          goalTitle={goalTitle(routine.template.goal_id)}
          busy={busyTemplateId === routine.template.id}
          onEdit={() => onEdit(routine)}
          onRemove={() => onRemove(routine)}
          onTogglePause={() => onTogglePause(routine)}
        />
      ))}
    </ul>
  );
}

function RoutineCard({
  routine,
  today,
  goalTitle,
  busy,
  onEdit,
  onRemove,
  onTogglePause,
}: {
  routine: RoutineSummary;
  today: DayKey;
  goalTitle: string | null;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onTogglePause: () => void;
}) {
  const { template } = routine;
  const end = endTimeString(template.start_time, template.duration_minutes);
  const finished = routine.endedOn !== null && !routine.isPaused;

  return (
    <li className="rounded-lg border border-border bg-surface p-4 shadow-subtle">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'font-medium text-foreground',
                (routine.isPaused || finished) && 'text-muted-foreground',
              )}
            >
              {template.title}
            </span>
            {template.priority === 'main' ? <Badge variant="gold">MAIN</Badge> : null}
            {routine.isPaused ? <Badge variant="outline">Paused</Badge> : null}
            {finished ? <Badge variant="outline">Finished</Badge> : null}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            <span className="tabular-nums text-foreground">
              {template.start_time.slice(0, 5)}–{end}
            </span>{' '}
            · {routine.description} · {categoryLabel(template.category)}
            {goalTitle ? ` · ${goalTitle}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
            <PencilLine className="size-3.5" aria-hidden="true" />
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onTogglePause} disabled={busy} loading={busy}>
            {routine.isPaused ? (
              <CirclePlay className="size-3.5" aria-hidden="true" />
            ) : (
              <CirclePause className="size-3.5" aria-hidden="true" />
            )}
            {routine.isPaused ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            disabled={busy}
            className="text-muted-foreground"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3">
        <p className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <CalendarClock className="size-3" aria-hidden="true" />
          {routine.nextDays.length === 0 ? (
            routine.isPaused ? (
              'Paused — nothing new will be scheduled until you resume it.'
            ) : finished ? (
              `This routine ended on ${longDay(routine.endedOn ?? today)}.`
            ) : (
              'No days fall inside the next four weeks.'
            )
          ) : (
            <>Next: {routine.nextDays.map((day) => humanDay(day, today)).join(', ')}</>
          )}
        </p>

        {routine.occurrences > 0 ? (
          <p className="text-2xs text-muted-foreground tabular-nums">
            {routine.occurrences} {routine.occurrences === 1 ? 'day' : 'days'} ahead
            {routine.completed > 0 ? ` · ${routine.completed} done` : ''}
          </p>
        ) : null}

        {routine.hasOverrides ? (
          <p className="text-2xs text-muted-foreground">
            Some days were changed by hand. They keep their own times; this card describes the
            routine itself.
          </p>
        ) : null}
      </div>
    </li>
  );
}
