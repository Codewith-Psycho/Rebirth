'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Theme.
 *
 * The choice is persisted by `next-themes` and applied as a class on `<html>`,
 * which is what the token sets in `globals.css` key off. `system` is the
 * default so the app matches the machine until the user says otherwise.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="rebirth-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
