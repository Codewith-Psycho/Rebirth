'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, Plus, RefreshCw, Repeat } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader, Section } from '@/components/common/page-header';
import { ErrorState, LoadingBlock, SyncBadge } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { DeleteTaskDialog } from '@/components/tasks/delete-task-dialog';
import { RescheduleDialog } from '@/components/tasks/reschedule-dialog';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { DayAvailabilityPanel } from '@/components/schedule/day-availability';
import { DayPlan } from '@/components/schedule/day-plan';
import { DayStrip } from '@/components/schedule/day-strip';
import { RoutineList } from '@/components/schedule/routine-list';
import { useScheduleApi } from '@/app/(app)/schedule/schedule-context';
import { ok } from '@/lib/data/result';
import {
  findRoutineAnchorTask,
  materialiseFrom,
  setRoutineActive,
} from '@/lib/data/schedule';
import { setTaskStatus, type ScheduledTask } from '@/lib/data/tasks';
import {
  DEFAULT_AVAILABILITY,
  blocksForDay,
  dayAvailability,
  openCountByDay,
  routineSummaries,
  taskDay,
  tasksByDay,
  upcomingDays,
  type RoutineSummary,
} from '@/lib/domain/schedule';
import type { DayKey } from '@/lib/domain/time';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import type { TaskStatus } from '@/lib/types/database';

/**
 * The schedule screen.
 *
 * It answers one question — what is my rhythm, and is there room for it — and it
 * answers it from the same rows Today and the Calendar write to. A routine here
 * is a `task_templates` row; the days below it are the `scheduled_tasks` rows
 * that template produced; the availability panel is arithmetic over those rows
 * plus the calendar's appointments. Nothing on this screen is a second copy of
 * anything.
 *
 * Two deliberate refusals:
 *   · There is no timer. Starting focus belongs to Today, where the session, the
 *     checklist and the two-minute escape live. A planning screen that can start
 *     work is a planning screen that can start work by accident.
 *   · A paused routine is not a broken one, and a full day is not a failure. The
 *     copy reports the arithmetic and leaves the decision alone.
 */

const STRIP_DAYS = 21;

type TaskDraft = {
  open: boolean;
  /** Present when editing an existing occurrence. */
  task: ScheduledTask | null;
  day: DayKey;
  startMinutes?: number;
  durationMinutes?: number;
};

const CLOSED_DRAFT: TaskDraft = { open: false, task: null, day: '' };

