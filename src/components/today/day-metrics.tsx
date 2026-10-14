'use client';

import { BatteryMedium, CircleCheck, Coffee, Gauge, ListChecks, Timer } from 'lucide-react';

import { StatCard } from '@/components/common/stat-card';
import type { DaySummary } from '@/lib/domain/analytics';
import { formatDuration } from '@/lib/domain/time';

/**
 * Today's numbers.
 *
 * Every figure is counted from rows the user actually produced. Nothing is
 * estimated, nothing is a placeholder, and where a number does not exist yet the
 * card says "not yet recorded" rather than showing a zero — a zero is a claim,
 * and an empty day has not made any claims.
 *
 * Two of these deserve their wording:
 *
 *   · **Tracked time is reported on its own card**, never folded into the plan.
 *     Time the timer recorded and time that was scheduled are different facts,
 *     and a single blended "productivity" number would hide the difference that
 *     the user most needs to see.
 *   · **Adherence is only shown when the denominator is real.** With nothing
 *     planned there is nothing to adhere to, and the card stays empty.
 */

export function DayMetrics({ summary }: { summary: DaySummary }) {
  const hasPlan = summary.tasksPlanned > 0;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="Planned"
        value={hasPlan ? summary.tasksPlanned : null}
        unit={hasPlan ? (summary.tasksPlanned === 1 ? 'task' : 'tasks') : undefined}
        hint={hasPlan ? `${formatDuration(summary.plannedMinutes)} of the day set aside` : undefined}
        icon={ListChecks}
        emptyLabel="Nothing planned"
      />

      <StatCard
        label="Completed"
        value={hasPlan ? summary.tasksCompleted : null}
        unit={hasPlan ? `of ${summary.tasksPlanned}` : undefined}
        hint={
          hasPlan
            ? summary.tasksRemaining > 0
              ? `${summary.tasksRemaining} still open — that is a list, not a debt`
              : 'Everything planned has been done'
            : undefined
        }
        icon={CircleCheck}
        emptyLabel="Nothing planned"
      />

      <StatCard
        label="Tracked time"
        value={summary.trackedMinutes > 0 ? summary.trackedMinutes : null}
        unit={summary.trackedMinutes > 0 ? 'min' : undefined}
        hint="Recorded by the timer, counted separately from the plan"
        icon={Timer}
        emptyLabel="No time tracked"
      />

      <StatCard
        label="Break time"
        value={summary.breakMinutes > 0 ? summary.breakMinutes : null}
        unit={summary.breakMinutes > 0 ? 'min' : undefined}
        hint="Breaks taken inside a session count as part of the work"
        icon={Coffee}
        emptyLabel="No breaks logged"
      />

      <StatCard
        label="Still free"
        value={hasPlan ? summary.freeMinutes : null}
        unit={hasPlan ? 'min' : undefined}
        hint={hasPlan ? 'Awake time not claimed by anything planned' : undefined}
        icon={Gauge}
        emptyLabel={hasPlan ? undefined : 'Nothing planned'}
      />

      <StatCard
        label="Energy"
        value={summary.energyAverage === null ? null : summary.energyAverage.toFixed(1)}
        unit={summary.energyAverage === null ? undefined : 'of 5'}
        hint={
          summary.energyAverage === null
            ? 'Check in below and a pattern will appear here over time'
            : 'Average of the check-ins you made today'
        }
        icon={BatteryMedium}
        emptyLabel="Not yet recorded"
      />
    </div>
  );
}
