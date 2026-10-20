'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller, type FieldErrors, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Repeat } from 'lucide-react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { createOneOffTask, createRoutine, updateTaskWithScope, type EditScope, type ScheduledTask } from '@/lib/data/tasks';
import type { Goal } from '@/lib/data/goals';
import { CATEGORY_ORDER, CATEGORY_META } from '@/lib/domain/vocabulary';
import { weekdayShort } from '@/lib/domain/recurrence';
import { todayInZone, minutesToTimeString, type DayKey } from '@/lib/domain/time';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import { routineSchemaRefined, taskSchema, type RoutineValues, type TaskValues } from '@/lib/validation/schemas';
import type { RecurrenceKind } from '@/lib/types/database';
import { cn } from '@/lib/utils';
import type { Mutator } from './types';

/**
 * Creating and editing a task, and creating a routine.
 *
 * One dialog for both, because they are one idea: a thing to do, either once or
 * on a rhythm. Editing an *existing recurring* task adds the scope question,
 * because "change this Thursday" and "change every Thursday from now on" are
 * genuinely different intentions and the app must not pick one for the user.
 *
 * The common path — a title, a day, a start time and a length — stays at the
 * top. Notes, category, reminders and repeat settings sit in one clearly
 * secondary block below it, so creating a task never means reading a form.
 *
 * Removing history is never on offer here. A scope of "this and future" splits
 * the series — the old template is ended the day before the change, a new one
 * begins at it — so nothing already completed is ever rewritten.
 */

const DURATION_PRESETS = [15, 25, 45, 60, 90];

const REMINDER_OPTIONS = [
  { value: 'none', label: 'No reminder' },
  { value: '0', label: 'At the start time' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
];

const RECURRENCE_OPTIONS: Array<{ value: RecurrenceKind; label: string; explanation: string }> = [
  { value: 'none', label: 'Does not repeat', explanation: 'A single task on one day.' },
  { value: 'daily', label: 'Every day', explanation: 'Seven days a week.' },
  { value: 'weekdays', label: 'Monday to Friday', explanation: 'Working days only.' },
  { value: 'weekends', label: 'Saturday and Sunday', explanation: 'Weekends only.' },
  {
    value: 'custom_weekly',
    label: 'Chosen days',
    explanation: 'Pick the days below, for example Monday, Wednesday and Friday.',
  },
];

const SCOPE_OPTIONS: Array<{ value: EditScope; label: string; explanation: string }> = [
  {
    value: 'occurrence',
    label: 'Only this day',
    explanation: 'Today changes. Every other occurrence keeps the old plan.',
  },
  {
    value: 'future',
    label: 'This day and every one after',
    explanation:
      'The routine is split here: it ends before this date and a new version starts at it. Everything already completed stays exactly as it was recorded.',
  },
  {
    value: 'series',
    label: 'The whole routine',
    explanation:
      'One change for every occurrence, past and future, in what the routine *is*. Records already written are not rewritten.',
  },
];

export interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  task?: ScheduledTask | null;
  /** The day a new task lands on. */
  defaultDate: DayKey;
  goals: Goal[];
  mutate: Mutator;
  /** Pre-fills "I'm stuck" style copy when a task is created from a suggestion. */
  initialTitle?: string;
  /** Opens with "repeat this" already on — the Schedule page's entry point. */
  defaultRepeat?: boolean;
  /** Opens on a chosen scope, for a routine edited from the Schedule page. */
  defaultScope?: EditScope;
  /**
   * Pre-fills the start time (minutes since local midnight), so a slot the
   * availability panel suggested — or a blank stretch of the calendar — can be
   * accepted in one action rather than retyped, and mistyped.
   */
  defaultStartMinutes?: number;
  /** Pairs with `defaultStartMinutes` so an accepted slot keeps its length. */
  defaultDurationMinutes?: number;
}

