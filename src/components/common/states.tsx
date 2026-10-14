import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The four states every screen owes the user: loading, failed, empty, filled.
 *
 * The empty state is deliberately the most carefully written of the three.
 * "No data" is almost never true — a new account has no *records*, which is
 * different from having nothing to do, and the copy says which one it is and
 * what the next useful action would be.
 */

/* ── Loading ────────────────────────────────────────────────────────────── */

export function LoadingBlock({
  rows = 3,
  className,
  label = 'Loading',
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="mt-3 h-3 w-4/5" />
          <Skeleton className="mt-2 h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/* ── Failure ────────────────────────────────────────────────────────────── */

/**
 * A failed load.
 *
 * The wording separates "we could not read this" from "your work is gone",
 * because those are very different things and only one of them is true here.
 */
export function ErrorState({
  title = 'This did not load',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-lg border border-border bg-surface p-5 text-left shadow-subtle',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-base font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{message}</p>
          {onRetry ? (
            <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              Try again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Empty ──────────────────────────────────────────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  href,
  hrefLabel,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  /** A button or other control rendered beneath the copy. */
  action?: ReactNode;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border bg-surface/60 px-5 py-8 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-muted/40">
          <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
      ) : null}
      <p className="mt-3 font-serif text-lg font-semibold tracking-tight text-foreground">{title}</p>
      <p className="mx-auto mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      {href && hrefLabel ? (
        <Link
          href={href}
          className="mt-4 inline-flex text-sm text-primary underline underline-offset-4 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}

/* ── Sync ───────────────────────────────────────────────────────────────── */

/**
 * Whether changes from other devices are arriving live.
 *
 * Shown because the alternative is silence: if Realtime is off, the screen
 * keeps working but will not notice another device's edits until it reloads,
 * and the user deserves to know which of those two they are in.
 */
export function SyncBadge({ status }: { status: 'idle' | 'connecting' | 'live' | 'unavailable' }) {
  if (status === 'idle' || status === 'live') return null;

  const connecting = status === 'connecting';

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-2xs text-muted-foreground"
      title={
        connecting
          ? 'Connecting to live updates'
          : 'Live updates are unavailable — this screen will not notice changes made on another device until it is reloaded'
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          connecting ? 'animate-breathe bg-accent' : 'bg-muted-foreground/60',
        )}
      />
      {connecting ? 'Connecting' : 'Not live'}
    </span>
  );
}
