import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

import { AppShell } from '@/components/layout/app-shell';
import { ViewerProvider } from '@/lib/hooks/use-viewer';
import { SIDEBAR_COOKIE, readSidebarCollapsed } from '@/lib/ui-prefs';
import { loadViewerReport } from '@/lib/viewer';

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
  const { viewer, diagnostic } = await loadViewerReport();

  if (viewer === 'no-session') redirect('/login');
  if (viewer === 'incomplete') return <IncompleteAccount diagnostic={diagnostic} />;

  const collapsed = readSidebarCollapsed((await cookies()).get(SIDEBAR_COOKIE)?.value);

  return (
    <ViewerProvider viewer={viewer}>
      <AppShell defaultCollapsed={collapsed}>{children}</AppShell>
    </ViewerProvider>
  );
}

/**
 * The two things that can be true on this screen, kept apart on purpose. The
 * first is a statement the app has actually verified — both reads succeeded and
 * the row is genuinely absent. The second is what to say when a step failed and
 * the app therefore does *not* know whether the row is there.
 */
const ROW_MISSING_COPY =
  'The profile row that holds your name and timezone is not in the database yet. Reloading will try again — and it will keep everything you have already recorded.';

const REPAIR_INCOMPLETE_COPY =
  'Your account could not be opened: the repair that creates your starting details did not finish. Reloading will try again — and it will keep everything you have already recorded.';

/**
 * Reached only if the sign-up trigger's work is genuinely missing after
 * `rpc_ensure_user` has had a go at repairing it — or if that repair, or the
 * read that follows it, failed outright.
 *
 * It would be easy to paper over this with a default name and the browser's
 * timezone, but a wrong timezone silently corrupts which day a session belongs
 * to, and that is not something to guess at. The two cases are told apart by
 * `diagnostic` instead: it names the step that failed and its short code, and it
 * is `null` when nothing failed and the row is simply not there.
 */
function IncompleteAccount({ diagnostic }: { diagnostic: string | null }) {
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
        {diagnostic === null ? ROW_MISSING_COPY : REPAIR_INCOMPLETE_COPY}
      </p>
      {diagnostic === null ? null : (
        <p className="font-mono text-xs leading-relaxed text-muted-foreground">{diagnostic}</p>
      )}
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
