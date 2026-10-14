import {
  BarChart3,
  CalendarDays,
  CalendarClock,
  Gift,
  Settings,
  Sun,
  Target,
  type LucideIcon,
} from 'lucide-react';

/**
 * The one place the app's information architecture is written down.
 *
 * The sidebar, the tablet rail, the mobile bottom bar and the "More" sheet all
 * read from here, so a destination can never appear in one navigation surface
 * and be missing from another.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Used by the More sheet and by collapsed-sidebar tooltips. */
  description: string;
}

export const PRIMARY_NAV: NavItem[] = [
  {
    href: '/today',
    label: 'Today',
    icon: Sun,
    description: 'The day in front of you, and what you actually did',
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: CalendarDays,
    description: 'Month, week and day views of everything planned',
  },
  {
    href: '/schedule',
    label: 'Schedule',
    icon: CalendarClock,
    description: 'Repeating routines and your real availability',
  },
  {
    href: '/insights',
    label: 'Insights',
    icon: BarChart3,
    description: 'Patterns in your records, stated honestly',
  },
];

export const SECONDARY_NAV: NavItem[] = [
  {
    href: '/goals',
    label: 'Goals',
    icon: Target,
    description: 'Longer arcs, milestones, and honest progress',
  },
  {
    href: '/rewards',
    label: 'Rewards',
    icon: Gift,
    description: 'What you have earned, and what you are working toward',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    description: 'Your profile, your day shape, and your quiet hours',
  },
];

export const ALL_NAV: NavItem[] = [...PRIMARY_NAV, ...SECONDARY_NAV];

/** True when `pathname` is the item or lives beneath it. */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The nav item that owns the current path, for the page title. */
export function findNavItem(pathname: string): NavItem | undefined {
  return ALL_NAV.find((item) => isActivePath(pathname, item.href));
}
