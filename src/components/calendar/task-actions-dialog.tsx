'use client';

import { useState } from 'react';
import {
  CalendarClock,
  Check,
  CircleSlash,
  Pencil,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusChip } from '@/components/common/status-chip';
import { setTaskStatus, startSession, type ScheduledTask } from '@/lib/data/tasks';
import type { CalendarItem } from '@/lib/domain/calendar';
import { formatDuration, formatInstant, humanDay, type DayKey } from '@/lib/domain/time';
import { CATEGORY_META } from '@/lib/domain/vocabulary';
import { useSupabase, useTimeZone } from '@/lib/hooks/use-viewer';
import type { Mutator } from '@/components/tasks/types';
import type { TaskStatus } from '@/lib/types/database';

/**
 * What a task looks like when it is opened from the calendar.
 *
 * Deliberately the same actions as everywhere else — done, set aside, move,
 * edit, remove — because a task reached through the calendar is the same record
 * it is on Today. Choosing "set aside" here is not a failure state: it is the
 * honest way to say "not this one, not now", and it stays in the history.
 */

export interface TaskActionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: CalendarItem | null;
  task: ScheduledTask | null;
  today: DayKey;
  mutate: Mutator;
  onEdit: (task: ScheduledTask) => void;
  onMove: (item: CalendarItem) => void;
  onRemove: (task: ScheduledTask) => void;
}

export function TaskActionsDialog({
  open,
  onOpenChange,
  item,
  task,
  today,
  mutate,
  onEdit,
  onMove,
  onRemove,
}: TaskActionsDialogProps) {
  const supabase = useSupabase();
  const timeZone = useTimeZone();
  const [busy, setBusy] = useState<'start' | 'done' | 'reopen' | 'skip' | null>(null);
  if (!item || !task) return null;

  const canStart = task.status === 'scheduled';
  const canReopen = task.status !== 'scheduled' && task.status !== 'in_progress';
  const canSkip = task.status !== 'skipped';

  async function setStatus(
    status: Extract<TaskStatus, 'completed' | 'skipped' | 'scheduled'>,
    action: 'done' | 'reopen' | 'skip',
  ) {
    if (!task) return;
    setBusy(action);
    const result = await mutate(() => setTaskStatus(supabase, task.id, status), {
      success:
        status === 'completed'
          ? 'Marked done. That is part of your record now.'
          : status === 'skipped'
            ? 'Set aside. It stays in your history.'
            : 'Back in the plan.',
    });
    setBusy(null);
    if (result.ok) onOpenChange(false);
  }

  /**
   * Starting from the calendar uses the same timer as Today, and does not
   * silently displace an open one: the database refuses, and the explanation
   * is shown rather than a second timer quietly replacing the first.
   */
  async function start() {
    if (!task) return;
    setBusy('start');
    const result = await mutate(
      () => startSession(supabase, { taskId: task.id, kind: 'focus', replaceOpen: false }),
      { success: 'Timer started. You can follow it on Today.' },
    );
    setBusy(null);
    if (result.ok) onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy !== null) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-6">{item.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              <p className="tabular-nums">
                {humanDay(item.date, today)} · {formatInstant(item.start, timeZone, 'HH:mm')}–
                {formatInstant(item.end, timeZone, 'HH:mm')} · {formatDuration(item.minutes)}
              </p>
              <p className="flex flex-wrap items-center gap-2">
                <span>{CATEGORY_META[item.category].label}</span>
                {item.goalTitle ? <span>· {item.goalTitle}</span> : null}
                {item.isRecurring ? <span>· part of a routine</span> : null}
                <StatusChip status={task.status} />
              </p>
              {item.description ? (
                <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          {canStart ? (
            <Button loading={busy === 'start'} disabled={busy !== null} onClick={() => void start()}>
              <Play className="size-4" aria-hidden="true" />
              Start working
            </Button>
          ) : null}

          {!canReopen ? (
            <Button
              variant={canStart ? 'outline' : 'default'}
              loading={busy === 'done'}
              disabled={busy !== null}
              onClick={() => void setStatus('completed', 'done')}
            >
              <Check className="size-4" aria-hidden="true" />
              Mark it done
            </Button>
          ) : null}

          {canReopen ? (
            <Button
              variant="outline"
              loading={busy === 'reopen'}
              disabled={busy !== null}
              onClick={() => void setStatus('scheduled', 'reopen')}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {task.status === 'skipped' ? 'Bring it back' : 'Reopen it'}
            </Button>
          ) : null}

          {canSkip ? (
            <Button
              variant="outline"
              loading={busy === 'skip'}
              disabled={busy !== null}
              onClick={() => void setStatus('skipped', 'skip')}
            >
              <CircleSlash className="size-4" aria-hidden="true" />
              Set it aside
            </Button>
          ) : null}

          <Button variant="outline" disabled={busy !== null} onClick={() => onMove(item)}>
            <CalendarClock className="size-4" aria-hidden="true" />
            Move it
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => onEdit(task)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit it
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Starting records real time against this task. Setting it aside is recorded, not judged,
          and neither removes anything you have already done.
        </p>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" disabled={busy !== null} onClick={() => onRemove(task)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
