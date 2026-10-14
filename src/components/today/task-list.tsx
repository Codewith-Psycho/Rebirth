'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, Check, Plus, Sparkles, SquareStack, SunMedium } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/common/states';
import { TaskRow, sortTasksForDay, type TaskRowProps } from '@/components/tasks/task-row';
import { capSummary, isOpenTask, mainForDay } from '@/lib/domain/limits';
import { microStepProgress } from '@/lib/domain/microsteps';
import { rescheduleTask, setMainPriority, type MicroStep, type ScheduledTask } from '@/lib/data/tasks';
import type { DayKey } from '@/lib/domain/time';
import { useSupabase } from '@/lib/hooks/use-viewer';
import type { Mutator } from '@/components/tasks/types';

/**
 * Today's list.
 *
 * Three rules are enforced here rather than merely suggested:
 *
 *   · **One MAIN.** The slot exists whether or not it is filled, so the question
 *     "what is the one thing?" is always on screen. Naming a new MAIN replaces
 *     the old one — the previous task is not demoted with a warning, it simply
 *     goes back to being a task.
 *   · **A cap on secondary tasks.** Reaching it is answered with an explanation
 *     and real options — move something, replace something, or change the cap —
 *     never a disabled button and never a telling-off. The number comes from the
 *     user's own preference, so the app never argues with them about what a full
 *     day is.
 *   · **Nothing shames.** Completed work sits at the bottom, closed by default;
 *     skipped work is grey; a task left open from last week is offered back
 *     rather than flagged as overdue.
 */

export interface TaskListProps {
  day: DayKey;
  tasks: ScheduledTask[];
  carriedOver: ScheduledTask[];
  cap: number;
  microSteps: MicroStep[];
  /** Minutes tracked today, keyed by task id. */
  trackedByTask: Map<string, number>;
  goalTitles: Map<string, string>;
  openSessionTaskId: string | null;
  timerRunning: boolean;
  mutate: Mutator;
  onAdd: () => void;
  onEdit: (task: ScheduledTask) => void;
  onReschedule: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onStuck: (task: ScheduledTask) => void;
  onCompleted: (task: ScheduledTask) => void;
  onReopened: (task: ScheduledTask) => void;
}

