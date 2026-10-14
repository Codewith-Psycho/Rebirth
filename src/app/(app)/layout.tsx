import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { ViewerProvider } from '@/lib/hooks/use-viewer';
import { SIDEBAR_COOKIE, readSidebarCollapsed } from '@/lib/ui-prefs';
import { loadViewer } from '@/lib/viewer';

export const metadata: Metadata = {
  title: 'Today',
};

export const dynamic = 'force-dynamic';

/**
 * The signed-in shell.
 *
 * Authentication is decided here, on the server, before any of the page's data
 * loaders run — so no screen can render with a half-known viewer, and no screen
 * has to defend itself against being reached while signed out.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await loadViewer();

  if (viewer === 'no-session') redirect('/login');
  if (viewer === 'incomplete') return <IncompleteAccount />;

  const collapsed = readSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <ViewerProvider viewer={viewer}>
      <AppShell defaultCollapsed={collapsed}>{children}</AppShell>
    </ViewerProvider>
  );
}

/**
 * Reached only if the sign-up trigger's work is genuinely missing after
 * `rpc_ensure_user` has had a go at repairing it.
 *
 * It would be easy to paper over this with a default name and the browser's
 * timezone, but a wrong timezone silently corrupts which day a session belongs
 * to, and that is not something to guess at.
 */
function IncompleteAccount() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center gap-4 px-5 py-16 sm:px-8"
    >
      <p className="font-serif text-sm tracking-[0.18em] text-muted-foreground">REBIRTH</p>
      <h1 className="font-serif text-2xl font-semibold leading-tight tracking-tight">
        Your account is missing its starting details
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        The profile row that holds your name and timezone is not in the database yet. Reloading will
        try again — and it will keep everything you have already recorded.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/today"
          className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </Link>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign in again
        </Link>
      </div>
    </main>
  );
}
