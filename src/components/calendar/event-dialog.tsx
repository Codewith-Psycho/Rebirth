'use client';

import { useEffect, useState } from 'react';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarCheck, CalendarX, Repeat, RotateCcw, Trash2 } from 'lucide-react';

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
import { ConfirmDialog } from '@/components/tasks/confirm-dialog';
import type { Mutator } from '@/components/tasks/types';
import type { Goal } from '@/lib/data/goals';
import {
  cancelEventOccurrence,
  createEvent,
  deleteEvent,
  isRecurringMaster,
  setEventStatus,
  setOccurrenceStatus,
  updateEventSeries,
  upsertEventOccurrence,
  type CalendarEvent,
} from '@/lib/data/calendar';
import type { CalendarOccurrence } from '@/lib/domain/recurrence';
import { weekdayShort } from '@/lib/domain/recurrence';
import {
  masterForItem,
  occurrenceForItem,
  type CalendarItem,
} from '@/lib/domain/calendar';
import {
  addDaysToKey,
  dayKeyOf,
  formatInstant,
  minutesToClock,
  type DayKey,
} from '@/lib/domain/time';
import { CATEGORY_META, CATEGORY_ORDER, EVENT_KIND_LABELS } from '@/lib/domain/vocabulary';
import { useSupabase, useTimeZone, useViewer } from '@/lib/hooks/use-viewer';
import { fail } from '@/lib/data/result';
import { eventSchema, type EventValues } from '@/lib/validation/schemas';
import type { EventKind, EventStatus, RecurrenceKind } from '@/lib/types/database';
import { cn } from '@/lib/utils';

/**
 * Creating and editing a calendar event.
 *
 * Three questions this dialog refuses to answer on the user's behalf:
 *
 *   · **How far does the change reach?** Editing one Thursday and editing every
 *     Thursday are different intentions, so a recurring event asks.
 *   · **Does this occurrence count as done, or the whole series?** Marking one
 *     occurrence complete writes an exception row for that slot; the series
 *     definition itself is never overwritten, so no completed history moves.
 *   · **Delete or set aside?** Removing one occurrence of a series cancels that
 *     slot and leaves every other one alone.
 *
 * Tasks are edited by the task dialog — this one opens for events, so a task
 * opened on the calendar shows its own controls rather than a copy of them.
 */

const KIND_ORDER: EventKind[] = [
  'appointment',
  'deadline',
  'exam',
  'interview',
  'competition',
  'personal',
  'celebration',
  'travel',
  'other',
];

const RECURRENCE_OPTIONS: Array<{ value: RecurrenceKind; label: string }> = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Monday to Friday' },
  { value: 'weekends', label: 'Saturday and Sunday' },
  { value: 'custom_weekly', label: 'Chosen days' },
];

const REMINDER_OPTIONS = [
  { value: 'none', label: 'No reminder' },
  { value: '0', label: 'At the start time' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
];

const SCOPE_OPTIONS: Array<{ value: 'occurrence' | 'series'; label: string; explanation: string }> = [
  {
    value: 'occurrence',
    label: 'Only this one',
    explanation: 'Every other occurrence keeps exactly what it has now.',
  },
  {
    value: 'series',
    label: 'The whole series',
    explanation:
      'One change to the pattern itself. Occurrences you have already moved keep their own time, and nothing already recorded is rewritten.',
  },
];

export interface EventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The event being edited. Absent when creating. */
  item?: CalendarItem | null;
  /** Every event row loaded for the visible window, used to find the series. */
  masters: CalendarEvent[];
  /** Every expanded occurrence loaded for the visible window. */
  occurrences: CalendarOccurrence[];
  goals: Goal[];
  /** Where a new event lands. */
  defaultDay: DayKey;
  /** Pre-fills the start time when the grid was clicked. */
  defaultStartMinutes?: number | null;
  mutate: Mutator;
}

