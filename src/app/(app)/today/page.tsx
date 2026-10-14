import { redirect } from 'next/navigation';

import { ErrorState } from '@/components/common/states';
import { loadToday } from '@/lib/data/today';
import { todayInZone } from '@/lib/domain/time';
import { requireServerClient } from '@/lib/supabase/server';
import { loadViewer } from '@/lib/viewer';
import { TodayClient } from './today-client';
import { TodayProvider } from './today-context';

/**
 * Today, rendered on the server for the first paint.
 *
 * The page builds the *same* snapshot the client rebuilds after every write, so
 * the numbers a user sees on load were produced by the same code as the numbers
 * they see after completing a task — there is no second implementation that can
 * drift.
 *
 * A failed load is shown as a failed load. It is never papered over with an
 * empty day, because "you have nothing planned" and "we could not read your
 * plan" are very different messages and only one of them is true.
 */

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const viewer = await loadViewer();
  if (viewer === 'no-session') redirect('/login');

  /*
   * A viewer without a profile is not silently given a default timezone: a
   * wrong timezone files a session under the wrong date, and every number on
   * this page would then rest on a lie. The shell normally catches this before
   * the page renders; this is the belt-and-braces path for a direct hit.
   */
  if (viewer === 'incomplete') {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="Your account is missing a profile"
          message="REBIRTH could not read your timezone or preferences, and guessing them would put your records on the wrong days. Signing out and back in repairs this."
        />
      </div>
    );
  }

  const db = await requireServerClient();
  const now = new Date();

  const result = await loadToday(db, {
    day: todayInZone(viewer.timeZone, now),
    timeZone: viewer.timeZone,
    preferences: viewer.preferences,
    now,
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="Today did not load"
          message={`${result.error} Nothing you recorded has been lost, and nothing was changed. Reloading the page will try again.`}
        />
      </div>
    );
  }

  return (
    <TodayProvider initial={result.data}>
      <TodayClient />
    </TodayProvider>
  );
}
