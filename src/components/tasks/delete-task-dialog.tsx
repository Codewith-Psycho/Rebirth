'use client';

import { useEffect, useState } from 'react';
import { SquareStack, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { deleteTaskWithScope, type EditScope, type ScheduledTask } from '@/lib/data/tasks';
import { useSupabase } from '@/lib/hooks/use-viewer';
import type { Mutator } from './types';

/**
 * Removing a task, with the scope question when it repeats.
 *
 * Deleting a routine is the one place where "removing" could quietly mean
 * "rewriting history", so this dialog is explicit that completed occurrences
 * are the user's record and are not part of what gets deleted. The word used is
 * *remove*, and the confirmation explains what remains — a delete that hides
 * what already happened would make the insights screen lie.
 */

export interface DeleteTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ScheduledTask | null;
  mutate: Mutator;
  /**
   * Which scope the dialog opens on.
   *
   * Removing a routine *from the routine list* means removing the routine, so
   * that entry point starts on `series` rather than making the user answer a
   * question they have already answered by choosing where they clicked.
   */
  defaultScope?: EditScope;
}

export function DeleteTaskDialog({
  open,
  onOpenChange,
  task,
  mutate,
  defaultScope = 'occurrence',
}: DeleteTaskDialogProps) {
  const supabase = useSupabase();
  const [scope, setScope] = useState<EditScope>(defaultScope);
  const [busy, setBusy] = useState(false);

  const recurring = task?.template_id !== null && task?.template_id !== undefined;

  useEffect(() => {
    if (!open) return;
    setScope(defaultScope);
    setBusy(false);
  }, [open, defaultScope]);

  async function confirm() {
    if (!task) return;
    setBusy(true);
    const result = await mutate(
      () => deleteTaskWithScope(supabase, task.id, recurring ? scope : 'occurrence'),
      {
        success: 'Removed. Anything you already completed is still in your records.',
        quiet: true,
      },
    );
    setBusy(false);
    if (result.ok) onOpenChange(false);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this task?</AlertDialogTitle>
          <AlertDialogDescription>
            {task ? (
              <>
                <span className="text-foreground">{task.title}</span> will no longer appear on your
                schedule.
              </>
            ) : (
              'It will no longer appear on your schedule.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {recurring ? (
          <fieldset className="space-y-2">
            <legend className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <SquareStack className="size-3.5 text-muted-foreground" aria-hidden="true" />
              This repeats. What should go?
            </legend>
            <RadioGroup value={scope} onValueChange={(value) => setScope(value as EditScope)} className="space-y-2">
              <div className="flex gap-2.5">
                <RadioGroupItem value="occurrence" id="delete-scope-occurrence" className="mt-0.5" />
                <div>
                  <Label htmlFor="delete-scope-occurrence" className="cursor-pointer">
                    Only this day
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    The routine continues on all its other days.
                  </p>
                </div>
              </div>
              <div className="flex gap-2.5">
                <RadioGroupItem value="future" id="delete-scope-future" className="mt-0.5" />
                <div>
                  <Label htmlFor="delete-scope-future" className="cursor-pointer">
                    This day and everything after
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    The routine ends before this date. Earlier occurrences are untouched.
                  </p>
                </div>
              </div>
              <div className="flex gap-2.5">
                <RadioGroupItem value="series" id="delete-scope-series" className="mt-0.5" />
                <div>
                  <Label htmlFor="delete-scope-series" className="cursor-pointer">
                    The whole routine
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Nothing further will be scheduled. Everything you already completed stays in your
                    history and in your statistics.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </fieldset>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <Button variant="outline" onClick={() => void confirm()} loading={busy} disabled={!task}>
            <Trash2 aria-hidden="true" />
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
