import type { ReactNode } from 'react';
import { Info, type LucideIcon } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * A single measured number.
 *
 * Two rules are enforced by the component's shape rather than by discipline:
 *
 *   · The figure uses tabular numerals, so a column of statistics does not
 *     shimmer as the values change.
 *   · A number that rests on a definition must be able to say what that
 *     definition is. `definition` renders an info affordance; a caller with
 *     nothing honest to add simply omits it.
 *
 * When `value` is null the card says "Not yet recorded" rather than showing a
 * zero. A missing measurement and a measured zero are different facts, and
 * conflating them is how a productivity app starts lying.
 */
export function StatCard({
  label,
  value,
  unit,
  hint,
  definition,
  icon: Icon,
  emptyLabel = 'Not yet recorded',
  className,
}: {
  label: string;
  value: string | number | null;
  unit?: string;
  /** A short second line, usually derived from the same records. */
  hint?: ReactNode;
  /** What the number means, shown on demand. */
  definition?: string;
  icon?: LucideIcon;
  emptyLabel?: string;
  className?: string;
}) {
  const hasValue = value !== null && value !== '';

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-4 shadow-subtle transition-colors duration-150',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <div className="flex items-center gap-1">
          {Icon ? <Icon className="size-3.5 text-muted-foreground/70" aria-hidden="true" /> : null}
          {definition ? (
            <Tooltip>
              <TooltipTrigger
                className="rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`What "${label}" means`}
              >
                <Info className="size-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs leading-relaxed">{definition}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <p className="mt-2.5 font-serif text-2xl font-semibold leading-none tracking-tight text-foreground">
        {hasValue ? (
          <>
            <span className="tabular-nums">{value}</span>
            {unit ? (
              <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
            ) : null}
          </>
        ) : (
          <span className="font-sans text-sm font-normal text-muted-foreground">{emptyLabel}</span>
        )}
      </p>

      {hint ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
