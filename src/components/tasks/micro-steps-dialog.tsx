'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Lightbulb, RotateCcw, SkipForward, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { listMicroSteps, seedMicroSteps, setMicroStepState, type MicroStep, type ScheduledTask } from '@/lib/data/tasks';
import { MAX_MICRO_STEPS, microStepProgress, suggestMicroSteps, visibleMicroSteps } from '@/lib/domain/microsteps';
import { useSupabase } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';
import type { Mutator } from './types';

/**
 * "I'm stuck."
 *
 * The whole feature rests on one rule: **one step is visible at a time**. Four
 * visible steps is a plan, and a plan is exactly what the user is already
 * avoiding. So the suggestion is previewed in full exactly once, at the moment
 * the user is deciding whether to accept it, and after that only the next
 * unfinished step is ever on screen.
 *
 * The suggestions are deterministic — a rule engine, not a model — so the same
 * task produces the same four steps every time, offline, and the feature cannot
 * break because an API is unavailable. The steps are editable before they are
 * saved, because a suggestion the user cannot correct is a suggestion they will
 * fight.
 *
 * Skipping a step is a first-class outcome, not a lesser one. A skipped step
 * resolves just like a completed one and reveals the next, because the point is
 * to move, not to comply.
 */

export interface MicroStepsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: ScheduledTask | null;
  mutate: Mutator;
  /** Called when a step is resolved, so the host screen can refresh its counts. */
  onChanged?: () => void;
}

export function MicroStepsDialog({
  open,
  onOpenChange,
  task,
  mutate,
  onChanged,
}: MicroStepsDialogProps) {
  const supabase = useSupabase();
  const [steps, setSteps] = useState<MicroStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);

  const suggestion = useMemo(
    () =>
      task
        ? suggestMicroSteps(task.title, { description: task.description, category: task.category })
        : null,
    [task],
  );

  // Load whatever this task already has. If it has nothing, we are still in the
  // proposing phase and the draft is seeded from the rule engine.
  useEffect(() => {
    if (!open || !task) return;
    let cancelled = false;

    setLoading(true);
    setEditing(false);
    setSteps([]);

    const proposed = suggestMicroSteps(task.title, {
      description: task.description,
      category: task.category,
    });
    setDraft(proposed.steps);

    void (async () => {
      const result = await listMicroSteps(supabase, [task.id]);
      if (cancelled) return;
      if (result.ok) setSteps(result.data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, task, supabase]);

  async function acceptSuggestion() {
    if (!task) return;
    const titles = draft.map((line) => line.trim()).filter((line) => line.length > 0);
    if (titles.length === 0) return;

    setBusy('seed');
    const result = await mutate(() => seedMicroSteps(supabase, task.id, titles), {
      success: 'Here is the first step. Just that one.',
      quiet: true,
    });
    setBusy(null);
    if (result.ok) {
      setSteps(result.data);
      setEditing(false);
      onChanged?.();
    }
  }

  async function resolve(step: MicroStep, state: 'done' | 'skipped') {
    setBusy(step.id);
    const result = await mutate(() => setMicroStepState(supabase, step.id, state), {
      quiet: true,
    });
    setBusy(null);
    if (result.ok) {
      setSteps((current) => current.map((row) => (row.id === step.id ? result.data : row)));
      onChanged?.();
    }
  }

  const visible = visibleMicroSteps(steps);
  const progress = microStepProgress(steps);
  const resolvedAll = steps.length > 0 && progress.done + progress.skipped >= progress.total;
  const current = visible.at(-1) ?? null;
  const upcoming = steps.length - visible.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Let&rsquo;s make it smaller</DialogTitle>
          <DialogDescription>
            {task ? (
              <>
                <span className="text-foreground">{task.title}</span> is still the same task. This
                only changes the size of the first move.
              </>
            ) : (
              'This changes the size of the first move, not the task.'
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking whether this one already has steps&hellip;
          </p>
        ) : steps.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/20 p-3.5">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Lightbulb className="size-3.5" aria-hidden="true" />
                {suggestion?.label ?? 'General'} approach
              </p>
              {editing ? (
                <div className="mt-2.5 space-y-1.5">
                  <Label htmlFor="micro-steps-draft">
                    One step per line, up to {MAX_MICRO_STEPS}
                  </Label>
                  <Textarea
                    id="micro-steps-draft"
                    rows={MAX_MICRO_STEPS}
                    value={draft.join('\n')}
                    onChange={(event) => setDraft(event.target.value.split('\n').slice(0, MAX_MICRO_STEPS))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Each line should be small enough that starting it takes less effort than avoiding it.
                  </p>
                </div>
              ) : (
                <ol className="mt-2.5 space-y-1.5">
                  {draft.map((step, index) => (
                    <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-2xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                You&rsquo;ll see one at a time. Skipping one is fine — it moves you to the next either
                way.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditing((current) => !current)}
                disabled={busy !== null}
              >
                {editing ? <RotateCcw aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                {editing ? 'Use the suggestion as it is' : 'Change these steps'}
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy !== null}>
                  Not now
                </Button>
                <Button onClick={() => void acceptSuggestion()} loading={busy === 'seed'}>
                  Start the first step
                </Button>
              </div>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {progress.done + progress.skipped} of {progress.total} dealt with
                </span>
                {progress.skipped > 0 ? (
                  <span className="tabular-nums">{progress.skipped} skipped</span>
                ) : null}
              </div>
              <Progress value={progress.percent} label="Steps dealt with" />
            </div>

            {resolvedAll ? (
              <div className="rounded-lg border border-border bg-surface p-4">
                <p className="font-serif text-lg leading-snug text-foreground">
                  That&rsquo;s all four steps dealt with.
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  Whatever you did in there counts as effort, whether or not the task is finished.
                  Complete it if it is; leave it if it isn&rsquo;t.
                </p>
              </div>
            ) : null}

            {/* Resolved history, compact. Only the current step gets room. */}
            {visible.slice(0, -1).map((step) => (
              <div
                key={step.id}
                className="flex items-center gap-2.5 rounded-md border border-border/70 bg-muted/15 px-3 py-2 text-xs text-muted-foreground"
              >
                <Check className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                {step.state === 'skipped' ? <span className="shrink-0">skipped</span> : null}
              </div>
            ))}

            {current ? (
              <>
                <Separator />
                <div className="rounded-lg border border-accent/35 bg-surface p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">
                    Step {current.ordinal} of {progress.total}
                  </p>
                  <p className="mt-2 font-serif text-xl leading-snug text-foreground">{current.title}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="subtle"
                      onClick={() => void resolve(current, 'done')}
                      loading={busy === current.id}
                    >
                      <Check aria-hidden="true" />
                      Done
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void resolve(current, 'skipped')}
                      disabled={busy !== null}
                    >
                      <SkipForward aria-hidden="true" />
                      Skip this one
                    </Button>
                  </div>
                </div>
                {upcoming > 0 ? (
                  <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <ChevronRight className="size-3" aria-hidden="true" />
                    <span className="tabular-nums">
                      {upcoming} more {upcoming === 1 ? 'step' : 'steps'} after this one.
                    </span>
                  </p>
                ) : null}
              </>
            ) : null}

            <DialogFooter className={cn(resolvedAll && 'sm:justify-end')}>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
