'use client';

import { AlertTriangle, Compass, Info, Play, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DayModeResult } from '@/lib/domain/mode';
import { planningLockMessage } from '@/lib/domain/mode';
import { DAY_MODE_META } from '@/lib/domain/vocabulary';
import { dailyLine } from '@/lib/domain/messages';
import type { TodayFacts } from '@/lib/data/today';
import { cn } from '@/lib/utils';

/**
 * The top of the day.
 *
 * The greeting names the hour honestly (a 3am greeting is not "good morning"),
 * the day mode is stated rather than implied, and the one line of commentary
 * comes from the same records as the numbers below it. When there is genuinely
 * nothing worth saying, it says nothing — an empty state here is a design
 * decision, not a gap.
 */

const MODE_ICONS = { do: Play, plan: Compass, pressure: Shield } as const;

export interface TodayHeaderProps {
  facts: TodayFacts;
  greeting: string;
  /** Which weekday the user plans on, so the lock message can name it. */
  plannerDay: number;
  /** Opens the day-mode explanation. */
  onExplainMode: () => void;
}

export function TodayHeader({ facts, greeting, plannerDay, onExplainMode }: TodayHeaderProps) {
  const meta = DAY_MODE_META[facts.dayMode.mode];
  const ModeIcon = MODE_ICONS[facts.dayMode.mode];
  const commentary = dailyLine(facts.day);
  const lockMessage = planningLockMessage(facts.dayMode.mode, plannerDay);

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 font-serif text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {greeting}
        </h2>

        <button
          type="button"
          onClick={onExplainMode}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            facts.dayMode.mode === 'pressure'
              ? 'border-warning/40 bg-warning-soft text-foreground'
              : meta.planningUnlocked
                ? 'border-accent/40 bg-accent/10 text-foreground'
                : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
          )}
          aria-label={`${meta.label}. What this means.`}
        >
          <ModeIcon className="size-3.5" aria-hidden="true" />
          {meta.label}
          <Info className="size-3" aria-hidden="true" />
        </button>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        {facts.dayMode.reason}
      </p>

      {facts.dayMode.isRecoveryDay ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Today falls inside the recovery window after something demanding. A lighter day here is
          planned, not a lapse.
        </p>
      ) : null}

      {lockMessage ? (
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{lockMessage}</p>
      ) : null}

      {facts.warning ? (
        <div
          role="status"
          className="flex gap-2.5 rounded-md border border-warning/30 bg-warning-soft/60 px-3 py-2.5 text-xs leading-relaxed text-foreground"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <p>{facts.warning}</p>
            <p className="mt-1 text-muted-foreground">
              Nothing has been lost, and no records were changed.
            </p>
          </div>
        </div>
      ) : null}

      {commentary ? (
        <p className="max-w-2xl font-serif text-base italic leading-relaxed text-muted-foreground">
          {commentary}
        </p>
      ) : null}

      {facts.spanningSession ? (
        <Badge variant="muted" className="gap-1.5">
          A timer from yesterday is still open
        </Badge>
      ) : null}
    </header>
  );
}

/** The dialog behind the day-mode chip. Explains, never persuades. */
export function DayModeDetails({
  dayMode,
  onClose,
}: {
  dayMode: DayModeResult;
  onClose: () => void;
}) {
  const meta = DAY_MODE_META[dayMode.mode];
  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed">{meta.description}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{dayMode.reason}</p>
      {dayMode.pressureEvent ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {dayMode.pressureEvent.title} runs {dayMode.pressureEvent.startsOn} to{' '}
          {dayMode.pressureEvent.endsOn}.
        </p>
      ) : null}
      <p className="text-sm leading-relaxed text-muted-foreground">
        {meta.planningUnlocked
          ? 'Long-term planning is open today. You can change the week, redistribute work, and protect real rest.'
          : 'Planning is closed today so the only question left is which task to start. You can still add a quick task, edit anything, and move something urgent — nothing legitimate is blocked.'}
      </p>
      <Button variant="outline" className="w-full" onClick={onClose}>
        Understood
      </Button>
    </div>
  );
}
