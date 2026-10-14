'use client';

import { CalendarClock, Check, CircleSlash, Pencil, RotateCcw, Trash2, Undo2 } from 'lucide-react';

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
import { setTaskStatus, type ScheduledTask } from '@/lib/data/tasks';
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
  if (!item || !task) return null;

  const settled = task.status === 'completed' || task.status === 'skipped' || task.status === 'cancelled';

  async function setStatus(status: Extract<TaskStatus, 'completed' | 'skipped' | 'scheduled'>) {
    if (!task) return;
    const result = await mutate(() => setTaskStatus(supabase, task.id, status), { quiet: true });
    if (result.ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          {settled ? (
            <Button variant="outline" onClick={() => void setStatus('scheduled')}>
              <RotateCcw className="size-4" aria-hidden="true" />
              Reopen it
            </Button>
          ) : (
            <Button onClick={() => void setStatus('completed')}>
              <Check className="size-4" aria-hidden="true" />
              Mark it done
            </Button>
          )}

          {task.status === 'skipped' ? (
            <Button variant="outline" onClick={() => void setStatus('scheduled')}>
              <Undo2 className="size-4" aria-hidden="true" />
              Bring it back
            </Button>
          ) : (
            <Button variant="outline" onClick={() => void setStatus('skipped')}>
              <CircleSlash className="size-4" aria-hidden="true" />
              Set it aside
            </Button>
          )}

          <Button variant="outline" onClick={() => onMove(item)}>
            <CalendarClock className="size-4" aria-hidden="true" />
            Move it
          </Button>
          <Button variant="outline" onClick={() => onEdit(task)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit it
          </Button>
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Setting a task aside is recorded, not judged. Moving it forward is a complete answer, and neither
          removes anything you have already done.
        </p>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => onRemove(task)}>
            <Trash2 className="size-4" aria-hidden="true" />
            Remove
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
