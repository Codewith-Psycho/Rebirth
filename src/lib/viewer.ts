import 'server-only';

import { getViewerContext } from '@/lib/supabase/server';
import type { Viewer } from '@/lib/hooks/use-viewer';

/**
 * Assembles the `Viewer` the app shell hands to the client.
 *
 * Returns `null` in two distinct situations, which the layout treats
 * differently: no session at all (→ sign in), or a session whose profile or
 * preferences row is still missing after `rpc_ensure_user` ran (→ an honest
 * recovery screen rather than a made-up default name and timezone).
 */
export async function loadViewer(): Promise<Viewer | 'no-session' | 'incomplete'> {
  const context = await getViewerContext();
  if (!context) return 'no-session';

  if (!context.profile || !context.preferences) return 'incomplete';

  return {
    userId: context.userId,
    email: context.email,
    displayName: context.profile.display_name?.trim() || context.email || 'You',
    timeZone: context.profile.timezone,
    profile: context.profile,
    preferences: context.preferences,
  };
}
