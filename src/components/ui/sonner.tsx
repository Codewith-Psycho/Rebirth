'use client';

import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * The single toast surface for the app.
 *
 * Positioned bottom-centre: on a phone that is inside thumb reach, and on
 * desktop it sits clear of the sidebar and any open dialog's top-right controls.
 *
 * Toasts are only ever raised for something that *actually happened* — a write
 * that succeeded, or a failure that needs the user's attention. There is no
 * code path that shows a success toast for a request that failed.
 */
export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-center"
      closeButton
      duration={5000}
      gap={8}
      offset={16}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-md border border-border bg-surface text-foreground shadow-elevated text-sm',
          description: 'text-muted-foreground',
          actionButton: 'rounded-sm bg-primary px-2 py-1 text-primary-foreground text-xs',
          cancelButton: 'rounded-sm bg-muted px-2 py-1 text-muted-foreground text-xs',
          closeButton: 'border-border bg-surface text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
