import { redirect } from 'next/navigation';

import { isSupabaseConfigured } from '@/lib/supabase/env';
import { getCurrentUser } from '@/lib/supabase/server';

/**
 * The front door.
 *
 * `/` has no content of its own — it routes to the day, or to sign-in. Deciding
 * on the server means there is no flash of a signed-out shell before the
 * session is known.
 */
export default async function RootPage() {
  if (!isSupabaseConfigured()) redirect('/setup');

  const user = await getCurrentUser();
  redirect(user ? '/today' : '/login');
}
