'use client';

import { useState } from 'react';
import {
  CalendarClock,
  Check,
  CircleDashed,
  MoreHorizontal,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
  SquareStack,
  Timer,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusChip } from '@/components/common/status-chip';
import { categoryIconFor } from '@/components/common/category-icon';
import { setMainPriority, setTaskStatus, reopenTask, startSession } from '@/lib/data/tasks';
import type { ScheduledTask } from '@/lib/data/tasks';
import { CATEGORY_META } from '@/lib/domain/vocabulary';
import { TWO_MINUTE_SECONDS } from '@/lib/domain/timer';
import { endTimeString, formatDuration, timeToMinutes } from '@/lib/domain/time';
import { useSupabase } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';
import type { Mutator } from './types';

/**
 * One task, as a row.
 *
 * Design notes that matter more than they look:
 *
 *   · **Starting is the loudest action.** "Start" and "2 min" are the two
 *     buttons, always visible, always first. Everything destructive or
 *     administrative lives behind the overflow menu, so the path to beginning
 *     is never a menu away.
 *   · **Completing is not destructive-sounding.** The checkbox is a circle that
 *     fills; reopening is offered on exactly the same control in the same place,
 *     so an accidental completion costs one tap to undo and carries no penalty.
 *   · **Nothing here is red.** A skipped or missed task is grey. The only
 *     colour in the row is the category and, very quietly, the MAIN mark.
 */

export interface TaskRowProps {
  task: ScheduledTask;
  mutate: Mutator;
  /** Title of the linked goal, when there is one. */
  goalTitle?: string | null;
  /** Micro-step progress, when the row's screen has loaded it. */
  microProgress?: { done: number; skipped: number; total: number } | null;
  /** True while this task owns the open timer. */
  timerOpen?: boolean;
  timerRunning?: boolean;
  /** Minutes tracked against this task today, when known. */
  trackedMinutes?: number | null;
  /** Only one MAIN per day; the row can offer to become it. */
  canBeMain?: boolean;
  isMain?: boolean;
  onEdit?: (task: ScheduledTask) => void;
  onReschedule?: (task: ScheduledTask) => void;
  onDelete?: (task: ScheduledTask) => void;
  onStuck?: (task: ScheduledTask) => void;
  onStartTwoMinutes?: (task: ScheduledTask) => void;
  /** Lets the screen narrate a completion with the facts it holds. */
  onCompleted?: (task: ScheduledTask) => void;
  /** Reopening is available on completed and skipped rows alike. */
  onReopened?: (task: ScheduledTask) => void;
  className?: string;
}

