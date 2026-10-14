'use client';

import Link from 'next/link';
import { ChevronDown, LogOut, Settings, User } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOutAction } from '@/lib/auth/actions';
import { useViewer } from '@/lib/hooks/use-viewer';

/** Two letters from the display name, falling back to the email address. */
function initialsFor(name: string, email: string | null): string {
  const source = name.trim() || email || 'You';
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? 'Y';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

export function UserMenu() {
  const viewer = useViewer();
  const initials = initialsFor(viewer.displayName, viewer.email);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 sm:px-2" aria-label="Your account">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-primary/10 font-serif text-xs font-semibold text-primary"
          >
            {initials}
          </span>
          <span className="hidden max-w-[9rem] truncate text-sm font-medium sm:inline">
            {viewer.displayName}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">
            {viewer.displayName}
          </span>
          {viewer.email ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {viewer.email}
            </span>
          ) : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <User className="size-4 text-muted-foreground" aria-hidden="true" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="size-4 text-muted-foreground" aria-hidden="true" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/*
          A real form submission rather than an onClick handler: sign-out is a
          server action that redirects, so it keeps working without JavaScript
          and cannot half-apply if the tab is closed mid-request.
        */}
        <form action={signOutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">
              <LogOut className="size-4 text-muted-foreground" aria-hidden="true" />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
