import { redirect } from 'next/navigation';

import { ErrorState } from '@/components/common/states';
import { loadScheduleFacts } from '@/lib/data/schedule';
import { todayInZone } from '@/lib/domain/time';
import { requireServerClient } from '@/lib/supabase/server';
import { loadViewer } from '@/lib/viewer';
import { ScheduleClient } from './schedule-client';
import { ScheduleProvider } from './schedule-context';

/**
 * The schedule, rendered on the server for the first paint.
 *
 * The window loaded here is the same one the provider re-loads after every
 * write, and the routine occurrences it shows are the rows the materialiser
 * writes — so what the page shows after a pause, an edit or a resume is the
 * database's answer rather than the browser's recollection.
 *
 * A failed load is shown as a failure. "You have no routines" and "your routines
 * could not be read" are different statements, and only one of them is true.
 */

export const dynamic = 'force-dynamic';

export default async function SchedulePage() {
  const viewer = await loadViewer();
  if (viewer === 'no-session') redirect('/login');

  if (viewer === 'incomplete') {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="Your account is missing a profile"
          message="REBIRTH could not read your timezone or preferences, and guessing them would place your routines on the wrong days. Signing out and back in repairs this."
        />
      </div>
    );
  }

  const db = await requireServerClient();
  const today = todayInZone(viewer.timeZone);

  const result = await loadScheduleFacts(db, {
    today,
    timeZone: viewer.timeZone,
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="Your schedule did not load"
          message={`${result.error} Nothing you recorded has been lost, and nothing was changed. Reloading the page will try again.`}
        />
      </div>
    );
  }

  return (
    <ScheduleProvider initial={result.data}>
      <ScheduleClient />
    </ScheduleProvider>
  );
}
