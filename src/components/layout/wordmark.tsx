import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * The wordmark.
 *
 * A small flame inside a square mark plus the name — no tagline, because the
 * tagline is the app's behaviour, not a sentence in a corner.
 */
export function Wordmark({
  href = '/today',
  showName = true,
  className,
}: {
  href?: string;
  showName?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none">
          <path
            d="M12 20c-3.9 0-7-2.9-7-6.6 0-2.4 1.2-4.5 3.2-5.7-.2.5-.3 1.1-.3 1.6 0 2.2 1.5 3.8 3.5 3.8 1.4 0 2.6-.9 3.1-2.3.7 1 .9 2.2.9 3.5 0 3.2-1.6 5.7-3.4 5.7Z"
            fill="currentColor"
          />
          <path d="M12 3.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      {showName ? (
        <span className="font-serif text-base font-semibold tracking-[0.16em] text-foreground">
          REBIRTH
        </span>
      ) : null}
    </Link>
  );
}
