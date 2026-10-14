'use client';

import { useCallback, useMemo, useState } from 'react';
import { Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/common/page-header';
import { ErrorState, SyncBadge } from '@/components/common/states';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { RescheduleDialog } from '@/components/tasks/reschedule-dialog';
import { DeleteTaskDialog } from '@/components/tasks/delete-task-dialog';
import { MicroStepsDialog } from '@/components/tasks/micro-steps-dialog';
import { DayMetrics } from '@/components/today/day-metrics';
import { DayModeDetails, TodayHeader } from '@/components/today/today-header';
import { DayTimeline } from '@/components/today/day-timeline';
import { TaskList } from '@/components/today/task-list';
import { TimerPanel } from '@/components/today/timer-panel';
import { EnergyCheckIn, ReflectionCard } from '@/components/today/check-in';
import { QuoteCard, QuoteUnavailable } from '@/components/today/quote-card';
import type { ScheduledTask } from '@/lib/data/tasks';
import { completionFor } from '@/lib/domain/completion';
import { intervalsForSessions } from '@/lib/domain/intervals';
import { greetingFor } from '@/lib/domain/mode';
import { formatInstant, longDay, type DayKey } from '@/lib/domain/time';
import type { CompletionMessage } from '@/lib/domain/messages';
import type { GoalMeasurement } from '@/lib/types/database';
import { useViewer } from '@/lib/hooks/use-viewer';
import { useTodayApi } from './today-context';

/**
 * The Today screen.
 *
 * One snapshot in, one screen out. Everything below reads the same `facts`
 * object, so the metrics, the list and the timeline are incapable of disagreeing
 * with each other — and because that object is rebuilt by the same loader after
 * every write, a change made here is reflected everywhere at once rather than
 * being patched in optimistically and hoped for.
 *
 * The completion narration is the one piece of app voice on this screen. It is
 * assembled from the facts that were actually recorded for the task being
 * completed — minutes tracked, the routine's usual pace, what it means for a
 * linked goal — and it refuses to say anything the records do not support.
 */

export function TodayClient() {
  const viewer = useViewer();
  const { facts, clock, error, refreshing, sync, refresh, mutate } = useTodayApi();

  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: ScheduledTask | null }>({
    open: false,
    task: null,
  });
  const [reschedule, setReschedule] = useState<ScheduledTask | null>(null);
  const [remove, setRemove] = useState<ScheduledTask | null>(null);
  const [stuck, setStuck] = useState<ScheduledTask | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [celebration, setCelebration] = useState<{ message: CompletionMessage } | null>(null);

  const goalMeasurements = useMemo(
    () => new Map<string, GoalMeasurement>(facts.goals.map((goal) => [goal.id, goal.measurement])),
    [facts.goals],
  );

  /*
   * Minutes tracked per task today, taken from the reconstructed session
   * intervals rather than from any running counter — a paused session therefore
   * contributes only what it actually accrued.
   */
  const trackedByTask = useMemo(() => {
    const out = new Map<string, number>();
    for (const interval of intervalsForSessions(facts.sessions, facts.pauses, clock)) {
      if (interval.taskId === null || interval.kind === 'break') continue;
      out.set(interval.taskId, (out.get(interval.taskId) ?? 0) + interval.seconds / 60);
    }
    for (const [taskId, seconds] of out) out.set(taskId, Math.round(seconds));
    return out;
  }, [facts.sessions, facts.pauses, clock]);

  const loadByDay = useMemo(() => {
    const counts = new Map<DayKey, number>();
    for (const task of facts.tasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      counts.set(task.scheduled_date, (counts.get(task.scheduled_date) ?? 0) + 1);
    }
    // Each move re-loads the day's window, so the map is rebuilt from records
    // rather than adjusted in place.
    for (const task of facts.carriedOver) {
      counts.set(task.scheduled_date, (counts.get(task.scheduled_date) ?? 0) + 1);
    }
    return counts;
  }, [facts.tasks, facts.carriedOver]);

  const handleCompleted = useCallback(
    (task: ScheduledTask) => {
      const message = completionFor({
        task,
        day: facts.day,
        now: clock,
        todayTasks: facts.tasks,
        todaySessions: facts.sessions,
        historyTasks: facts.historyTasks,
        historySessions: facts.historySessions,
        goalMeasurements,
        goalTitles: facts.goalTitles,
        progress: facts.progress,
      });
      setCelebration({ message });
    },
    [facts, clock, goalMeasurements],
  );

  const openNewTask = useCallback(() => setTaskDialog({ open: true, task: null }), []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={longDay(facts.day)}
        title="Today"
        actions={
          <div className="flex items-center gap-2">
            <SyncBadge status={sync} />
            <Button onClick={openNewTask}>
              <Plus aria-hidden="true" />
              Add a task
            </Button>
          </div>
        }
        meta={refreshing ? 'Checking for changes…' : null}
      />

      <TodayHeader
        facts={facts}
        greeting={greetingFor(Number(formatInstant(clock, viewer.timeZone, 'H')))}
        plannerDay={viewer.preferences.planner_day}
        onExplainMode={() => setModeOpen(true)}
      />

      {error ? (
        <ErrorState
          title="The day could not be refreshed"
          message={`${error} Nothing you recorded has been lost, and anything already saved is still there.`}
          onRetry={refresh}
        />
      ) : null}

      <DayMetrics summary={facts.summary} />

      <section aria-labelledby="timeline-heading" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="timeline-heading" className="font-serif text-lg font-semibold tracking-tight">
            The shape of the day
          </h2>
          <p className="text-xs text-muted-foreground">Planned and tracked, on the same clock</p>
        </div>
        <Card>
          <CardContent className="p-3 sm:p-4">
            <DayTimeline
              day={facts.day}
              timeZone={facts.timeZone}
              now={clock}
              items={facts.items}
              sessions={facts.sessions}
              pauses={facts.pauses}
              microSteps={facts.microSteps}
            />
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          <TaskList
            day={facts.day}
            tasks={facts.tasks}
            carriedOver={facts.carriedOver}
            cap={viewer.preferences.daily_task_cap}
            microSteps={facts.microSteps}
            trackedByTask={trackedByTask}
            goalTitles={facts.goalTitles}
            openSessionTaskId={facts.openSession?.task_id ?? null}
            timerRunning={facts.openSession?.status === 'running'}
            mutate={mutate}
            onAdd={openNewTask}
            onEdit={(task) => setTaskDialog({ open: true, task })}
            onReschedule={setReschedule}
            onDelete={setRemove}
            onStuck={setStuck}
            onCompleted={handleCompleted}
            onReopened={() => undefined}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <TimerPanel onAddTask={openNewTask} />
          <EnergyCheckIn day={facts.day} logs={facts.energy} mutate={mutate} />
          <ReflectionCard day={facts.day} reflection={facts.reflection} mutate={mutate} />
          {facts.quote ? (
            <QuoteCard quote={facts.quote} mutate={mutate} />
          ) : (
            <QuoteUnavailable
              message={
                viewer.preferences.quotes_enabled
                  ? null
                  : 'Motivation lines are switched off in your settings. That is a valid way to run the day.'
              }
            />
          )}
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((current) => ({ ...current, open }))}
        task={taskDialog.task}
        defaultDate={facts.day}
        goals={facts.goals}
        mutate={mutate}
      />

      <RescheduleDialog
        open={reschedule !== null}
        onOpenChange={(open) => {
          if (!open) setReschedule(null);
        }}
        task={reschedule}
        day={facts.day}
        mutate={mutate}
        loadByDay={loadByDay}
      />

      <DeleteTaskDialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
        task={remove}
        mutate={mutate}
      />

      <MicroStepsDialog
        open={stuck !== null}
        onOpenChange={(open) => {
          if (!open) setStuck(null);
        }}
        task={stuck}
        mutate={mutate}
      />

      <Dialog open={modeOpen} onOpenChange={setModeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Today&rsquo;s mode</DialogTitle>
            <DialogDescription>
              The mode decides what is open today, not what you are allowed to do.
            </DialogDescription>
          </DialogHeader>
          <DayModeDetails dayMode={facts.dayMode} onClose={() => setModeOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={celebration !== null} onOpenChange={(open) => (open ? undefined : setCelebration(null))}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2">
              <Sparkles className="mt-1 size-4 shrink-0 text-accent" aria-hidden="true" />
              {celebration?.message.headline}
            </DialogTitle>
            <DialogDescription>{celebration?.message.body}</DialogDescription>
          </DialogHeader>

          {celebration && celebration.message.basis.length > 0 ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What this is based on
              </p>
              <ul className="mt-2 space-y-1">
                {celebration.message.basis.map((line) => (
                  <li key={line} className="text-xs leading-relaxed tabular-nums text-foreground">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button variant="subtle" className="w-full" onClick={() => setCelebration(null)}>
            Carry on
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
