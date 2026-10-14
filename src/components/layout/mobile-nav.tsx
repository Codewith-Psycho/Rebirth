'use client';

import { useState } from 'react';
import Link from 'next/link';
import { LogOut, MoreHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { signOutAction } from '@/lib/auth/actions';
import { useViewer } from '@/lib/hooks/use-viewer';
import { PRIMARY_NAV, SECONDARY_NAV, isActivePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * The phone navigation.
 *
 * Four destinations live in the bar itself — the ones a person touches many
 * times a day — and the rest sit behind "More", which opens a sheet that is
 * reachable with a thumb and dismissible by swiping or pressing Escape.
 *
 * Every tap target is at least 44px tall.
 */
export function MobileNav({ pathname }: { pathname: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const viewer = useViewer();

  const secondaryActive = SECONDARY_NAV.some((item) => isActivePath(pathname, item.href));

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around">
          {PRIMARY_NAV.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[3.25rem] flex-col items-center justify-center gap-1 px-1 py-1.5 text-2xs transition-colors duration-150',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <span className="relative flex items-center justify-center">
                    {/* Shape, not just colour, marks the current tab. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute -top-1.5 h-[2px] w-5 rounded-full bg-accent transition-opacity duration-150',
                        active ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <item.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="truncate leading-none">{item.label}</span>
                </Link>
              </li>
            );
          })}

          <li className="flex-1">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              className={cn(
                'flex w-full min-h-[3.25rem] flex-col items-center justify-center gap-1 px-1 py-1.5 text-2xs transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                secondaryActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <MoreHorizontal className="size-5" aria-hidden="true" />
              <span className="leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="px-5 pb-5 md:hidden">
          <SheetHeader className="px-0">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Goals, rewards, and your settings.</SheetDescription>
          </SheetHeader>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <span className="text-sm text-muted-foreground">Appearance</span>
            <ThemeToggle />
          </div>

          <ul className="space-y-1">
            {SECONDARY_NAV.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <li key={item.href}>
                  <SheetClose asChild>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex min-h-12 items-center gap-3 rounded-md border border-transparent px-3 text-sm transition-colors duration-150',
                        active
                          ? 'border-border bg-primary/8 font-medium text-primary'
                          : 'text-foreground hover:bg-muted/50',
                      )}
                    >
                      <item.icon className="size-[1.1rem] shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  </SheetClose>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Signed in as <span className="text-foreground">{viewer.displayName}</span>
            </p>
            <form action={signOutAction} className="mt-3">
              <Button type="submit" variant="outline" className="w-full justify-start">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
