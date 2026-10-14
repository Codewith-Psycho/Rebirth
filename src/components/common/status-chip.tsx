import { CircleCheck, CircleDashed, CircleMinus, CircleSlash, Play } from 'lucide-react';

import { TASK_STATUS_META } from '@/lib/domain/vocabulary';
import { cn } from '@/lib/utils';

/**
 * Status is carried by a shape as well as a colour.
 *
 * Roughly one in twelve men has a colour vision deficiency, and a status that
 * is only legible as "the green one" is not legible at all. Each status also
 * gets a distinct tone that stays inside the app's calm palette — a task that
 * was not done is rendered in a neutral grey, never an alarm red, because the
 * app does not treat a missed day as an emergency.
 */
const GLYPHS = {
  open: CircleDashed,
  active: Play,
  done: CircleCheck,
  missed: CircleMinus,
  skipped: CircleSlash,
  cancelled: CircleSlash,
} as const;

const TONES = {
  open: 'border-border bg-muted/40 text-muted-foreground',
  active: 'border-accent/40 bg-accent/10 text-accent',
  done: 'border-success/35 bg-success/10 text-success',
  missed: 'border-border bg-muted/50 text-muted-foreground',
  skipped: 'border-border bg-muted/50 text-muted-foreground',
  cancelled: 'border-border bg-transparent text-muted-foreground/80',
} as const;

export function StatusChip({
  status,
  className,
  showLabel = true,
}: {
  status: string;
  className?: string;
  showLabel?: boolean;
}) {
  const meta = TASK_STATUS_META[status];
  if (!meta) return null;
  const Glyph = GLYPHS[meta.glyph];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium',
        TONES[meta.glyph],
        className,
      )}
      title={meta.description}
    >
      <Glyph className="size-3" aria-hidden="true" />
      {showLabel ? meta.label : <span className="sr-only">{meta.label}</span>}
    </span>
  );
}
