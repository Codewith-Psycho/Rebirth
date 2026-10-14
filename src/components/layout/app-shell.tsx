'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { AppSidebar } from '@/components/layout/app-sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { UserMenu } from '@/components/layout/user-menu';
import { Wordmark } from '@/components/layout/wordmark';
import { TooltipProvider } from '@/components/ui/tooltip';
import { writeSidebarCollapsed } from '@/lib/ui-prefs';

/**
 * The application frame.
 *
 * One component owns the layout for every signed-in screen, so the sidebar,
 * the top bar and the mobile bar cannot drift apart. The collapse preference is
 * seeded from the server (a cookie, read in the layout) and written back here,
 * which means the frame is the right width on the first paint.
 */
export function AppShell({
  defaultCollapsed,
  children,
}: {
  defaultCollapsed: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    setCollapsed((previous) => {
      const next = !previous;
      writeSidebarCollapsed(next);
      return next;
    });
  }

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div className="flex min-h-[100dvh] w-full">
        <AppSidebar pathname={pathname} collapsed={collapsed} onToggle={toggle} />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
            <Wordmark className="md:hidden" />
            <div className="flex-1" />
            <ThemeToggle className="hidden md:inline-flex" />
            <UserMenu />
          </header>

          {/*
            `pb-24` on phones clears the fixed bottom bar plus the home
            indicator; from `md` up there is no bottom bar and the padding
            returns to normal.
          */}
          <main
            id="main"
            tabIndex={-1}
            className="flex-1 px-4 pb-24 pt-5 focus-visible:outline-none sm:px-6 sm:pt-6 md:pb-10 lg:px-8"
          >
            {children}
          </main>
        </div>
      </div>

      <MobileNav pathname={pathname} />
    </TooltipProvider>
  );
}
