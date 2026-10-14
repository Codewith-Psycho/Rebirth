import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * The signed-out shell.
 *
 * Deliberately quiet: a single column, generous space, no marketing panel. The
 * only thing on screen is the form and one way out of it.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="px-5 py-6 sm:px-8">
        <Link
          href="/"
          className="inline-flex items-baseline gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="font-serif text-xl font-semibold tracking-[0.18em] text-foreground">
            REBIRTH
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-5 pb-16 pt-4 sm:items-center sm:px-8 sm:pt-0">
        <div className="w-full max-w-sm">{children}</div>
      </main>

      <footer className="px-5 pb-8 text-center sm:px-8">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Discipline through structure, not pressure.
        </p>
      </footer>
    </div>
  );
}