export function TaskRow({
  task,
  mutate,
  goalTitle = null,
  microProgress = null,
  timerOpen = false,
  timerRunning = false,
  trackedMinutes = null,
  canBeMain = false,
  isMain = false,
  onEdit,
  onReschedule,
  onDelete,
  onStuck,
  onStartTwoMinutes,
  onCompleted,
  onReopened,
  className,
}: TaskRowProps) {
  const supabase = useSupabase();
  const [busy, setBusy] = useState(false);

  const CategoryGlyph = categoryIconFor(task.category);
  const isCompleted = task.status === 'completed';
  const isSkipped = task.status === 'skipped';
  const isCancelled = task.status === 'cancelled';
  const isOpen = task.status === 'scheduled' || task.status === 'in_progress';
  const isSettled = isCompleted || isSkipped || isCancelled;

  async function complete() {
    setBusy(true);
    const result = await mutate(() => setTaskStatus(supabase, task.id, 'completed'), {
      quiet: true,
    });
    setBusy(false);
    if (result.ok) onCompleted?.(task);
  }

  async function reopen() {
    setBusy(true);
    const result = await mutate(() => reopenTask(supabase, task.id), { quiet: true });
    setBusy(false);
    if (result.ok) onReopened?.(task);
  }

  async function start(kind: 'focus' | 'two_minute') {
    setBusy(true);
    const result = await mutate(
      () =>
        startSession(supabase, {
          taskId: task.id,
          kind,
          plannedSeconds: kind === 'two_minute' ? TWO_MINUTE_SECONDS : null,
          // Replacing an open timer is a real decision, and the row never makes
          // it silently: the user is told and the database refuses politely.
          replaceOpen: kind === 'two_minute',
        }),
      { quiet: true },
    );
    setBusy(false);
    if (result.ok) onStartTwoMinutes?.(task);
  }

  async function makeMain() {
    setBusy(true);
    await mutate(() => setMainPriority(supabase, task.id), {
      success: 'This is now the MAIN priority for the day.',
    });
    setBusy(false);
  }

  async function skip() {
    setBusy(true);
    await mutate(() => setTaskStatus(supabase, task.id, 'skipped'), {
      success: 'Set aside. It stays in the record as a deliberate choice, not a failure.',
    });
    setBusy(false);
  }

  const timeRange = `${task.start_time.slice(0, 5)}–${endTimeString(task.start_time, task.duration_minutes)}`;

  return (
    <div
      className={cn(
        'group relative flex gap-3 rounded-lg border bg-surface p-3 transition-colors duration-150 sm:p-4',
        isMain ? 'border-accent/45' : 'border-border',
        isCancelled && 'opacity-60',
        className,
      )}
    >
      {/* MAIN carries a mark and a label, never only a tint. */}
      {isMain ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent"
        />
      ) : null}

      <button
        type="button"
        onClick={isCompleted || isSkipped ? reopen : complete}
        disabled={busy || isCancelled}
        aria-label={
          isCompleted
            ? `Reopen ${task.title}`
            : isSkipped
              ? `Reopen ${task.title}`
              : `Mark ${task.title} complete`
        }
        title={isCompleted || isSkipped ? 'Reopen' : 'Mark complete'}
        className={cn(
          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          isCompleted
            ? 'border-success bg-success/15 text-success hover:bg-success/25'
            : isSkipped
              ? 'border-border bg-muted text-muted-foreground hover:bg-muted/70'
              : 'border-border text-muted-foreground/60 hover:border-accent hover:text-accent',
          'disabled:opacity-50',
        )}
      >
        {isCompleted ? (
          <Check className="size-3.5" aria-hidden="true" />
        ) : isSkipped ? (
          <Undo2 className="size-3.5" aria-hidden="true" />
        ) : (
          <CircleDashed className="size-3.5" aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p
            className={cn(
              'min-w-0 flex-1 text-sm font-medium leading-snug',
              isCompleted ? 'text-muted-foreground line-through decoration-border' : 'text-foreground',
              isCancelled && 'line-through',
            )}
          >
            {task.title}
          </p>
          {isMain ? (
            <Badge variant="gold" className="shrink-0" aria-label="MAIN priority for the day">
              MAIN
            </Badge>
          ) : null}
          {isSettled && !isCompleted ? <StatusChip status={task.status} /> : null}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Timer className="size-3" aria-hidden="true" />
            {timeRange} · {formatDuration(task.duration_minutes)}
          </span>

          <span className="inline-flex items-center gap-1">
            <CategoryGlyph className="size-3" aria-hidden="true" />
            {CATEGORY_META[task.category]?.label ?? 'Other'}
          </span>

          {goalTitle ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-accent">
              <Sparkles className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{goalTitle}</span>
            </span>
          ) : null}

          {task.template_id ? (
            <span className="inline-flex items-center gap-1">
              <SquareStack className="size-3" aria-hidden="true" />
              Repeats
            </span>
          ) : null}

          {task.rescheduled_from_date ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden="true" />
              Moved from {task.rescheduled_from_date}
            </span>
          ) : null}

          {trackedMinutes !== null && trackedMinutes > 0 ? (
            <span className="tabular-nums">{trackedMinutes}m tracked</span>
          ) : null}

          {microProgress && microProgress.total > 0 ? (
            <span className="tabular-nums">
              {microProgress.done + microProgress.skipped}/{microProgress.total} steps
            </span>
          ) : null}
        </div>

        {task.description ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {task.description}
          </p>
        ) : null}

        {isOpen ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {timerOpen ? (
              <Badge variant={timerRunning ? 'success' : 'muted'} className="gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 rounded-full', timerRunning ? 'bg-success' : 'bg-muted-foreground')}
                />
                {timerRunning ? 'Timer running' : 'Timer paused'}
              </Badge>
            ) : (
              <>
                <Button size="sm" variant="subtle" onClick={() => void start('focus')} disabled={busy}>
                  <Play aria-hidden="true" />
                  Start
                </Button>
                <Button size="sm" variant="outline" onClick={() => void start('two_minute')} disabled={busy}>
                  Two minutes
                </Button>
              </>
            )}

            {onStuck ? (
              <Button size="sm" variant="ghost" onClick={() => onStuck(task)} disabled={busy}>
                I&rsquo;m stuck
              </Button>
            ) : null}
          </div>
        ) : null}

        {isSkipped || isCompleted ? (
          <div className="mt-2.5">
            <Button size="sm" variant="ghost" onClick={() => void reopen()} disabled={busy}>
              <RotateCcw aria-hidden="true" />
              {isCompleted ? 'Reopen' : 'Put it back'}
            </Button>
          </div>
        ) : null}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={`More actions for ${task.title}`}
            disabled={busy}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-[13rem]">
          <DropdownMenuLabel className="truncate">{task.title}</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {onEdit ? (
            <DropdownMenuItem onSelect={() => onEdit(task)}>
              <Pencil className="size-4 text-muted-foreground" aria-hidden="true" />
              Edit
            </DropdownMenuItem>
          ) : null}

          {onReschedule ? (
            <DropdownMenuItem onSelect={() => onReschedule(task)}>
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden="true" />
              Move to another day
            </DropdownMenuItem>
          ) : null}

          {onStuck ? (
            <DropdownMenuItem onSelect={() => onStuck(task)}>
              <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
              I&rsquo;m stuck — break it down
            </DropdownMenuItem>
          ) : null}

          {canBeMain && !isMain && isOpen ? (
            <DropdownMenuItem onSelect={() => void makeMain()}>
              <Check className="size-4 text-muted-foreground" aria-hidden="true" />
              Make this the MAIN priority
            </DropdownMenuItem>
          ) : null}

          {isOpen ? (
            <DropdownMenuItem onSelect={() => void skip()}>
              <X className="size-4 text-muted-foreground" aria-hidden="true" />
              Set aside for today
            </DropdownMenuItem>
          ) : null}

          {isSettled && !isCancelled ? (
            <DropdownMenuItem onSelect={() => void reopen()}>
              <RotateCcw className="size-4 text-muted-foreground" aria-hidden="true" />
              Reopen
            </DropdownMenuItem>
          ) : null}

          {onDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => onDelete(task)}>
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Sorts a day's tasks into the order the screen should present them. */
export function sortTasksForDay(tasks: ScheduledTask[]): ScheduledTask[] {
  const weight = (task: ScheduledTask): number => {
    if (task.priority === 'main') return 0;
    if (task.status === 'in_progress') return 1;
    if (task.status === 'scheduled') return 2;
    if (task.status === 'completed') return 3;
    if (task.status === 'skipped') return 4;
    return 5;
  };

  return [...tasks].sort((a, b) => {
    const byWeight = weight(a) - weight(b);
    if (byWeight !== 0) return byWeight;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
}
