/**
 * Small interface preferences that are not worth a database round trip.
 *
 * These are stored in cookies rather than localStorage for one reason: the
 * server renders the first paint, so the shell can be laid out correctly on the
 * very first frame instead of snapping from one width to another once the
 * client hydrates.
 *
 * Nothing user-generated or private lives here — only how the furniture is
 * arranged.
 */

export const SIDEBAR_COOKIE = 'rebirth-sidebar';

/** One year, in seconds. */
const ONE_YEAR = 60 * 60 * 24 * 365;

export function readSidebarCollapsed(value: string | undefined): boolean {
  return value === 'collapsed';
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof document === 'undefined') return;
  const value = collapsed ? 'collapsed' : 'expanded';
  document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}