export function EventDialog({
  open,
  onOpenChange,
  item = null,
  masters,
  occurrences,
  goals,
  defaultDay,
  defaultStartMinutes = null,
  mutate,
}: EventDialogProps) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const timeZone = useTimeZone();

  const editing = item !== null;
  const master = editing ? masterForItem(item, masters) : null;
  const occurrence = editing ? occurrenceForItem(item, occurrences) : null;

  const seriesRecurring = master !== null && isRecurringMaster(master);
  const slotDate = occurrence?.occurrenceDate ?? item?.date ?? defaultDay;
  const isException = occurrence?.isException ?? false;

  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [recurrence, setRecurrence] = useState<RecurrenceKind>('none');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const form = useForm<EventValues>({
    resolver: zodResolver(eventSchema) as unknown as Resolver<EventValues>,
    defaultValues: defaultsFor(item, defaultDay, defaultStartMinutes, timeZone),
  });

  const allDay = form.watch('is_all_day');

  // Re-seed whenever the dialog opens on a different item — a form that keeps
  // the previous event's values is the classic way to overwrite the wrong row.
  useEffect(() => {
    if (!open) return;
    form.reset(defaultsFor(item, defaultDay, defaultStartMinutes, timeZone));
    setScope('occurrence');
    setConfirmDelete(false);
    setRecurrence(master && isRecurringMaster(master) ? master.recurrence : 'none');
    setWeekdays(master?.weekdays ?? []);
    // `master` is derived from `item` and `masters`, both of which are in deps.
  }, [open, item, defaultDay, defaultStartMinutes, master, timeZone, form]);

  async function onSubmit(values: EventValues) {
    const payload: EventValues = {
      ...values,
      recurrence,
      weekdays: recurrence === 'custom_weekly' ? weekdays : [],
      recurrence_ends_on: recurrence === 'none' ? null : values.recurrence_ends_on,
    };

    setBusy(true);
    try {
      if (!editing) {
        const result = await mutate(() => createEvent(supabase, viewer.userId, payload, timeZone), {
          quiet: true,
        });
        if (result.ok) close();
        return;
      }

      if (master === null) {
        return;
      }

      // An occurrence that has already diverged, or one belonging to a series,
      // is written as its own row so the series definition stays intact.
      const writeOccurrence = scope === 'occurrence' && (isException || isRecurringMaster(master));

      const result = await mutate(
        () =>
          writeOccurrence
            ? upsertEventOccurrence(supabase, viewer.userId, master, slotDate, payload, timeZone)
            : updateEventSeries(supabase, master.id, payload, timeZone),
        { quiet: true },
      );
      if (result.ok) close();
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: Extract<EventStatus, 'scheduled' | 'completed'>) {
    if (!editing || !item) return;
    setBusy(true);
    try {
      const span = { startsAt: item.start.toISOString(), endsAt: item.end.toISOString() };
      const result = await mutate(
        () => {
          if (isException) return setEventStatus(supabase, item.sourceId, status);
          if (master && isRecurringMaster(master)) {
            return setOccurrenceStatus(supabase, viewer.userId, master, slotDate, span, status);
          }
          if (!master) return setEventStatus(supabase, item.sourceId, status);
          return setEventStatus(supabase, master.id, status);
        },
        { quiet: true },
      );
      if (result.ok) close();
    } finally {
      setBusy(false);
    }
  }

  function close() {
    onOpenChange(false);
    form.reset();
  }

  const errors = form.formState.errors;
  const isCompleted = item?.status === 'completed';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Nothing here is permanent — the date, the time and the length can all change later.'
                : 'A title and a start is enough. Everything else can wait until you know it.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="event-title">What is it?</Label>
              <Input
                id="event-title"
                autoFocus
                placeholder="Statistics lecture"
                aria-invalid={errors.title ? true : undefined}
                {...form.register('title')}
              />
              <FieldError message={errors.title?.message} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="event-description">Notes (optional)</Label>
              <Textarea
                id="event-description"
                rows={2}
                placeholder="Room, what to bring, anything worth remembering"
                {...form.register('description')}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-muted/25 px-3 py-2.5">
              <div>
                <Label htmlFor="event-allday" className="cursor-pointer">
                  All day
                </Label>
                <p className="text-xs text-muted-foreground">
                  For birthdays, deadlines and anything without a time.
                </p>
              </div>
              <Controller
                control={form.control}
                name="is_all_day"
                render={({ field }) => (
                  <Switch
                    id="event-allday"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-start-date">Starts</Label>
                <Input
                  id="event-start-date"
                  type="date"
                  aria-invalid={errors.start_date ? true : undefined}
                  {...form.register('start_date')}
                />
                <FieldError message={errors.start_date?.message} />
              </div>

              {!allDay ? (
                <div className="space-y-1.5">
                  <Label htmlFor="event-start-time">Start time</Label>
                  <Input
                    id="event-start-time"
                    type="time"
                    aria-invalid={errors.start_time ? true : undefined}
                    {...form.register('start_time')}
                  />
                  <FieldError message={errors.start_time?.message} />
                </div>
              ) : (
                <div className="hidden sm:block" />
              )}

              <div className="space-y-1.5">
                <Label htmlFor="event-end-date">Ends</Label>
                <Input
                  id="event-end-date"
                  type="date"
                  aria-invalid={errors.end_date ? true : undefined}
                  {...form.register('end_date')}
                />
                <FieldError message={errors.end_date?.message} />
              </div>

              {!allDay ? (
                <div className="space-y-1.5">
                  <Label htmlFor="event-end-time">End time</Label>
                  <Input
                    id="event-end-time"
                    type="time"
                    aria-invalid={errors.end_time ? true : undefined}
                    {...form.register('end_time')}
                  />
                  <FieldError message={errors.end_time?.message} />
                </div>
              ) : (
                <div className="hidden sm:block" />
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="event-kind">Kind</Label>
                <Controller
                  control={form.control}
                  name="kind"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="event-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_ORDER.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {EVENT_KIND_LABELS[kind]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-category">Category</Label>
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="event-category">
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
                <Label htmlFor="event-priority">Priority</Label>
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="event-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="secondary">Secondary</SelectItem>
                        <SelectItem value="main">MAIN — the one thing</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="event-location">Where (optional)</Label>
                <Input id="event-location" placeholder="Room 4B" {...form.register('location')} />
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="event-goal">Linked goal (optional)</Label>
                <Controller
                  control={form.control}
                  name="goal_id"
                  render={({ field }) => (
                    <Select
                      value={field.value ?? 'none'}
                      onValueChange={(value) => field.onChange(value === 'none' ? null : value)}
                    >
                      <SelectTrigger id="event-goal">
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
                  An exam or a deadline attached to a goal shows up in that goal&rsquo;s timeline.
                </p>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="event-reminder">Reminder</Label>
                <Controller
                  control={form.control}
                  name="reminder_minutes"
                  render={({ field }) => (
                    <Select
                      value={field.value === null || field.value === undefined ? 'none' : String(field.value)}
                      onValueChange={(value) => field.onChange(value === 'none' ? null : Number(value))}
                    >
                      <SelectTrigger id="event-reminder">
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
                  In-app only, never during your quiet hours, and never repeated.
                </p>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center gap-2.5">
                <Repeat className="size-4 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <Label htmlFor="event-recurrence">Repeats</Label>
                  <p className="text-xs text-muted-foreground">
                    Occurrences appear on every matching day until you stop them.
                  </p>
                </div>
                <div className="w-40 shrink-0">
                  <Select value={recurrence} onValueChange={(value) => setRecurrence(value as RecurrenceKind)}>
                    <SelectTrigger id="event-recurrence">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RECURRENCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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

              {recurrence !== 'none' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="event-recurrence-end">Until (optional)</Label>
                  <Input
                    id="event-recurrence-end"
                    type="date"
                    aria-invalid={errors.recurrence_ends_on ? true : undefined}
                    {...form.register('recurrence_ends_on')}
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave this empty for a series that keeps going, and stop it whenever you like.
                  </p>
                  <FieldError message={errors.recurrence_ends_on?.message} />
                </div>
              ) : null}
            </div>

            {editing && seriesRecurring ? (
              <fieldset className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <legend className="px-1 text-sm font-medium text-foreground">How far should this reach?</legend>
                <RadioGroup
                  value={scope}
                  onValueChange={(value) => setScope(value as 'occurrence' | 'series')}
                  className="space-y-2"
                >
                  {SCOPE_OPTIONS.map((option) => (
                    <div key={option.value} className="flex gap-2.5">
                      <RadioGroupItem value={option.value} id={`event-scope-${option.value}`} className="mt-0.5" />
                      <div className="min-w-0">
                        <Label htmlFor={`event-scope-${option.value}`} className="cursor-pointer">
                          {option.label}
                        </Label>
                        <p className="text-xs leading-relaxed text-muted-foreground">{option.explanation}</p>
                      </div>
                    </div>
                  ))}
                </RadioGroup>
              </fieldset>
            ) : null}

            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
              {editing ? (
                <div className="flex flex-wrap gap-2">
                  {isCompleted ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void changeStatus('scheduled')}
                    >
                      <RotateCcw className="size-4" aria-hidden="true" />
                      Reopen
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void changeStatus('completed')}
                    >
                      <CalendarCheck className="size-4" aria-hidden="true" />
                      Mark as done
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    {seriesRecurring && scope === 'occurrence' ? 'Remove this one' : 'Delete'}
                  </Button>
                </div>
              ) : (
                <span />
              )}

              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={close}>
                  Cancel
                </Button>
                <Button type="submit" loading={form.formState.isSubmitting || busy}>
                  {editing ? 'Save changes' : 'Add event'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={
          seriesRecurring && scope === 'occurrence' ? 'Remove this occurrence?' : 'Delete this event?'
        }
        description={
          seriesRecurring && scope === 'occurrence'
            ? 'Only this day is removed. The rest of the series stays exactly as it is.'
            : seriesRecurring
              ? 'The whole series is removed. Anything already recorded stays in your history.'
              : 'This removes the event. If it is linked to a goal, the goal itself is untouched.'
        }
        confirmLabel={seriesRecurring && scope === 'occurrence' ? 'Remove it' : 'Delete'}
        confirmIcon={
          seriesRecurring && scope === 'occurrence' ? (
            <CalendarX className="size-4" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )
        }
        onConfirm={() =>
          mutate(
            () => {
              if (!master) {
                return Promise.resolve(fail('That event is no longer loaded. Reopen it from the calendar.'));
              }
              return seriesRecurring && scope === 'occurrence'
                ? cancelEventOccurrence(supabase, viewer.userId, master, slotDate)
                : deleteEvent(supabase, master.id);
            },
            { quiet: true },
          )
        }
        onConfirmed={close}
      />
    </>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-muted-foreground">
      {message}
    </p>
  );
}

/** Form defaults read straight off the item, so a save round-trips exactly. */
function defaultsFor(
  item: CalendarItem | null,
  defaultDay: DayKey,
  defaultStartMinutes: number | null,
  timeZone: string,
): EventValues {
  if (item) {
    const startTime = formatInstant(item.start, timeZone, 'HH:mm');
    const endTime = formatInstant(item.end, timeZone, 'HH:mm');
    const endDay = dayKeyOf(item.end, timeZone);
    return {
      title: item.title,
      description: item.description ?? '',
      kind: item.eventKind ?? 'appointment',
      category: item.category,
      priority: item.priority,
      goal_id: item.goalId,
      is_all_day: item.isAllDay,
      start_date: item.date,
      start_time: item.isAllDay ? '00:00' : startTime,
      // All-day events are stored as [start 00:00, the day after the last day),
      // so the inclusive end date the form shows is one day before the stored
      // instant. Writing it back reproduces exactly the same span.
      end_date: item.isAllDay ? laterDayOf(addDaysToKey(endDay, -1), item.date) : endDay,
      end_time: item.isAllDay ? '23:59' : endTime,
      location: item.location ?? '',
      reminder_minutes: null,
      recurrence: 'none',
      weekdays: [],
      recurrence_ends_on: null,
    };
  }

  const startMinutes = defaultStartMinutes ?? 9 * 60;
  const endMinutes = Math.min(startMinutes + 60, 24 * 60 - 1);

  return {
    title: '',
    description: '',
    kind: 'appointment',
    category: 'personal',
    priority: 'secondary',
    goal_id: null,
    is_all_day: false,
    start_date: defaultDay,
    start_time: minutesToClock(startMinutes),
    end_date: defaultDay,
    end_time: minutesToClock(endMinutes),
    location: '',
    reminder_minutes: null,
    recurrence: 'none',
    weekdays: [],
    recurrence_ends_on: null,
  };
}

function laterDayOf(a: DayKey, b: DayKey): DayKey {
  return a >= b ? a : b;
}
