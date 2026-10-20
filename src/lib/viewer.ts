import 'server-only';

import { getViewerContext } from '@/lib/supabase/server';
import type { Viewer } from '@/lib/hooks/use-viewer';
import { hasCompleteAccount, recoveryDiagnostic } from '@/lib/viewer-recovery';

/** The shell's decision, and why it could not open the account when it could not. */
export interface ViewerReport {
  viewer: Viewer | 'no-session' | 'incomplete';
  /** One calm sentence for the recovery screen, or `null` on the normal path. */
  diagnostic: string | null;
}

/**
 * Assembles the `Viewer` the app shell hands to the client.
 *
 * Three outcomes, which the layout treats differently: no session at all
 * (→ sign in), a session whose profile or preferences row is still missing
 * after `rpc_ensure_user` ran (→ an honest recovery screen rather than a
 * made-up default name and timezone), or a viewer ready to render.
 */
export async function loadViewer(): Promise<Viewer | 'no-session' | 'incomplete'> {
  return (await loadViewerReport()).viewer;
}

/**
 * The same decision, carrying the diagnostic the shell shows when the account
 * still could not be opened. `loadViewer()` is a thin wrapper over this, so the
 * pages that only need a viewer keep the signature they already had.
 */
export async function loadViewerReport(): Promise<ViewerReport> {
  const context = await getViewerContext();
  if (!context) return { viewer: 'no-session', diagnostic: null };

  if (!hasCompleteAccount(context)) {
    return { viewer: 'incomplete', diagnostic: recoveryDiagnostic(context.recovery) };
  }

  return {
    viewer: {
      userId: context.userId,
      email: context.email,
      displayName: context.profile.display_name?.trim() || context.email || 'You',
      timeZone: context.profile.timezone,
      profile: context.profile,
      preferences: context.preferences,
    },
    diagnostic: null,
  };
}
