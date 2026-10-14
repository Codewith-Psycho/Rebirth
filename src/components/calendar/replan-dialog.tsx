'use client';

import { useMemo, useState } from 'react';
import { Coffee, MoveRight, Wand2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { rescheduleTask, type ScheduledTask } from '@/lib/data/tasks';
import { fail, ok, type Result } from '@/lib/data/result';
import type { CalendarItem } from '@/lib/domain/calendar';
import { replanDay, makeBlock, type ReplanProposal } from '@/lib/domain/scheduling';
import {
  dayKeyOf,
  instantToLocalMinutes,
  minutesToClock,
  minutesToTimeString,
  parseDayKey,
  type DayKey,
} from '@/lib/domain/time';
import { useSupabase, useTimeZone, useViewer } from '@/lib/hooks/use-viewer';
import type { Mutator } from '@/components/tasks/types';

/**
 * "Replan my day", as a proposal.
 *
 * The whole point is that this dialog *changes nothing*. It shows where the
 * remaining work would go, says plainly what does not fit, and waits. Only the
 * button writes, and the writes are one move per task so the result is exactly
 * what was on screen.
 *
 * It runs to eight hours from now or the end of the day, whichever comes first,
 * and it keeps the MAIN first — a replan is not a reshuffle.
 */

const LATEST_END_MINUTES = 23 * 60;
const HOURS_AHEAD = 8;

export interface ReplanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  day: DayKey;
  items: CalendarItem[];
  tasks: ScheduledTask[];
  now: Date;
  mutate: Mutator;
}

export function ReplanDialog({
  open,
  onOpenChange,
  day,
  items,
  tasks,
  now,
  mutate,
}: ReplanDialogProps) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const timeZone = useTimeZone();
  const [busy, setBusy] = useState(false);

  const proposal: ReplanProposal | null = useMemo(() => {
    if (!open) return null;

    const nowMinutes = dayKeyOf(now, timeZone) === day ? instantToLocalMinutes(now, timeZone) : 8 * 60;

    const todayItems = items.filter((item) => item.date === day);
    const byId = new Map(tasks.map((task) => [task.id, task]));

    const remaining = todayItems
      .filter((item) => item.kind === 'task' && !item.isTerminal)
      .map((item) => ({
        id: item.sourceId,
        title: item.title,
        durationMinutes: Math.max(5, item.minutes),
        priority: item.priority,
        originalStartMinutes: instantToLocalMinutes(item.start, timeZone),
      }))
      .filter((task) => byId.has(task.id));

    // Anything with a fixed time is routed around rather than moved: an
    // appointment is not a suggestion.
    const fixedBlocks = todayItems
      .filter((item) => item.kind === 'event' && !item.isAllDay && !item.isTerminal)
      .map((item) =>
        makeBlock({
          id: item.id,
          title: item.title,
          startMinutes: instantToLocalMinutes(item.start, timeZone),
          endMinutes: instantToLocalMinutes(item.end, timeZone),
          priority: 'other',
          isFixed: true,
        }),
      );

    const dayEndMinutes = Math.min(LATEST_END_MINUTES, nowMinutes + HOURS_AHEAD * 60);

    return replanDay({
      remaining,
      fixedBlocks,
      nowMinutes,
      dayEndMinutes,
      breakMinutes: viewer.preferences.break_minutes,
      deepWorkCapMinutes: viewer.preferences.deep_work_cap_minutes,
    });
  }, [open, day, items, tasks, now, timeZone, viewer.preferences]);

  async function apply(): Promise<void> {
    if (!proposal) return;
    const moves = proposal.assignments.filter((assignment) => assignment.moved);
    if (moves.length === 0) {
      onOpenChange(false);
      return;
    }

    setBusy(true);
    const result = await mutate(
      () => applyMoves(moves),
      {
        success: `Moved ${moves.length} ${moves.length === 1 ? 'task' : 'tasks'} to the times you saw.`,
      },
    );
    setBusy(false);
    if (result.ok) onOpenChange(false);
  }

  /** Applies each move; reports the failures rather than swallowing them. */
  async function applyMoves(
    moves: Array<{ id: string; startMinutes: number }>,
  ): Promise<Result<null>> {
    const failures: string[] = [];
    for (const move of moves) {
      const outcome = await rescheduleTask(
        supabase,
        move.id,
        day,
        minutesToTimeString(move.startMinutes),
        'occurrence',
      );
      if (!outcome.ok) failures.push(outcome.error);
    }
    if (failures.length > 0) {
      return fail(
        failures.length === moves.length
          ? `None of the moves were saved. ${failures[0] ?? ''}`.trim()
          : `${failures.length} of ${moves.length} moves were not saved. ${failures[0] ?? ''}`.trim(),
      );
    }
    return ok(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-4 text-accent" aria-hidden="true" />
            A proposal for {parseDayKey(day).toDateString()}
          </DialogTitle>
          <DialogDescription>
            Nothing has changed yet. This is where the rest of today could go, if it helps.
          </DialogDescription>
        </DialogHeader>

        {proposal === null ? null : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">{proposal.summary}</p>

            {proposal.assignments.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                There is nothing left that needs moving. Enjoy what is left of the day.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {proposal.assignments.map((assignment) => (
                  <li
                    key={assignment.id}
                    className="flex items-baseline gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">{assignment.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {minutesToClock(assignment.startMinutes)}–{minutesToClock(assignment.endMinutes)}
                    </span>
                    {assignment.moved ? (
                      <Badge variant="muted" className="shrink-0 gap-1">
                        <MoveRight className="size-3" aria-hidden="true" />
                        moved
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0">
                        stays
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {proposal.breaksInserted > 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coffee className="size-3.5" aria-hidden="true" />
                {proposal.breaksInserted} {proposal.breaksInserted === 1 ? 'break' : 'breaks'} left in place
                after each long stretch.
              </p>
            ) : null}

            {proposal.unplaced.length > 0 ? (
              <div className="rounded-md border border-border bg-muted/25 px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">
                  {proposal.unplaced.length} {proposal.unplaced.length === 1 ? 'task does' : 'tasks do'} not fit
                </p>
                <ul className="mt-1 space-y-0.5">
                  {proposal.unplaced.map((task) => (
                    <li key={task.id} className="text-xs text-muted-foreground">
                      {task.title} · {task.durationMinutes}m
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Leaving them out is the honest answer. Move one to another day, or keep it here and take it
                  as it comes.
                </p>
              </div>
            ) : null}

            {proposal.capNotice ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{proposal.capNotice}</p>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Leave it as it is
          </Button>
          <Button
            onClick={() => void apply()}
            loading={busy}
            disabled={proposal === null || proposal.assignments.every((assignment) => !assignment.moved)}
          >
            Use this plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
