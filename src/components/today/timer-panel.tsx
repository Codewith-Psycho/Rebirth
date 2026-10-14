'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CircleStop,
  Coffee,
  Pause,
  Play,
  PlusCircle,
  Timer as TimerIcon,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  finishSession,
  pauseSession,
  resumeSession,
  startSession,
  type ScheduledTask,
} from '@/lib/data/tasks';
import { readChecklist } from '@/lib/data/settings';
import { TWO_MINUTE_SECONDS, suggestNextStep } from '@/lib/domain/timer';
import { formatStopwatch } from '@/lib/domain/time';
import { useLiveTimer } from '@/lib/hooks/use-timer';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import { useTodayApi } from '@/app/(app)/today/today-context';
import { cn } from '@/lib/utils';

/**
 * The focus timer.
 *
 * Everything visible here is a function of timestamps that were written to the
 * database when they happened. Nothing counts up in memory, which is the whole
 * reason a refresh, a locked screen or a closed tab cannot lose or invent time —
 * the numbers are recomputed from the record on every render, against a
 * server-corrected clock.
 *
 * Two deliberate design choices:
 *
 *   · **A two-minute start is not a completion.** When the two minutes are up
 *     the app asks a question rather than declaring an outcome, and whatever the
 *     answer is, the attempt is recorded as an effort session. Its kind stays
 *     `two_minute` forever, so no statistic anywhere can quietly present
 *     "I showed up" as "I finished".
 *   · **Continuing is a new session, not an extension.** Extending a two-minute
 *     row into a forty-minute one would make the record claim the attempt was
 *     something it was not. Continuing closes the attempt and opens a focus
 *     session, which is both truer and simpler to reason about.
 */