export function TaskList({
  day,
  tasks,
  carriedOver,
  cap,
  microSteps,
  trackedByTask,
  goalTitles,
  openSessionTaskId,
  timerRunning,
  mutate,
  onAdd,
  onEdit,
  onReschedule,
  onDelete,
  onStuck,
  onCompleted,
  onReopened,
}: TaskListProps) {
  const supabase = useSupabase();
  const [showCompleted, setShowCompleted] = useState(false);

  const main = mainForDay(tasks, day);
  const capacity = capSummary(tasks, day, cap);

  const active = sortTasksForDay(
    tasks.filter(
      (task) => task.id !== main?.id && task.status !== 'completed' && task.status !== 'cancelled',
    ),
  );
  const completed = sortTasksForDay(tasks.filter((task) => task.status === 'completed'));
  const candidatesForMain = tasks.filter((task) => task.id !== main?.id && isOpenTask(task));

  /** Everything a row needs, computed per task so nothing is shared by accident. */
  function rowPropsFor(task: ScheduledTask): Omit<TaskRowProps, 'task'> {
    const steps = microSteps.filter((step) => step.task_id === task.id);
    const isOpenSession = openSessionTaskId === task.id;
    return {
      mutate,
      goalTitle: task.goal_id ? (goalTitles.get(task.goal_id) ?? null) : null,
      microProgress: steps.length > 0 ? microStepProgress(steps) : null,
      timerOpen: isOpenSession,
      timerRunning: isOpenSession && timerRunning,
      trackedMinutes: trackedByTask.get(task.id) ?? null,
      onEdit,
      onReschedule,
      onDelete,
      onStuck,
      onCompleted,
      onReopened,
    };
  }

  async function promote(task: ScheduledTask) {
    await mutate(() => rescheduleTask(supabase, task.id, day), {
      success: 'Moved to today. Nothing about the earlier record changed.',
    });
  }

  async function makeMain(taskId: string) {
    await mutate(() => setMainPriority(supabase, taskId), {
      success: 'That is the one thing now.',
    });
  }

  return (
    <div className="space-y-6">
      {/* ── MAIN ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="main-priority-heading" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="main-priority-heading" className="font-serif text-lg font-semibold tracking-tight">
            The one thing
          </h2>
          {main && candidatesForMain.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  Change
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                <DropdownMenuLabel>Make one of these the MAIN</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {candidatesForMain.map((task) => (
                  <DropdownMenuItem key={task.id} onSelect={() => void makeMain(task.id)}>
                    <Check className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{task.title}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {main ? (
          <TaskRow task={main} isMain {...rowPropsFor(main)} />
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Nothing has been named as the one thing yet.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  It does not have to be the hardest task. It only has to be the one you would feel
                  best about having started.
                </p>
              </div>
              {candidatesForMain.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="subtle" size="sm" className="shrink-0">
                      <Sparkles aria-hidden="true" />
                      Choose the MAIN
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[14rem]">
                    {candidatesForMain.map((task) => (
                      <DropdownMenuItem key={task.id} onSelect={() => void makeMain(task.id)}>
                        <span className="truncate">{task.title}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
                  <Plus aria-hidden="true" />
                  Add something first
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── The rest of the day ──────────────────────────────────────────── */}
      <section aria-labelledby="rest-of-day-heading" className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 id="rest-of-day-heading" className="font-serif text-lg font-semibold tracking-tight">
              The rest of the day
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {capacity.used} of {capacity.cap} planned
            </span>
          </div>

          {capacity.canAddSecondary ? (
            <Button variant="outline" size="sm" onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add a task
            </Button>
          ) : null}
        </div>

        {!capacity.canAddSecondary ? (
          <div className="rounded-lg border border-border bg-muted/25 p-4">
            <p className="text-sm font-medium text-foreground">
              Today is full: {capacity.used} tasks besides the main one.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {capacity.blockedReason}
            </p>

            {capacity.openTasks.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Move one to another day, or edit one into what you actually need:
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {capacity.openTasks.map((row) => {
                    const task = tasks.find((candidate) => candidate.id === row.id);
                    if (!task) return null;
                    return (
                      <li key={row.id} className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => onReschedule(task)}>
                          <CalendarClock aria-hidden="true" />
                          <span className="max-w-[9rem] truncate">{row.title}</span>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => onEdit(task)}>
                          Edit instead
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/settings">Change my daily limit</Link>
              </Button>
              <p className="self-center text-xs text-muted-foreground">
                Completing or setting one aside frees a place.
              </p>
            </div>
          </div>
        ) : null}

        {active.length === 0 ? (
          <EmptyState
            icon={SunMedium}
            title="Nothing else is planned"
            description="A short list is not an empty life. If something belongs on today, add it — otherwise this is the day as designed."
          />
        ) : (
          <ul className="space-y-2.5">
            {active.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} canBeMain {...rowPropsFor(task)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Completed ────────────────────────────────────────────────────── */}
      {completed.length > 0 ? (
        <section aria-labelledby="completed-heading" className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="completed-heading" className="font-serif text-lg font-semibold tracking-tight">
              Done today
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowCompleted((value) => !value)}>
              {showCompleted ? 'Hide' : `Show ${completed.length}`}
            </Button>
          </div>
          {showCompleted ? (
            <ul className="space-y-2.5">
              {completed.map((task) => (
                <li key={task.id}>
                  <TaskRow task={task} {...rowPropsFor(task)} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {/* ── Left open from earlier ───────────────────────────────────────── */}
      {carriedOver.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Still open from earlier</CardTitle>
            <CardDescription>
              These were planned in the last week and never completed. They are not overdue — they
              are unanswered. Bring one forward, move it, or let it go.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {carriedOver.slice(0, 8).map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{task.title}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {task.scheduled_date}
                    {task.template_id ? ' · repeating' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void promote(task)}>
                    <SquareStack aria-hidden="true" />
                    Bring to today
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onReschedule(task)}>
                    Move
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onDelete(task)}>
                    Let it go
                  </Button>
                </div>
              </div>
            ))}
            {carriedOver.length > 8 ? (
              <p className="text-xs text-muted-foreground">
                and {carriedOver.length - 8} more from earlier weeks.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
