'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, CalendarRange, Clock, SquareStack } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { rescheduleTask, type EditScope, type ScheduledTask } from '@/lib/data/tasks';
import { addDaysToKey, endTimeString, humanDay, longDay, type DayKey } from '@/lib/domain/time';
import { useSupabase } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';
import type { Mutator } from './types';

/**
 * Moving a task to another day.
 *
 * Rescheduling is a *plan change*, not a failure, so nothing here is phrased as
 * recovery and nothing is guarded behind a warning. The one thing the app does
 * insist on is that a recurring task's move is scoped explicitly: "this
 * Thursday" and "every Thursday" are different intentions and guessing one on
 * the user's behalf is how a routine silently drifts.
 *
 * Completion history is untouched by any of the three scopes — the stored
 * occurrence keeps its own record and the move is written as a new position.
 */

export interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ScheduledTask | null;
  day: DayKey;
  mutate: Mutator;
  /**
   * Open-task counts for the days being offered, so the user can see how full a
   * destination already is before they commit to it.
   */
  loadByDay?: Map<DayKey, number>;
}

export function RescheduleDialog({
  open,
  onOpenChange,
  task,
  day,
  mutate,
  loadByDay,
}: RescheduleDialogProps) {
  const supabase = useSupabase();
  const [target, setTarget] = useState<DayKey>(day);
  const [time, setTime] = useState('09:00');
  const [scope, setScope] = useState<EditScope>('occurrence');
  const [busy, setBusy] = useState(false);

  const recurring = task?.template_id !== null && task?.template_id !== undefined;

  useEffect(() => {
    if (!open || !task) return;
    setTarget(task.scheduled_date === day ? addDaysToKey(day, 1) : day);
    setTime(task.start_time.slice(0, 5));
    setScope('occurrence');
  }, [open, task, day]);

  const quickTargets = useMemo(
    () => [
      { key: day, label: 'Today' },
      { key: addDaysToKey(day, 1), label: 'Tomorrow' },
      { key: addDaysToKey(day, 7), label: 'In a week' },
    ],
    [day],
  );

  async function submit() {
    if (!task) return;
    setBusy(true);
    const changedTime = time !== task.start_time.slice(0, 5);
    const result = await mutate(
      () =>
        rescheduleTask(
          supabase,
          task.id,
          target,
          changedTime ? time : null,
          recurring ? scope : 'occurrence',
        ),
      {
        success: `Moved to ${humanDay(target, day).toLowerCase()}. The original plan stays in the record, so nothing looks like a failure.`,
        quiet: true,
      },
    );
    setBusy(false);
    if (result.ok) onOpenChange(false);
  }

  const targetLoad = loadByDay?.get(target) ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move this task</DialogTitle>
          <DialogDescription>
            {task ? (
              <>
                <span className="text-foreground">{task.title}</span> is currently on{' '}
                {longDay(task.scheduled_date)}, {task.start_time.slice(0, 5)}–
                {endTimeString(task.start_time, task.duration_minutes)}.
              </>
            ) : (
              'Choose a new day.'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>New day</Label>
            <div className="flex flex-wrap gap-2">
              {quickTargets.map((option) => (
                <Button
                  key={option.key}
                  type="button"
                  size="sm"
                  variant={target === option.key ? 'subtle' : 'outline'}
                  onClick={() => setTarget(option.key)}
                >
                  <CalendarDays aria-hidden="true" />
                  {option.label}
                </Button>
              ))}
            </div>
            <Input
              type="date"
              value={target}
              onChange={(event) => setTarget(event.target.value as DayKey)}
              aria-label="New date"
            />
            <p className="text-xs text-muted-foreground">
              {longDay(target)}
              {targetLoad !== null
                ? targetLoad === 0
                  ? ' — nothing else planned yet.'
                  : ` — ${targetLoad} other ${targetLoad === 1 ? 'task' : 'tasks'} already planned.`
                : ''}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reschedule-time">Start time</Label>
            <div className="flex items-center gap-2">
              <Input
                id="reschedule-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="w-32 tabular-nums"
              />
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                <Clock className="size-3" aria-hidden="true" />
                ends {endTimeString(time, task?.duration_minutes ?? 30)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              The length stays the same. Change it in Edit if it needs to be different.
            </p>
          </div>

          {recurring ? (
            <fieldset className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <legend className="px-1 inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                <SquareStack className="size-3.5 text-muted-foreground" aria-hidden="true" />
                This is a repeating task
              </legend>
              <RadioGroup value={scope} onValueChange={(value) => setScope(value as EditScope)} className="space-y-2">
                <ScopeOption
                  value="occurrence"
                  current={scope}
                  label="Only this one"
                  explanation="The rest of the routine stays where it is."
                />
                <ScopeOption
                  value="future"
                  current={scope}
                  label="This one and all that follow"
                  explanation="Future occurrences move too. Days already completed keep their own record."
                />
                <ScopeOption
                  value="series"
                  current={scope}
                  label="Every occurrence, past and future"
                  explanation="The routine itself changes. What you already recorded is never rewritten."
                />
              </RadioGroup>
            </fieldset>
          ) : null}

          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="tabular-nums">
              {humanDay(task?.scheduled_date ?? day, day)}
            </span>
            <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="tabular-nums text-foreground">{humanDay(target, day)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!task}>
            Move it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopeOption({
  value,
  current,
  label,
  explanation,
}: {
  value: EditScope;
  current: EditScope;
  label: string;
  explanation: string;
}) {
  return (
    <div className="flex gap-2.5">
      <RadioGroupItem value={value} id={`reschedule-scope-${value}`} className="mt-0.5" />
      <div className="min-w-0">
        <Label
          htmlFor={`reschedule-scope-${value}`}
          className={cn('cursor-pointer', current === value && 'text-foreground')}
        >
          {label}
        </Label>
        <p className="text-xs leading-relaxed text-muted-foreground">{explanation}</p>
      </div>
    </div>
  );
}
