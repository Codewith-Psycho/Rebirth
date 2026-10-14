'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Plus, RefreshCw, Wand2 } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { ErrorState, LoadingBlock, SyncBadge } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/tasks/confirm-dialog';
import { DeleteTaskDialog } from '@/components/tasks/delete-task-dialog';
import { RescheduleDialog } from '@/components/tasks/reschedule-dialog';
import { TaskDialog } from '@/components/tasks/task-dialog';
import { AgendaPanel } from '@/components/calendar/agenda-panel';
import { EventDialog } from '@/components/calendar/event-dialog';
import { MonthGrid } from '@/components/calendar/month-grid';
import { ReplanDialog } from '@/components/calendar/replan-dialog';
import { TaskActionsDialog } from '@/components/calendar/task-actions-dialog';
import { CalendarToolbar } from '@/components/calendar/toolbar';
import { TimeGrid } from '@/components/calendar/week-grid';
import { useCalendarApi } from '@/app/(app)/calendar/calendar-context';
import {
  moveEventOccurrence,
  shiftEventOccurrence,
  type CalendarEvent,
} from '@/lib/data/calendar';
import { fail, ok, type Result } from '@/lib/data/result';
import { rescheduleTask, type ScheduledTask } from '@/lib/data/tasks';
import {
  EMPTY_FILTER,
  applyFilter,
  groupItemsByDay,
  masterForItem,
  slotDateForItem,
  type CalendarItem,
  type ItemFilter,
} from '@/lib/domain/calendar';
import { daysInRange, rangeLabel, shiftAnchor } from '@/lib/domain/calendar-range';
import { intervalsForSessions } from '@/lib/domain/intervals';
import { overlaps } from '@/lib/domain/scheduling';
import {
  instantToLocalMinutes,
  minutesToTimeString,
  type DayKey,
} from '@/lib/domain/time';
import { useSupabase, useTimeZone, useViewer } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';

/**
 * The calendar screen.
 *
 * Everything on it is one of two records — a `scheduled_tasks` row or a
 * `calendar_events` row — read through the shared window and written back
 * through the same data functions every other screen uses. There is no calendar
 * copy of anything, which is why an edit here shows up on Today without a sync
 * step and why the same task cannot exist twice.
 *
 * Drag-and-drop is a shortcut, never the only route: dropping an item asks about
 * an overlap before it lands, and every chip opens a dialog where the same move
 * is available with the keyboard.
 */

interface PendingMove {
  item: CalendarItem;
  day: DayKey;
  /** `null` keeps the item's own time of day — the month grid's behaviour. */
  startMinutes: number | null;
  conflicts: CalendarItem[];
}

interface EventDraft {
  open: boolean;
  item: CalendarItem | null;
  day: DayKey;
  startMinutes: number | null;
}

