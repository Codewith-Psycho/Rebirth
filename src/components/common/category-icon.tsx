import {
  Briefcase,
  Circle,
  FolderCog,
  GraduationCap,
  HeartPulse,
  Moon,
  Palette,
  Plane,
  Repeat,
  User,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

import { CATEGORY_META } from '@/lib/domain/vocabulary';
import type { CategoryKind } from '@/lib/types/database';
import { cn } from '@/lib/utils';

/**
 * Category → glyph.
 *
 * `CATEGORY_META` stores icon *names* so the vocabulary module stays free of
 * React. This is the one place that resolves them, which means a typo shows up
 * as a single fallback rather than a crash somewhere deep in a chart.
 *
 * Colour is never the only signal: the glyph always ships with its category
 * label in the surrounding markup.
 */
const ICONS: Record<string, LucideIcon> = {
  GraduationCap,
  Briefcase,
  HeartPulse,
  Repeat,
  User,
  Moon,
  UtensilsCrossed,
  Palette,
  FolderCog,
  Users,
  Plane,
  Circle,
};

export function CategoryIcon({
  category,
  className,
  label,
}: {
  category: CategoryKind;
  className?: string;
  /** Set to false when the caller already prints the category name nearby. */
  label?: boolean;
}) {
  const meta = CATEGORY_META[category];
  const Icon = ICONS[meta?.icon ?? 'Circle'] ?? Circle;
  const text = meta?.label ?? 'Other';

  return (
    <>
      <Icon
        className={cn('shrink-0', className)}
        aria-hidden={label === false ? true : undefined}
        role={label === false ? undefined : 'img'}
      />
      {label === false ? null : <span className="sr-only">{text}</span>}
    </>
  );
}

/** The raw icon for callers that want to place it themselves. */
export function categoryIconFor(category: CategoryKind): LucideIcon {
  return ICONS[CATEGORY_META[category]?.icon ?? 'Circle'] ?? Circle;
}
