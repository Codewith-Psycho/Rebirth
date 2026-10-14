'use client';

import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * The last line of defence.
 *
 * Says what happened in plain words, offers a retry, and — importantly — does
 * not suggest that the user's data is at risk, because a render error cannot
 * affect what is already committed to the database.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept as a console message rather than a toast: an error boundary is not a
    // place to interrupt someone with a notification.
    console.error('REBIRTH render error', error);
  }, [error]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col items-start justify-center gap-5 px-5 py-16 sm:px-8"
    >
      <p className="font-serif text-sm tracking-[0.18em] text-muted-foreground">REBIRTH</p>
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight">
        Something went wrong on this screen
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Your records are stored in the database and were not affected. Reloading this screen is safe.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    </main>
  );
}