export function TimerPanel({ onAddTask }: { onAddTask?: () => void }) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const { facts, mutate, refresh } = useTodayApi();
  const [starting, setStarting] = useState<'focus' | 'two_minute' | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDone, setChecklistDone] = useState<string[]>([]);

  const openTasks = useMemo(
    () => facts.tasks.filter((task) => task.status === 'scheduled' || task.status === 'in_progress'),
    [facts.tasks],
  );
  const mainTask = openTasks.find((task) => task.priority === 'main') ?? openTasks[0] ?? null;
  const [pickedTaskId, setPickedTaskId] = useState<string | null>(null);
  const picked = openTasks.find((task) => task.id === pickedTaskId) ?? mainTask;

  const checklist = readChecklist(viewer.preferences);

  const target = targetFor(
    facts.openSession?.kind ?? 'focus',
    viewer.preferences.pomodoro_minutes,
    viewer.preferences.break_minutes,
  );
  const timer = useLiveTimer(facts.openSession, target);
  const activeTask = facts.openSession?.task_id
    ? (facts.tasks.find((task) => task.id === facts.openSession?.task_id) ?? null)
    : null;

  async function start(kind: 'focus' | 'two_minute') {
    if (!picked) return;
    setStarting(kind);
    const result = await mutate(
      () =>
        startSession(supabase, {
          taskId: picked.id,
          kind,
          plannedSeconds: kind === 'two_minute' ? TWO_MINUTE_SECONDS : null,
          replaceOpen: true,
        }),
      {
        success:
          kind === 'two_minute'
            ? 'Two minutes. That is the whole commitment.'
            : 'Timer running. Everything else can wait.',
        quiet: true,
      },
    );
    setStarting(null);
    if (result.ok) setPickedTaskId(null);
  }

  async function beginFocus() {
    setChecklistOpen(false);
    setChecklistDone([]);
    await start('focus');
  }

  return (
    <>
      <Card className={cn('overflow-hidden', timer && !timer.isRunning && 'border-accent/40')}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TimerIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Focus
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {timer ? (
            <RunningTimer
              key={timer.session.started_at}
              timer={timer}
              taskTitle={activeTask?.title ?? null}
              task={activeTask}
              onChanged={refresh}
            />
          ) : openTasks.length === 0 ? (
            <div className="space-y-2.5">
              <p className="text-sm leading-relaxed text-muted-foreground">
                A timer needs something to belong to, so that the time it records appears in your
                own statistics rather than in a loose pile.
              </p>
              {onAddTask ? (
                <Button variant="outline" size="sm" onClick={onAddTask}>
                  <PlusCircle aria-hidden="true" />
                  Add something for today
                </Button>
              ) : (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/calendar">Add something for today</Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="timer-task">What are you working on?</Label>
                <Select value={picked?.id ?? ''} onValueChange={setPickedTaskId}>
                  <SelectTrigger id="timer-task">
                    <SelectValue placeholder="Choose a task" />
                  </SelectTrigger>
                  <SelectContent>
                    {openTasks.map((task) => (
                      <SelectItem key={task.id} value={task.id}>
                        {task.priority === 'main' ? 'MAIN · ' : ''}
                        {task.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="subtle"
                  onClick={() => (checklist.length > 0 ? setChecklistOpen(true) : void start('focus'))}
                  loading={starting === 'focus'}
                  disabled={!picked}
                >
                  <Play aria-hidden="true" />
                  Start
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void start('two_minute')}
                  loading={starting === 'two_minute'}
                  disabled={!picked}
                >
                  <Zap aria-hidden="true" />
                  Start two minutes
                </Button>
              </div>

              <p className="text-xs leading-relaxed text-muted-foreground">
                Two minutes is enough. You do not need to finish anything. Start with two minutes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={checklistOpen} onOpenChange={setChecklistOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Before you start</DialogTitle>
            <DialogDescription>
              These are the things you decided were worth checking. Tick what is done — anything
              left unticked is not a problem.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2.5">
            {checklist.map((item) => {
              const id = `prefocus-${slug(item)}`;
              const checked = checklistDone.includes(item);
              return (
                <li key={item} className="flex items-start gap-2.5">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(next) =>
                      setChecklistDone((current) =>
                        next ? [...current, item] : current.filter((entry) => entry !== item),
                      )
                    }
                    className="mt-0.5"
                  />
                  <Label htmlFor={id} className="cursor-pointer leading-snug">
                    {item}
                  </Label>
                </li>
              );
            })}
          </ul>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setChecklistOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void beginFocus()} loading={starting === 'focus'}>
              <Play aria-hidden="true" />
              Begin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RunningTimer({
  timer,
  taskTitle,
  task,
  onChanged,
}: {
  timer: NonNullable<ReturnType<typeof useLiveTimer>>;
  taskTitle: string | null;
  task: ScheduledTask | null;
  onChanged: () => void;
}) {
  const supabase = useSupabase();
  const { mutate, facts } = useTodayApi();
  const [busy, setBusy] = useState<string | null>(null);

  const snapshot = timer.snapshot;
  const reachedTarget = snapshot.progress !== null && snapshot.progress >= 1;
  const isTwoMinute = timer.session.kind === 'two_minute';
  const askQuestion = reachedTarget && timer.isRunning;

  // Captured once so the closures below never have to assert their way past a
  // narrowing TypeScript cannot carry into a callback.
  const sessionId = facts.openSession?.id ?? null;
  const sessionTaskId = facts.openSession?.task_id ?? null;

  async function pause() {
    if (!sessionId) return;
    setBusy('pause');
    await mutate(() => pauseSession(supabase, sessionId), { quiet: true });
    setBusy(null);
  }

  async function resume() {
    if (!sessionId) return;
    setBusy('resume');
    await mutate(() => resumeSession(supabase, sessionId), { quiet: true });
    setBusy(null);
  }

  async function finish(options: { completeTask?: boolean; status?: 'completed' | 'abandoned' } = {}) {
    if (!sessionId) return;
    setBusy('finish');
    await mutate(
      () =>
        finishSession(supabase, {
          sessionId,
          status: options.status ?? 'completed',
          completeTask: options.completeTask ?? false,
        }),
      {
        success: options.completeTask
          ? 'Recorded, and the task is complete.'
          : 'Recorded. That time is in your history now.',
        quiet: true,
      },
    );
    setBusy(null);
    onChanged();
  }

  /** Continuing closes the two-minute attempt honestly and opens a real session. */
  async function continueAfterTwoMinutes(mode: 'focus' | 'break') {
    if (!sessionId) return;
    setBusy(mode);
    const closed = await mutate(
      () => finishSession(supabase, { sessionId, status: 'completed' }),
      { quiet: true },
    );
    if (closed.ok) {
      await mutate(
        () =>
          startSession(supabase, {
            taskId: sessionTaskId,
            kind: mode,
            replaceOpen: false,
          }),
        {
          success:
            mode === 'break'
              ? 'Break started. This counts as part of the work, not as time off it.'
              : 'Carrying on. The two minutes are recorded as their own session.',
          quiet: true,
        },
      );
    }
    setBusy(null);
    onChanged();
  }

  const seconds = snapshot.activeSeconds;
  const paused = timer.isPaused;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="truncate text-sm font-medium text-foreground">
          {taskTitle ?? 'Unassigned session'}
        </p>
        <p
          className={cn(
            'font-serif text-4xl leading-none tracking-tight tabular-nums sm:text-5xl',
            paused ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {formatStopwatch(seconds)}
        </p>

        {/* The status is announced, not just coloured. */}
        <p className="sr-only" role="status" aria-live="polite">
          {timer.description}
        </p>

        <p className="text-xs text-muted-foreground">
          {paused ? 'Paused. Nothing is being counted.' : 'Counting.'}
          {snapshot.pausedSeconds >= 60
            ? ` ${Math.round(snapshot.pausedSeconds / 60)} minutes paused so far.`
            : ''}
          {snapshot.targetSeconds !== null
            ? ` ${Math.max(0, Math.ceil((snapshot.remainingSeconds ?? 0) / 60))} minutes to the target.`
            : ''}
        </p>
      </div>

      {snapshot.progress !== null ? (
        <Progress
          value={snapshot.progress * 100}
          label={
            isTwoMinute ? 'Progress through the two-minute start' : 'Progress toward the target length'
          }
        />
      ) : null}

      {askQuestion ? (
        <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/[0.06] p-3.5">
          <p className="font-serif text-lg leading-snug text-foreground">
            {isTwoMinute ? 'Two minutes done. Continue?' : 'You reached your target. Continue?'}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isTwoMinute
              ? 'You do not have to finish anything. The attempt is already recorded, whatever you choose next.'
              : 'Nothing here has to end just because the timer did.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="subtle"
              onClick={() => void continueAfterTwoMinutes('focus')}
              loading={busy === 'focus'}
            >
              <Play aria-hidden="true" />
              Keep going
            </Button>
            {isTwoMinute ? (
              <Button
                variant="outline"
                onClick={() => void finish({ completeTask: true })}
                loading={busy === 'finish'}
              >
                It&rsquo;s finished
              </Button>
            ) : null}
            <Button
              variant="outline"
              onClick={() => void continueAfterTwoMinutes('break')}
              loading={busy === 'break'}
            >
              <Coffee aria-hidden="true" />
              Take a break
            </Button>
            {!isTwoMinute ? (
              <Button variant="outline" onClick={() => void finish()} loading={busy === 'finish'}>
                Finish
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => void finish()} loading={busy === 'finish'}>
              <CircleStop aria-hidden="true" />
              Stop and record
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {paused ? (
            <Button variant="subtle" onClick={() => void resume()} loading={busy === 'resume'}>
              <Play aria-hidden="true" />
              Resume
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void pause()} loading={busy === 'pause'}>
              <Pause aria-hidden="true" />
              Pause
            </Button>
          )}

          <Button variant="outline" onClick={() => void finish({ completeTask: true })} loading={busy === 'finish'}>
            Finish and complete the task
          </Button>

          <Button variant="ghost" onClick={() => void finish()} loading={busy === 'finish'}>
            <CircleStop aria-hidden="true" />
            Stop and record
          </Button>
        </div>
      )}

      {task && task.status !== 'completed' ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {suggestNextStep(seconds, timer.session.kind) === 'break'
            ? 'A short break now will make the next stretch easier. It is part of the work.'
            : 'However this ends, the time you just spent is real and it is recorded.'}
        </p>
      ) : null}
    </div>
  );
}

/** A compact strip for the running timer, so it stays visible while scrolling. */
export function TimerStrip() {
  const { facts } = useTodayApi();
  const viewer = useViewer();
  const target = targetFor(
    facts.openSession?.kind ?? 'focus',
    viewer.preferences.pomodoro_minutes,
    viewer.preferences.break_minutes,
  );
  const timer = useLiveTimer(facts.openSession, target);
  if (!timer) return null;

  const task = facts.openSession?.task_id
    ? facts.tasks.find((row) => row.id === facts.openSession?.task_id)
    : null;

  return (
    <div className="flex items-center gap-3 text-sm" role="status" aria-live="off">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          timer.isRunning ? 'animate-breathe bg-accent' : 'bg-muted-foreground',
        )}
      />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {task?.title ?? 'Session'}
      </span>
      <span className="shrink-0 tabular-nums text-foreground">
        {formatStopwatch(timer.snapshot.activeSeconds)}
      </span>
    </div>
  );
}

function targetFor(
  kind: string,
  pomodoroMinutes: number,
  breakMinutes: number,
): number | null {
  if (kind === 'two_minute') return TWO_MINUTE_SECONDS;
  if (kind === 'break') return Math.max(1, breakMinutes) * 60;
  if (kind === 'focus') return Math.max(1, pomodoroMinutes) * 60;
  return null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
