import type { CSSProperties } from 'react';

import type { CategoryKind } from '@/lib/types/database';
import { categoryColorIndex } from '@/lib/domain/vocabulary';

/**
 * Composing colour from data.
 *
 * Category colours come from the six `--chart-*` variables, whose slot is a
 * property of the category rather than of this file. A class name built from
 * that index would never survive Tailwind's scan, so the declaration is composed
 * here instead — the one place that knows how a category looks, so a category
 * cannot be one colour in the timeline and another in a chart.
 */

function slot(category: CategoryKind): string {
  return `--chart-${categoryColorIndex(category)}`;
}

/** Text and border only — for inline labels that must not shout. */
export function categoryAccent(category: CategoryKind): CSSProperties {
  const variable = slot(category);
  return { color: `hsl(var(${variable}))` };
}

/** A tinted, bordered surface — timeline blocks, category chips, legend keys. */
export function categorySurface(category: CategoryKind, alpha = 0.16): CSSProperties {
  const variable = slot(category);
  return {
    backgroundColor: `hsl(var(${variable}) / ${alpha})`,
    borderColor: `hsl(var(${variable}) / ${Math.min(1, alpha + 0.24)})`,
    color: `hsl(var(${variable}))`,
  };
}

/** A filled mark — chart bars, the actual-time band, small indicator dots. */
export function categoryFill(category: CategoryKind, alpha = 1): CSSProperties {
  return { backgroundColor: `hsl(var(${slot(category)}) / ${alpha})` };
}

/** The same six slots addressed directly, for series that are not categories. */
export function chartFill(index: 1 | 2 | 3 | 4 | 5 | 6, alpha = 1): CSSProperties {
  return { backgroundColor: `hsl(var(--chart-${index}) / ${alpha})` };
}

/** Neutral mark for "actual" time, which is not a category. */
export function actualBandStyle(): CSSProperties {
  return {
    backgroundColor: 'hsl(var(--accent) / 0.85)',
  };
}
