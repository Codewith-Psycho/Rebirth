'use client';

import { useState } from 'react';
import { Check, HeartPulse, PenLine, Plus, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { upsertEnergyLog, upsertReflection, type EnergyLog, type Reflection } from '@/lib/data/practice';
import { ENERGY_SLOTS, readEnergyTags } from '@/lib/data/settings';
import { ENERGY_SLOT_LABELS, ENERGY_TAG_OPTIONS } from '@/lib/domain/vocabulary';
import type { DayKey } from '@/lib/domain/time';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import { cn } from '@/lib/utils';
import type { Mutator } from '@/components/tasks/types';

/**
 * Energy and reflection.
 *
 * The energy scale is deliberately *neutral*: the labels describe states, not
 * verdicts, and the card says out loud that a low number is not a bad day. That
 * matters because this data feeds the insights screen — a scale the user feels
 * judged by is a scale the user learns to answer dishonestly, and then the
 * pattern the app reports is a pattern in the flattery, not in the life.
 *
 * Check-ins are upserts keyed on (day, slot), so checking in three times in a
 * morning replaces the morning rather than creating a fourth data point.
 */

const LEVEL_WORDS: Record<number, string> = {
  1: 'Running low',
  2: 'Below par',
  3: 'Steady',
  4: 'Good',
  5: 'Plenty',
};

export function EnergyCheckIn({ day, logs, mutate }: { day: DayKey; logs: EnergyLog[]; mutate: Mutator }) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const [busy, setBusy] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);

  const allowedTags = readEnergyTags(viewer.preferences);
  const tagOptions = allowedTags.length > 0 ? allowedTags : [...ENERGY_TAG_OPTIONS];

  async function save(
    slot: (typeof ENERGY_SLOTS)[number],
    level: number,
    tags: string[],
    note: string,
  ) {
    setBusy(slot);
    await mutate(
      () =>
        upsertEnergyLog(supabase, viewer.userId, {
          log_date: day,
          slot,
          level,
          tags,
          note: note.length > 0 ? note : null,
        }),
      { quiet: true },
    );
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="size-4 text-muted-foreground" aria-hidden="true" />
          Energy check-ins
        </CardTitle>
        <CardDescription>
          Three times a day, one tap each. There is no good or bad number here — a low reading is a
          fact about the day, not a verdict on you.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {ENERGY_SLOTS.map((slot) => {
          const existing = logs.find((log) => log.slot === slot) ?? null;
          const selected = existing?.level ?? null;
          const tags = existing?.tags ?? [];
          const noteOpen = openNote === slot || (existing?.note ?? '').length > 0;

          return (
            <div key={slot} className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">{ENERGY_SLOT_LABELS[slot]}</p>
                {selected !== null ? (
                  <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                    <Check className="size-3" aria-hidden="true" />
                    Recorded — {LEVEL_WORDS[selected]?.toLowerCase()}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${ENERGY_SLOT_LABELS[slot]} energy level`}>
                {[1, 2, 3, 4, 5].map((level) => {
                  const active = selected === level;
                  return (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={active}
                      disabled={busy === slot}
                      onClick={() => void save(slot, level, tags, existing?.note ?? '')}
                      className={cn(
                        'min-h-9 rounded-md border px-2.5 text-xs transition-colors duration-150',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                        active
                          ? 'border-accent/60 bg-accent/15 font-medium text-foreground'
                          : 'border-border bg-surface text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <span className="tabular-nums">{level}</span>
                      <span className="ml-1.5 hidden sm:inline">{LEVEL_WORDS[level]}</span>
                    </button>
                  );
                })}
              </div>

              {selected !== null ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {tagOptions.map((tag) => {
                      const active = tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          aria-pressed={active}
                          disabled={busy === slot}
                          onClick={() =>
                            void save(
                              slot,
                              selected,
                              active ? tags.filter((entry) => entry !== tag) : [...tags, tag],
                              existing?.note ?? '',
                            )
                          }
                          className={cn(
                            'rounded-full border px-2.5 py-1 text-2xs transition-colors duration-150',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                            active
                              ? 'border-primary/40 bg-primary-soft text-foreground'
                              : 'border-border bg-surface text-muted-foreground hover:bg-muted',
                          )}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>

                  {noteOpen ? (
                    <div className="space-y-1.5">
                      <Label htmlFor={`energy-note-${slot}`} className="text-xs">
                        Anything worth noting? (optional)
                      </Label>
                      <Input
                        id={`energy-note-${slot}`}
                        defaultValue={existing?.note ?? ''}
                        placeholder="Slept badly, big lunch, long walk…"
                        onBlur={(event) => {
                          if ((existing?.note ?? '') !== event.target.value) {
                            void save(slot, selected, tags, event.target.value);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setOpenNote(slot)}>
                      <Plus aria-hidden="true" />
                      Add a note
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ReflectionCard({
  day,
  reflection,
  mutate,
}: {
  day: DayKey;
  reflection: Reflection | null;
  mutate: Mutator;
}) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const [win, setWin] = useState(reflection?.win_of_day ?? '');
  const [notes, setNotes] = useState(reflection?.notes ?? '');
  const [mood, setMood] = useState<number | null>(reflection?.mood ?? null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    const result = await mutate(
      () =>
        upsertReflection(supabase, viewer.userId, {
          reflection_date: day,
          win_of_day: win.length > 0 ? win : null,
          notes: notes.length > 0 ? notes : null,
          mood,
        }),
      { success: 'Saved. That is the day closed off properly.', quiet: true },
    );
    setBusy(false);
    if (result.ok) setSaved(true);
  }

  const dirty =
    win !== (reflection?.win_of_day ?? '') ||
    notes !== (reflection?.notes ?? '') ||
    mood !== (reflection?.mood ?? null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PenLine className="size-4 text-muted-foreground" aria-hidden="true" />
          Close the day
        </CardTitle>
        <CardDescription>
          Optional, short, and never scored. Yesterday is data, not a verdict.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3.5">
        <div className="space-y-1.5">
          <Label htmlFor="reflection-win">One thing that went well</Label>
          <Input
            id="reflection-win"
            value={win}
            maxLength={300}
            placeholder="Even a small one counts"
            onChange={(event) => setWin(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reflection-notes">Anything else worth remembering?</Label>
          <Textarea
            id="reflection-notes"
            rows={3}
            value={notes}
            maxLength={2000}
            placeholder="What helped, what got in the way, what to try differently…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label>How did the day feel?</Label>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="How the day felt">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mood === value}
                onClick={() => setMood(mood === value ? null : value)}
                className={cn(
                  'size-9 rounded-md border text-xs tabular-nums transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  mood === value
                    ? 'border-accent/60 bg-accent/15 font-medium text-foreground'
                    : 'border-border bg-surface text-muted-foreground hover:bg-muted',
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void save()} loading={busy} disabled={!dirty && saved}>
            <Sparkles aria-hidden="true" />
            Save the day
          </Button>
          {saved && !dirty ? (
            <span className="text-xs text-muted-foreground">Saved.</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