export function TaskDialog({
  open,
  onOpenChange,
  task = null,
  defaultDate,
  goals,
  mutate,
  initialTitle,
  defaultRepeat = false,
  defaultScope = 'occurrence',
  defaultStartMinutes,
  defaultDurationMinutes,
}: TaskDialogProps) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const editing = task !== null;
  const editingRecurring = editing && task.template_id !== null;

  const [repeat, setRepeat] = useState(defaultRepeat);
  const [scope, setScope] = useState<EditScope>(defaultScope);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceKind>('daily');
  const [endsOn, setEndsOn] = useState<string>('');

  // The day may only be changed while the edit applies to this occurrence alone.
  // The split RPC treats a date on a future/series edit as a new series
  // boundary, not a move, so it must never receive one.
  const effectiveScope: EditScope = editingRecurring ? scope : 'occurrence';
  const dayLocked = editingRecurring && scope !== 'occurrence';

  const form = useForm<TaskValues>({
    resolver: zodResolver(taskSchema) as unknown as Resolver<TaskValues>,
    defaultValues: defaultsFor(task, defaultDate, defaultStartMinutes, defaultDurationMinutes),
  });

  // Re-seed whenever the dialog opens on a different task: a form that keeps the
  // previous task's values is the classic way to overwrite the wrong record.
  useEffect(() => {
    if (!open) return;
    form.reset(defaultsFor(task, defaultDate, defaultStartMinutes, defaultDurationMinutes));
    setScope(defaultScope);
    setRepeat(defaultRepeat);
    setWeekdays([]);
    setEndsOn('');
  }, [
    open,
    task,
    defaultDate,
    form,
    defaultRepeat,
    defaultScope,
    defaultStartMinutes,
    defaultDurationMinutes,
  ]);

  async function onSubmit(values: TaskValues) {
    if (editing && task) {
      const result = await mutate(
        () =>
          updateTaskWithScope(supabase, task.id, effectiveScope, {
            title: values.title,
            description: values.description ?? null,
            category: values.category,
            priority: values.priority,
            start_time: values.start_time,
            duration_minutes: values.duration_minutes,
            goal_id: values.goal_id,
            reminder_minutes: values.reminder_minutes,
            notes: values.notes ?? null,
            // The dialog shows the day, so it has to save it — but only for an
            // occurrence edit, and only when it actually changed. A future or
            // series edit must never carry a date: the RPC would read it as a
            // new series boundary.
            ...(dayLocked || values.scheduled_date === task.scheduled_date
              ? {}
              : { scheduled_date: values.scheduled_date }),
          }),
        { quiet: true },
      );
      if (result.ok) {
        onOpenChange(false);
        form.reset();
      }
      return;
    }

    if (repeat) {
      const routine: RoutineValues = {
        ...values,
        recurrence,
        weekdays: recurrence === 'custom_weekly' ? weekdays : [],
        starts_on: values.scheduled_date,
        ends_on: endsOn === '' ? null : endsOn,
      };
      const parsed = routineSchemaRefined.safeParse(routine);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        if (issue) {
          form.setError((issue.path[0] as keyof TaskValues) ?? 'title', { message: issue.message });
        }
        return;
      }

      const result = await mutate(
        () => createRoutine(supabase, viewer.userId, parsed.data),
        { quiet: true },
      );
      if (result.ok) {
        onOpenChange(false);
        form.reset();
      }
      return;
    }

    const result = await mutate(() => createOneOffTask(supabase, viewer.userId, values), {
      quiet: true,
    });
    if (result.ok) {
      onOpenChange(false);
      form.reset();
    }
  }

  // `onSubmit` validates a whole routine once "Repeat this" is on, so the error
  // bag can hold `ends_on` — a field the task schema, and therefore the form's
  // own value type, does not know about.
  const errors: FieldErrors<RoutineValues> = form.formState.errors;
  // A recurring task opened on the series-wide scope is a routine edit, and the
  // heading should say so rather than making the user work it out from the
  // radio buttons.
  const dialogTitle = !editing
    ? repeat
      ? 'New routine'
      : 'New task'
    : editingRecurring && scope === 'series'
      ? 'Edit routine'
      : 'Edit task';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A write in flight is not the moment to let Escape close the dialog
        // and make the result ambiguous.
        if (!next && form.formState.isSubmitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {editing
              ? editingRecurring
                ? 'This task is part of a routine. Choose how far the change should reach.'
                : 'Changes here apply to this task only.'
              : 'Only a title is required. The day, start time and length already have sensible defaults.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">What is it?</Label>
            <Input
              id="task-title"
              autoFocus
              placeholder={initialTitle ?? 'Read one section of chapter four'}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? 'task-title-error' : undefined}
              {...form.register('title')}
            />
            <FieldError id="task-title-error" message={errors.title?.message} />
          </div>

          {/* The fast path: a title above, then when and how long. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-date">{repeat && !editing ? 'Starts on' : 'Day'}</Label>
              {/* A Controller keeps the value in the form state even while the
                  input is disabled, so the schema still validates and an
                  occurrence edit can still submit the unchanged day. */}
              <Controller
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <Input
                    id="task-date"
                    type="date"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    disabled={dayLocked}
                    aria-invalid={errors.scheduled_date ? true : undefined}
                    aria-describedby={
                      [errors.scheduled_date ? 'task-date-error' : null, dayLocked ? 'task-date-locked' : null]
                        .filter(Boolean)
                        .join(' ') || undefined
                    }
                  />
                )}
              />
              <FieldError id="task-date-error" message={errors.scheduled_date?.message} />
              {dayLocked ? (
                <p id="task-date-locked" className="text-xs leading-relaxed text-muted-foreground">
                  To change the day, use Move. This edit applies to the routine&rsquo;s fields, not its
                  dates.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="task-time">Start time</Label>
              <Input
                id="task-time"
                type="time"
                aria-invalid={errors.start_time ? true : undefined}
                aria-describedby={errors.start_time ? 'task-time-error' : undefined}
                {...form.register('start_time')}
              />
              <FieldError id="task-time-error" message={errors.start_time?.message} />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="task-duration">How long?</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="task-duration"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={1440}
                  step={5}
                  className="w-24 tabular-nums"
                  aria-invalid={errors.duration_minutes ? true : undefined}
                  aria-describedby={errors.duration_minutes ? 'task-duration-error' : undefined}
                  {...form.register('duration_minutes')}
                />
                <span className="text-sm text-muted-foreground">minutes</span>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant="outline"
                      className="tabular-nums"
                      onClick={() =>
                        form.setValue('duration_minutes', preset, { shouldValidate: true })
                      }
                    >
                      {preset}m
                    </Button>
                  ))}
                </div>
              </div>
              <FieldError id="task-duration-error" message={errors.duration_minutes?.message} />
            </div>
          </div>

          {editingRecurring ? (
            <fieldset className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <legend className="px-1 text-sm font-medium text-foreground">How far should this reach?</legend>
              <RadioGroup
                value={scope}
                onValueChange={(value) => setScope(value as EditScope)}
                className="space-y-2"
              >
                {SCOPE_OPTIONS.map((option) => (
                  <div key={option.value} className="flex gap-2.5">
                    <RadioGroupItem value={option.value} id={`scope-${option.value}`} className="mt-0.5" />
                    <div className="min-w-0">
                      <Label htmlFor={`scope-${option.value}`} className="cursor-pointer">
                        {option.label}
                      </Label>
                      <p className="text-xs leading-relaxed text-muted-foreground">{option.explanation}</p>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            </fieldset>
          ) : null}

          <div className="space-y-4 rounded-lg border border-border bg-muted/15 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">More options</p>
              <p className="text-xs text-muted-foreground">
                Notes, category, reminders and repeat settings.
              </p>
            </div>

            {!editing ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <Repeat className="size-4 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <Label htmlFor="task-repeat" className="cursor-pointer">
                      Repeat this
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Turns it into a routine that appears on its own days.
                    </p>
                  </div>
                </div>
                <Switch id="task-repeat" checked={repeat} onCheckedChange={setRepeat} />
              </div>
            ) : null}

            {repeat && !editing ? (
              <div className="space-y-3 rounded-md border border-border bg-surface/70 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="task-recurrence">How often?</Label>
                  <Select
                    value={recurrence}
                    onValueChange={(value) => setRecurrence(value as RecurrenceKind)}
                  >
                    <SelectTrigger id="task-recurrence">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_OPTIONS.filter((option) => option.value !== 'none').map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {RECURRENCE_OPTIONS.find((option) => option.value === recurrence)?.explanation}
                  </p>
                </div>

                {recurrence === 'custom_weekly' ? (
                  <fieldset className="space-y-1.5">
                    <legend className="text-sm font-medium text-foreground">Which days?</legend>
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 0].map((index) => {
                        const active = weekdays.includes(index);
                        return (
                          <button
                            key={index}
                            type="button"
                            aria-pressed={active}
                            onClick={() =>
                              setWeekdays((current) =>
                                current.includes(index)
                                  ? current.filter((day) => day !== index)
                                  : [...current, index],
                              )
                            }
                            className={cn(
                              'min-h-9 min-w-9 rounded-md border px-2 text-xs transition-colors duration-150',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              active
                                ? 'border-primary bg-primary/10 font-medium text-primary'
                                : 'border-border bg-surface text-muted-foreground hover:bg-muted',
                            )}
                          >
                            {weekdayShort(index)}
                          </button>
                        );
                      })}
                    </div>
                    {weekdays.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Choose at least one day.</p>
                    ) : null}
                  </fieldset>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="task-ends-on">Ends on (optional)</Label>
                  <Input
                    id="task-ends-on"
                    type="date"
                    aria-invalid={errors.ends_on ? true : undefined}
                    aria-describedby={errors.ends_on ? 'task-ends-on-error' : undefined}
                    value={endsOn}
                    onChange={(event) => setEndsOn(event.target.value)}
                  />
                  <FieldError id="task-ends-on-error" message={errors.ends_on?.message} />
                  <p className="text-xs text-muted-foreground">
                    Leave this empty and the routine keeps going.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="task-description">Notes (optional)</Label>
              <Textarea
                id="task-description"
                rows={2}
                placeholder="What does done look like?"
                {...form.register('description')}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="task-category">Category</Label>
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="task-category">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORY_ORDER.map((category) => (
                          <SelectItem key={category} value={category}>
                            {CATEGORY_META[category].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="task-priority">Priority</Label>
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="task-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="secondary">Secondary</SelectItem>
                        <SelectItem value="main">MAIN — the one thing</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  There is one MAIN per day. Naming a second one replaces the first.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="task-goal">Linked goal (optional)</Label>
                <Controller
                  control={form.control}
                  name="goal_id"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? 'none'}
                      onValueChange={(value) => field.onChange(value === 'none' ? null : value)}
                    >
                      <SelectTrigger id="task-goal">
                        <SelectValue placeholder="No goal" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No goal</SelectItem>
                        {goals.map((goal) => (
                          <SelectItem key={goal.id} value={goal.id}>
                            {goal.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Linking a task is what lets the goal show real completed work rather than an estimate.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="task-reminder">Reminder</Label>
                <Controller
                  control={form.control}
                  name="reminder_minutes"
                  render={({ field }) => (
                    <Select
                      value={field.value === null || field.value === undefined ? 'none' : String(field.value)}
                      onValueChange={(value) => field.onChange(value === 'none' ? null : Number(value))}
                    >
                      <SelectTrigger id="task-reminder">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REMINDER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  In-app only, and never during your quiet hours.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={form.formState.isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {editing ? 'Save changes' : repeat ? 'Create routine' : 'Add task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

function defaultsFor(
  task: ScheduledTask | null,
  defaultDate: DayKey,
  defaultStartMinutes?: number,
  defaultDurationMinutes?: number,
): TaskValues {
  if (task) {
    return {
      title: task.title,
      description: task.description ?? '',
      category: task.category,
      priority: task.priority,
      scheduled_date: task.scheduled_date,
      start_time: task.start_time.slice(0, 5),
      duration_minutes: task.duration_minutes,
      goal_id: task.goal_id,
      reward_id: task.reward_id,
      reminder_minutes: task.reminder_minutes,
      checklist: Array.isArray(task.checklist) ? (task.checklist as string[]) : [],
      notes: task.notes ?? '',
    };
  }

  return {
    title: '',
    description: '',
    category: 'study',
    priority: 'secondary',
    scheduled_date: defaultDate,
    start_time:
      defaultStartMinutes === undefined
        ? '09:00'
        : minutesToTimeString(defaultStartMinutes).slice(0, 5),
    duration_minutes: defaultDurationMinutes ?? 45,
    goal_id: null,
    reward_id: null,
    reminder_minutes: null,
    checklist: [],
    notes: '',
  };
}

/** The day a new task should land on when a screen has no better idea. */
export function defaultDayFor(timeZone: string): DayKey {
  return todayInZone(timeZone);
}