export function ScheduleClient() {
  const api = useScheduleApi();
  const viewer = useViewer();
  const supabase = useSupabase();
  const { facts, day, today, error, loading, sync, mutate } = api;

  const [draft, setDraft] = useState<TaskDraft>(CLOSED_DRAFT);
  const [routineDraft, setRoutineDraft] = useState<{ open: boolean; task: ScheduledTask | null }>({
    open: false,
    task: null,
  });
  const [movingTask, setMovingTask] = useState<ScheduledTask | null>(null);
  const [removingTask, setRemovingTask] = useState<ScheduledTask | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const goalTitle = useCallback(
    (goalId: string | null) => (goalId ? (facts.goalTitles.get(goalId) ?? null) : null),
    [facts.goalTitles],
  );

  const routines = useMemo(
    () => routineSummaries(facts.templates, facts.tasks, today),
    [facts.templates, facts.tasks, today],
  );

  const byDay = useMemo(() => tasksByDay(facts.tasks), [facts.tasks]);
  const counts = useMemo(() => openCountByDay(facts.tasks), [facts.tasks]);
  const days = useMemo(() => upcomingDays(today, STRIP_DAYS), [today]);

  const dayTasks = byDay.get(day) ?? [];
  const dayAllDayEvents = useMemo(
    () => facts.events.filter((event) => event.occurrenceDate === day && event.isAllDay),
    [facts.events, day],
  );

  const availability = useMemo(
    () =>
      dayAvailability(day, blocksForDay(day, facts.tasks, facts.events, viewer.timeZone), {
        ...DEFAULT_AVAILABILITY,
        deepWorkCapMinutes: viewer.preferences.deep_work_cap_minutes,
      }),
    [day, facts.tasks, facts.events, viewer.timeZone, viewer.preferences.deep_work_cap_minutes],
  );

  /* ── Routines ─────────────────────────────────────────────────────────── */

  const startNewRoutine = () => setRoutineDraft({ open: true, task: null });

  async function anchorFor(routine: RoutineSummary): Promise<ScheduledTask | null> {
    if (routine.anchorTask) return routine.anchorTask;
    const found = await findRoutineAnchorTask(supabase, routine.template.id);
    if (!found.ok) {
      toast.error(found.error);
      return null;
    }
    return found.data;
  }

  async function editRoutine(routine: RoutineSummary) {
    const anchor = await anchorFor(routine);
    if (!anchor) {
      toast.error(
        'This routine has no occurrences yet, so there is nothing to change on it. Resuming it puts its days back on the schedule.',
      );
      return;
    }
    setRoutineDraft({ open: true, task: anchor });
  }

  async function removeRoutine(routine: RoutineSummary) {
    const anchor = await anchorFor(routine);
    if (!anchor) {
      toast.error(
        'This routine has never been scheduled, so there is nothing to remove. The list above is the whole of it.',
      );
      return;
    }
    setRemovingTask(anchor);
  }

  async function togglePause(routine: RoutineSummary) {
    const resuming = routine.isPaused;
    setBusyTemplateId(routine.template.id);

    const result = await mutate(
      async () => {
        const written = await setRoutineActive(supabase, routine.template.id, resuming);
        if (!written.ok) return written;
        if (resuming) {
          // Flipping the flag is only half of it: the materialiser skips paused
          // templates, so the days have to be written back explicitly.
          const materialised = await materialiseFrom(supabase, today);
          if (!materialised.ok) return materialised;
        }
        return ok(null);
      },
      {
        success: resuming
          ? 'Resumed. Its next days are back on the schedule.'
          : 'Paused. Nothing new will be scheduled — the days already behind you are untouched.',
      },
    );

    setBusyTemplateId(null);
    if (!result.ok) return;
  }

  /* ── Tasks ────────────────────────────────────────────────────────────── */

  async function changeStatus(
    task: ScheduledTask,
    status: Extract<TaskStatus, 'completed' | 'skipped' | 'scheduled'>,
  ) {
    setBusyTaskId(task.id);
    const result = await mutate(() => setTaskStatus(supabase, task.id, status), {
      success:
        status === 'completed'
          ? 'Marked done. That is real work, recorded where it counts.'
          : status === 'skipped'
            ? 'Set aside. It will not be counted against you.'
            : 'Back on the plan.',
    });
    setBusyTaskId(null);
    if (!result.ok) return;
  }

  function openOnDay(target: DayKey) {
    api.setDay(target);
  }  /* ── Rendering ────────────────────────────────────────────────────────── */

  const emptyWindow = !loading && facts.tasks.length === 0 && facts.templates.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={day === today ? 'Today and the next three weeks' : 'Next three weeks'}
        title="Schedule"
        description="Repeating routines and your real availability, computed from the tasks and appointments you already have."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft({ open: true, task: null, day })}>
              <Plus className="size-4" aria-hidden="true" />
              Add task
            </Button>
            <Button size="sm" onClick={startNewRoutine}>
              <Repeat className="size-4" aria-hidden="true" />
              New routine
            </Button>
          </div>
        }
        meta={<SyncBadge status={sync} />}
      />

      {facts.warning ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          {facts.warning}
        </p>
      ) : null}

      {error ? (
        <ErrorState title="Your schedule did not load" message={error} onRetry={api.refresh} />
      ) : loading && facts.templates.length === 0 && facts.tasks.length === 0 ? (
        <LoadingBlock rows={4} label="Loading your routines" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-5">
            <div className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-subtle">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h2 className="font-serif text-xl font-semibold tracking-tight text-foreground">
                    The next three weeks
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    Pick a day to see its plan and what is left of it.
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => openOnDay(today)} disabled={day === today}>
                  <CalendarDays className="size-3.5" aria-hidden="true" />
                  Back to today
                </Button>
              </div>

              <DayStrip days={days} day={day} today={today} countByDay={counts} onSelect={openOnDay} />

              <p className="text-2xs leading-relaxed text-muted-foreground">
                The number under each day is how many tasks on it are still open. Zero is a fine
                number.
              </p>
            </div>

            <DayPlan
              day={day}
              today={today}
              tasks={dayTasks}
              allDayEvents={dayAllDayEvents}
              goalTitle={goalTitle}
              busyTaskId={busyTaskId}
              onEdit={(task) => setDraft({ open: true, task, day: taskDay(task) })}
              onMove={setMovingTask}
              onSetStatus={(task, status) => void changeStatus(task, status)}
            />

            <Section
              id="routines"
              title="Routines"
              description="A routine writes its own days, so you only have to decide it once. Editing one changes its pattern from here on; days you already recorded are never rewritten."
              actions={
                <Button variant="outline" size="sm" onClick={startNewRoutine}>
                  <Repeat className="size-4" aria-hidden="true" />
                  New routine
                </Button>
              }
            >
              <RoutineList
                routines={routines}
                today={today}
                goalTitle={goalTitle}
                busyTemplateId={busyTemplateId}
                onNew={startNewRoutine}
                onEdit={(routine) => void editRoutine(routine)}
                onRemove={(routine) => void removeRoutine(routine)}
                onTogglePause={(routine) => void togglePause(routine)}
              />
            </Section>

            {emptyWindow ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm leading-relaxed text-muted-foreground">
                Nothing is scheduled yet — not a problem, just a starting point. A routine is the
                lightest way to begin: pick something small, choose a rhythm, and let it appear on
                its own.
              </p>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-4">
            <DayAvailabilityPanel
              day={day}
              availability={availability}
              onUseSlot={(target, startMinutes, durationMinutes) =>
                setDraft({ open: true, task: null, day: target, startMinutes, durationMinutes })
              }
            />

            <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-xs leading-relaxed text-muted-foreground shadow-subtle">
              <p className="font-medium text-foreground">How this screen writes</p>
              <p>
                Routines live in <span className="text-foreground">task_templates</span>; each day
                they produce is a real task row. That is why a day you move keeps its own time
                without breaking the pattern, and why a routine paused here stops producing days
                without erasing the ones behind you.
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={api.refresh}>
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Reload
                </Button>
                <Link
                  href="/calendar"
                  className="text-primary underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  See this on a grid
                </Link>
              </p>
            </div>
          </aside>
        </div>
      )}

      <TaskDialog
        open={draft.open}
        onOpenChange={(open) => setDraft((current) => ({ ...current, open }))}
        task={draft.task}
        defaultDate={draft.day === '' ? day : draft.day}
        defaultStartMinutes={draft.startMinutes}
        defaultDurationMinutes={draft.durationMinutes}
        goals={facts.goals}
        mutate={mutate}
      />

      <TaskDialog
        open={routineDraft.open}
        onOpenChange={(open) => setRoutineDraft((current) => ({ ...current, open }))}
        task={routineDraft.task}
        defaultDate={today}
        defaultRepeat={routineDraft.task === null}
        defaultScope="series"
        goals={facts.goals}
        mutate={mutate}
      />

      <RescheduleDialog
        open={movingTask !== null}
        onOpenChange={(open) => {
          if (!open) setMovingTask(null);
        }}
        task={movingTask}
        day={today}
        loadByDay={counts}
        mutate={mutate}
      />

      <DeleteTaskDialog
        open={removingTask !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingTask(null);
        }}
        task={removingTask}
        defaultScope="series"
        mutate={mutate}
      />
    </div>
  );
}
