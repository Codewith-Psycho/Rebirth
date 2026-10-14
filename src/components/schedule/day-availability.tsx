'use client';

import { useMemo, useState } from 'react';
import { CalendarPlus, Clock, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DayAvailability } from '@/lib/domain/schedule';
import { formatHours, loadSentence } from '@/lib/domain/schedule';
import { intervalLabel, suggestSlots } from '@/lib/domain/scheduling';
import { longDay, type DayKey } from '@/lib/domain/time';
import { cn } from '@/lib/utils';

/**
 * What is actually left of a day.
 *
 * Two things this panel refuses to do. It never calls a full day a failure — a
 * full day is a choice, so the wording reports the arithmetic and then offers to
 * move something. And it never claims to know about time it cannot see: the free
 * windows are gaps between *planned* blocks, and the panel says so rather than
 * implying the user has nothing else in their life.
 *
 * Suggested slots are built from the same `suggestSlots` the replanner uses, so
 * "there is room at 14:00" means the same thing on both screens.
 */

const DURATION_CHOICES = [30, 45, 60, 90];

export interface DayAvailabilityPanelProps {
  day: DayKey;
  availability: DayAvailability;
  /** Opens the task editor pre-filled with this day and time. */
  onUseSlot: (day: DayKey, startMinutes: number, durationMinutes: number) => void;
  className?: string;
}

export function DayAvailabilityPanel({
  day,
  availability,
  onUseSlot,
  className,
}: DayAvailabilityPanelProps) {
  const [duration, setDuration] = useState(45);
  const { blocks, free, conflicts, load } = availability;

  const slots = useMemo(
    () => suggestSlots(blocks, duration, { limit: 4, dayEndMinutes: 22 * 60 }),
    [blocks, duration],
  );

  return (
    <section
      aria-label={`Availability for ${longDay(day)}`}
      className={cn('space-y-4 rounded-lg border border-border bg-surface p-4 shadow-subtle', className)}
    >
      <header className="space-y-1">
        <p className="text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Room left
        </p>
        <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground">
          {longDay(day)}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{loadSentence(availability)}</p>
      </header>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Planned" value={formatHours(load.plannedMinutes)} />
        <Stat label="Steps aside" value={formatHours(load.breakMinutes)} />
        <Stat label="Untouched" value={formatHours(load.freeMinutes)} />
      </dl>

      {load.reason ? (
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-foreground">
          <Sun className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
          <span>
            {load.reason} That is information, not an instruction — the day still belongs to you.
          </span>
        </p>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/25 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {conflicts.length === 1 ? 'Two things share a slot' : `${conflicts.length} slots overlap`}
          </p>
          <ul className="space-y-1">
            {conflicts.slice(0, 3).map((conflict) => (
              <li key={`${conflict.aId}:${conflict.bId}`} className="text-xs text-muted-foreground">
                <span className="tabular-nums text-foreground">{intervalLabel(conflict.window)}</span>{' '}
                — {blockTitle(blocks, conflict.aId)} and {blockTitle(blocks, conflict.bId)}
                {conflict.overlapMinutes > 0
                  ? ` (${conflict.overlapMinutes} min together)`
                  : ''}
              </li>
            ))}
          </ul>
          <p className="text-2xs leading-relaxed text-muted-foreground">
            Overlapping is allowed. Move one in the calendar if you would rather they did not.
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Clock className="size-3.5" aria-hidden="true" />
          Gaps between plans
        </h3>
        {free.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            There is no gap of fifteen minutes or more between what is planned — the day is spoken
            for. Moving one task usually opens a window.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {free.map((gap) => (
              <li
                key={`${gap.startMinutes}-${gap.endMinutes}`}
                className="rounded-md border border-border bg-muted/40 px-2 py-1 text-2xs tabular-nums text-muted-foreground"
              >
                {intervalLabel(gap)}
                <span className="ml-1 text-foreground/70">({formatHours(gap.endMinutes - gap.startMinutes)})</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-2xs leading-relaxed text-muted-foreground">
          Gaps are counted between 07:00 and 23:00 and only include your planned tasks and
          appointments. They are not a claim about the rest of your life.
        </p>
      </div>

      <div className="space-y-2 border-t border-border/70 pt-3">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <Label htmlFor="availability-duration" className="text-xs">
              If you wanted to add something
            </Label>
            <Select value={String(duration)} onValueChange={(value) => setDuration(Number(value))}>
              <SelectTrigger id="availability-duration" className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_CHOICES.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {minutes} minutes
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Clock className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </div>

        {slots.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nothing of that length fits before 22:00 today. A shorter session, or another day, is a
            perfectly good answer.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {slots.map((slot) => (
              <li key={slot.startMinutes} className="flex items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-foreground">{slot.label}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onUseSlot(day, slot.startMinutes, duration)}
                >
                  <CalendarPlus className="size-3.5" aria-hidden="true" />
                  Plan here
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/25 px-2 py-2">
      <dd className="font-serif text-base font-semibold tabular-nums text-foreground">{value}</dd>
      <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
    </div>
  );
}

function blockTitle(blocks: DayAvailability['blocks'], id: string): string {
  return blocks.find((block) => block.id === id)?.title ?? 'Something';
}