export function CalendarClient() {
  const api = useCalendarApi();
  const viewer = useViewer();
  const timeZone = useTimeZone();
  const supabase = useSupabase();

  const [filter, setFilter] = useState<ItemFilter>({ ...EMPTY_FILTER });
  const [draft, setDraft] = useState<EventDraft>({
    open: false,
    item: null,
    day: api.today,
    startMinutes: null,
  });
  const [openItem, setOpenItem] = useState<CalendarItem | null>(null);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [movingTask, setMovingTask] = useState<ScheduledTask | null>(null);
  const [removingTask, setRemovingTask] = useState<ScheduledTask | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);

  const { facts, view, anchor, range, clock, today, error, loading, sync, mutate } = api;

  const filtered = useMemo(() => applyFilter(facts.items, filter), [facts.items, filter]);
  const itemsByDay = useMemo(() => groupItemsByDay(filtered), [filtered]);
  const days = useMemo(() => daysInRange(range), [range]);
  const label = rangeLabel(view, anchor, range);
  const showsToday = days.includes(today);

  /** Minutes actually tracked against each task item, from stored timestamps. */
  const trackedByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const interval of intervalsForSessions(facts.sessions, facts.pauses, clock)) {
      if (!interval.taskId) continue;
      const key = `task:${interval.taskId}`;
      map.set(key, (map.get(key) ?? 0) + interval.seconds / 60);
    }
    return map;
  }, [facts.sessions, facts.pauses, clock]);

  const taskById = useMemo(() => {
    const map = new Map<string, ScheduledTask>();
    for (const task of facts.tasks) map.set(task.id, task);
    return map;
  }, [facts.tasks]);

  const taskFor = (item: CalendarItem | null): ScheduledTask | null =>
    item && item.kind === 'task' ? (taskById.get(item.sourceId) ?? null) : null;

  /** How many items the window holds, so "nothing here" can say so honestly. */
  const hiddenByFilter = facts.items.length - filtered.length;

  function openItemDialog(item: CalendarItem) {
    if (item.kind === 'event') {
      setDraft({ open: true, item, day: item.date, startMinutes: null });
      return;
    }
    setOpenItem(item);
  }

  function quickAdd(day: DayKey, startMinutes: number | null = null) {
    setDraft({ open: true, item: null, day, startMinutes });
  }

  /** Items already occupying the slot a move is heading for. */
  function conflictsFor(
    day: DayKey,
    startMinutes: number,
    endMinutes: number,
    ignoreId: string,
  ): CalendarItem[] {
    return (itemsByDay.get(day) ?? []).filter((other) => {
      if (other.id === ignoreId || other.isAllDay || other.status === 'cancelled') return false;
      return overlaps(
        {
          startMinutes: instantToLocalMinutes(other.start, timeZone),
          endMinutes: instantToLocalMinutes(other.end, timeZone),
        },
        { startMinutes, endMinutes },
      );
    });
  }

  /**
   * The one entry point for every move, whether it came from a drop or a dialog.
   *
   * An overlap is never silently created and never silently refused: the move
   * waits for a yes, and the yes is available.
   */
  function requestMove(item: CalendarItem, day: DayKey, startMinutes: number | null) {
    const start = startMinutes ?? instantToLocalMinutes(item.start, timeZone);
    const end = start + Math.max(item.minutes, item.isAllDay ? 1440 : 5);
    const conflicts = conflictsFor(day, start, end, item.id);
    if (conflicts.length === 0) {
      void performMove({ item, day, startMinutes, conflicts: [] });
      return;
    }
    setPendingMove({ item, day, startMinutes, conflicts });
  }

  async function performMove(move: PendingMove): Promise<Result<unknown>> {
    const { item, day, startMinutes } = move;

    if (item.kind === 'task') {
      const task = taskFor(item);
      if (!task) {
        toast.error('That task is no longer in this window. Reloading will bring it back if it still exists.');
        return ok(null);
      }
      const time = startMinutes === null ? null : minutesToTimeString(startMinutes);
      return mutate(() => rescheduleTask(supabase, task.id, day, time, 'occurrence'), {
        success: task.template_id
          ? 'Moved just this occurrence. The rest of the routine keeps its own days.'
          : 'Moved to the new day.',
      });
    }

    const master: CalendarEvent | null = masterForItem(item, facts.masters);
    if (!master) {
      toast.error('That event is no longer in this window. Reloading will bring it back if it still exists.');
      return ok(null);
    }

    const slot = slotDateForItem(item, facts.events);
    const span = { startsAt: item.start.toISOString(), endsAt: item.end.toISOString() };

    if (item.isAllDay) {
      return mutate(
        () => shiftEventOccurrence(supabase, viewer.userId, master, slot, day, span),
        { success: 'Moved to the new day, still all day.' },
      );
    }

    const start = startMinutes ?? instantToLocalMinutes(item.start, timeZone);
    return mutate(
      () =>
        moveEventOccurrence(
          supabase,
          viewer.userId,
          master,
          slot,
          day,
          minutesToTimeString(start),
          minutesToTimeString(start + Math.max(5, item.minutes)),
        ),
      {
        success:
          master.recurrence === 'none'
            ? 'Moved.'
            : 'Moved this occurrence. The rest of the series is unchanged.',
      },
    );
  }

  /** Opens the right moving dialog for an item, wherever it was clicked. */
  function startMove(item: CalendarItem) {
    if (item.kind === 'task') {
      const task = taskFor(item);
      if (task) {
        setMovingTask(task);
        return;
      }
    }
    setDraft({ open: true, item, day: item.date, startMinutes: null });
  }

  const gridProps = {
    today,
    days,
    itemsByDay,
    trackedByItem,
    onSelectItem: openItemDialog,
  };

  const busyEmpty = !loading && filtered.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={showsToday ? 'Everything planned' : label}
        title="Calendar"
        description="Month, week and day views of the same records that Today and Schedule write to."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setReplanOpen(true)}>
              <Wand2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Replan my day</span>
              <span className="sr-only sm:hidden">Replan my day</span>
            </Button>
            <Button size="sm" onClick={() => quickAdd(anchor)}>
              <Plus className="size-4" aria-hidden="true" />
              Add
            </Button>
          </div>
        }
      />

      <CalendarToolbar
        view={view}
        onViewChange={api.setView}
        label={label}
        onPrev={() => api.setAnchor(shiftAnchor(view, anchor, -1))}
        onNext={() => api.setAnchor(shiftAnchor(view, anchor, 1))}
        onToday={api.goToToday}
        today={showsToday && anchor === today}
        filter={filter}
        onFilterChange={setFilter}
        goals={facts.goals}
        sync={sync}
        loading={loading}
        onQuickAdd={() => quickAdd(anchor)}
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
        <ErrorState
          title="The calendar could not be loaded"
          message={error}
          onRetry={api.refresh}
        />
      ) : loading && facts.items.length === 0 ? (
        <LoadingBlock rows={5} label="Loading your calendar" />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            {view === 'month' ? (
              <MonthGrid
                {...gridProps}
                periods={facts.periods}
                anchor={anchor}
                weekStartsOn={viewer.preferences.week_starts_on}
                onSelectDay={(day) => api.setAnchor(day)}
                onQuickAdd={(day) => quickAdd(day)}
                onMoveItem={(itemId, day) => {
                  const item = facts.items.find((entry) => entry.id === itemId);
                  if (item) requestMove(item, day, null);
                }}
              />
            ) : (
              <TimeGrid
                {...gridProps}
                now={clock}
                days={view === 'day' ? [anchor] : days}
                onSelectDay={(day) => {
                  api.setView('day');
                  api.setAnchor(day);
                }}
                onQuickAdd={(day, minutes) => quickAdd(day, minutes)}
                onMoveItem={(itemId, day, minutes) => {
                  const item = facts.items.find((entry) => entry.id === itemId);
                  if (item) requestMove(item, day, minutes);
                }}
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Legend />
              {hiddenByFilter > 0 ? (
                <p className="text-2xs text-muted-foreground">
                  {hiddenByFilter} {hiddenByFilter === 1 ? 'item is' : 'items are'} hidden by your filters.
                </p>
              ) : null}
              <Button variant="ghost" size="sm" onClick={api.refresh}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Reload
              </Button>
            </div>

            {busyEmpty ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm leading-relaxed text-muted-foreground">
                Nothing falls in this {view}. That is not a problem to fix — use the arrows to look elsewhere, or
                add something and it will appear here.
              </p>
            ) : null}
          </div>

          <aside aria-label="Agenda" className="min-w-0">
            <AgendaPanel
              day={today}
              items={filtered}
              periods={facts.periods}
              trackedByItem={trackedByItem}
              onSelectItem={openItemDialog}
              onMoveItem={startMove}
            />
          </aside>
        </div>
      )}

      <EventDialog
        open={draft.open}
        onOpenChange={(open) => setDraft((current) => ({ ...current, open }))}
        item={draft.item}
        masters={facts.masters}
        occurrences={facts.events}
        goals={facts.goals}
        defaultDay={draft.day}
        defaultStartMinutes={draft.startMinutes}
        mutate={mutate}
      />

      <TaskActionsDialog
        open={openItem !== null}
        onOpenChange={(open) => {
          if (!open) setOpenItem(null);
        }}
        item={openItem}
        task={taskFor(openItem)}
        today={today}
        mutate={mutate}
        onEdit={(task) => {
          setOpenItem(null);
          setEditingTask(task);
        }}
        onMove={(item) => {
          setOpenItem(null);
          startMove(item);
        }}
        onRemove={(task) => {
          setOpenItem(null);
          setRemovingTask(task);
        }}
      />

      <TaskDialog
        open={editingTask !== null}
        onOpenChange={(open) => {
          if (!open) setEditingTask(null);
        }}
        task={editingTask}
        defaultDate={editingTask?.scheduled_date ?? anchor}
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
        mutate={mutate}
      />

      <DeleteTaskDialog
        open={removingTask !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingTask(null);
        }}
        task={removingTask}
        mutate={mutate}
      />

      <ReplanDialog
        open={replanOpen}
        onOpenChange={setReplanOpen}
        day={today}
        items={facts.items}
        tasks={facts.tasks}
        now={clock}
        mutate={mutate}
      />

      <ConfirmDialog
        open={pendingMove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingMove(null);
        }}
        title="That time is already taken"
        description={
          pendingMove
            ? `${pendingMove.conflicts.length} ${
                pendingMove.conflicts.length === 1 ? 'thing is' : 'things are'
              } already in that slot: ${pendingMove.conflicts
                .map((entry) => entry.title)
                .slice(0, 3)
                .join(', ')}${pendingMove.conflicts.length > 3 ? '…' : ''}. You can still move it — overlapping is your call, not the app's.`
            : ''
        }
        confirmLabel="Move it anyway"
        confirmIcon={<ChevronRight className="size-4" aria-hidden="true" />}
        onConfirm={() => {
          const move = pendingMove;
          if (!move) return Promise.resolve(fail('Nothing to move.'));
          return performMove(move);
        }}
        onConfirmed={() => setPendingMove(null)}
      />
    </div>
  );
}

/**
 * The legend.
 *
 * The grids encode status in three ways at once — glyph, opacity and a written
 * status inside the chip's screen-reader label — so this is a reminder rather
 * than the only key.
 */
function Legend() {
  const entries: Array<{ label: string; className: string }> = [
    { label: 'Planned', className: 'bg-muted' },
    { label: 'Done', className: 'bg-success/60' },
    { label: 'Set aside', className: 'bg-border' },
    { label: 'Not done', className: 'bg-muted-foreground/40' },
  ];

  return (
    <ul className="flex flex-wrap items-center gap-3">
      {entries.map((entry) => (
        <li key={entry.label} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className={cn('size-2 rounded-sm', entry.className)} aria-hidden="true" />
          {entry.label}
        </li>
      ))}
    </ul>
  );
}
