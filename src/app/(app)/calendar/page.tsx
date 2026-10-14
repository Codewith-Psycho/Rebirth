import { redirect } from 'next/navigation';

import { ErrorState } from '@/components/common/states';
import { loadCalendarFacts } from '@/lib/data/calendar-view';
import { rangeFor } from '@/lib/domain/calendar-range';
import { todayInZone } from '@/lib/domain/time';
import { requireServerClient } from '@/lib/supabase/server';
import { loadViewer } from '@/lib/viewer';
import { CalendarClient } from './calendar-client';
import { CalendarProvider } from './calendar-context';

/**
 * The calendar, rendered on the server for the first paint.
 *
 * The window loaded here is the same window the provider re-loads after a
 * write, produced by the same function, so paging into a new month and landing
 * on it directly show identical data. A failed load is shown as a failure rather
 * than as an empty month: "nothing is planned" and "the plan could not be read"
 * are different statements and only one of them is true.
 */

export const dynamic = 'force-dynamic';

export default async function CalendarPage() {
  const viewer = await loadViewer();
  if (viewer === 'no-session') redirect('/login');

  /*
   * No default timezone is invented for a viewer without a profile: a wrong
   * timezone would place every event on the wrong day, and the calendar is the
   * screen where that is most visible.
   */
  if (viewer === 'incomplete') {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="Your account is missing a profile"
          message="REBIRTH could not read your timezone or preferences, and guessing them would place your events on the wrong days. Signing out and back in repairs this."
        />
      </div>
    );
  }

  const db = await requireServerClient();
  const now = new Date();
  const today = todayInZone(viewer.timeZone, now);
  const range = rangeFor('month', today, viewer.preferences.week_starts_on);

  const result = await loadCalendarFacts(db, {
    from: range.from,
    to: range.to,
    today,
    timeZone: viewer.timeZone,
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-prose py-10">
        <ErrorState
          title="The calendar did not load"
          message={`${result.error} Nothing you recorded has been lost, and nothing was changed. Reloading the page will try again.`}
        />
      </div>
    );
  }

  return (
    <CalendarProvider initial={result.data} initialAnchor={today}>
      <CalendarClient />
    </CalendarProvider>
  );
}
