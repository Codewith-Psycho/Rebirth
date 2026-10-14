'use client';

import Link from 'next/link';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Wordmark } from '@/components/layout/wordmark';
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath, type NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * The desktop sidebar.
 *
 * Three shapes, all from one component: the full sidebar on large screens, the
 * same sidebar collapsed to an icon rail (which is also what a tablet gets,
 * where there is not room for labels), and nothing at all on phones, which use
 * the bottom bar instead.
 *
 * Collapsing is a real preference, not a visual trick: the width, the labels and
 * the tooltips all follow it, and the choice is remembered.
 */

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = isActivePath(pathname, item.href);
  const icon = <item.icon className="size-[1.1rem] shrink-0" aria-hidden="true" />;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-10 items-center gap-3 rounded-md pl-3 pr-2 text-sm transition-colors duration-150 ease-calm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        active
          ? 'bg-primary/8 font-medium text-primary'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {/* Active state carries a shape as well as a colour, so it is not colour-only. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent transition-opacity duration-150',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />
      {icon}
      <span className={cn('truncate', collapsed ? 'hidden' : 'hidden lg:inline')}>
        {item.label}
      </span>
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

export function AppSidebar({
  pathname,
  collapsed,
  onToggle,
}: {
  pathname: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      aria-label="Main"
      className={cn(
        'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-border bg-surface/70 md:flex',
        'transition-[width] duration-200 ease-calm',
        collapsed ? 'w-18' : 'w-18 lg:w-60',
      )}
    >
      <div className={cn('flex h-14 items-center', collapsed ? 'justify-center px-2' : 'px-4')}>
        {/* The mark alone whenever the rail is narrow: collapsed at any width,
            or the icon rail a tablet gets between md and lg. */}
        <span className={collapsed ? 'contents' : 'lg:hidden'}>
          <Wordmark showName={false} />
        </span>
        {collapsed ? null : (
          <span className="hidden lg:contents">
            <Wordmark />
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-0.5">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} collapsed={collapsed} />
            </li>
          ))}
        </ul>

        <div className={cn('my-3 border-t border-border', collapsed ? 'mx-2' : 'mx-3')} />

        <ul className="space-y-0.5">
          {SECONDARY_NAV.map((item) => (
            <li key={item.href}>
              <NavLink item={item} pathname={pathname} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>

      <div className={cn('hidden border-t border-border p-2 lg:block')}>
        <Button
          variant="ghost"
          size={collapsed ? 'icon-sm' : 'sm'}
          onClick={onToggle}
          aria-expanded={!collapsed}
          className={cn('text-muted-foreground', collapsed ? 'mx-auto' : 'w-full justify-start')}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" />
          ) : (
            <PanelLeftClose aria-hidden="true" />
          )}
          {collapsed ? null : <span>Collapse</span>}
          <span className="sr-only">
            {collapsed ? 'Expand navigation' : 'Collapse navigation'}
          </span>
        </Button>
      </div>
    </aside>
  );
}
