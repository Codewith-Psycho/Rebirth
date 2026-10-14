import { cn } from '@/lib/utils';

/**
 * Loading placeholder.
 *
 * `aria-hidden` because a skeleton says nothing a screen reader needs; the
 * surrounding region carries the real busy state via `aria-busy` and a live
 * status message.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
