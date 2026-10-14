'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { Preferences, Profile } from '@/lib/data/settings';
import { getSupabaseBrowserClient, type RebirthClient } from '@/lib/supabase/client';

/**
 * Who is using the app, and what they have configured.
 *
 * The values arrive from the server layout, already loaded, so the shell never
 * flashes a placeholder name or a default timezone. Everything that depends on
 * "whose day is it" reads the timezone from here — one source, so the dashboard,
 * the calendar and the analytics cannot disagree about when Monday started.
 */

export interface Viewer {
  userId: string;
  email: string | null;
  displayName: string;
  timeZone: string;
  profile: Profile;
  preferences: Preferences;
}

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>;
}

export function useViewer(): Viewer {
  const viewer = useContext(ViewerContext);
  if (!viewer) {
    throw new Error('useViewer must be used inside <ViewerProvider>.');
  }
  return viewer;
}

/** The browser Supabase client, memoised for the lifetime of the component. */
export function useSupabase(): RebirthClient {
  return useMemo(() => getSupabaseBrowserClient(), []);
}

/** Convenience for the many components that only need the local timezone. */
export function useTimeZone(): string {
  return useViewer().timeZone;
}
