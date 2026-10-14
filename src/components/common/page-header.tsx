import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The page title block.
 *
 * Every screen uses it so headings sit at a consistent height and the document
 * outline stays predictable for screen-reader navigation. The heading is a real
 * `<h1>`; there is exactly one per page.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  /** A small line above the title — a date, a mode, a range. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Rendered opposite the actions, for filters or counts. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:mb-8', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-2 text-2xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {meta ? <div className="flex flex-wrap items-center gap-3">{meta}</div> : null}
    </header>
  );
}

/** A titled region within a page. Keeps heading levels consistent. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cn('space-y-3', className)} aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="font-serif text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
