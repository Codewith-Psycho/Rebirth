'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Check, Monitor, Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const;

/**
 * The theme choice is persisted by `next-themes`, so it survives reloads and
 * navigations, and `system` keeps tracking the OS rather than freezing whatever
 * it happened to be at first paint.
 *
 * The trigger renders a neutral icon until the component has mounted: the
 * resolved theme is unknowable during server rendering, and guessing produces a
 * hydration mismatch.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-muted-foreground', className)}
          aria-label={mounted ? `Appearance: ${theme ?? 'system'}` : 'Appearance'}
        >
          {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => setTheme(option.value)}>
            <option.icon className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1">{option.label}</span>
            {theme === option.value ? (
              <Check className="size-4 text-accent" aria-hidden="true" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
