import type { Result } from '@/lib/data/result';

/**
 * The write contract shared by every task surface.
 *
 * Today and the Calendar both host task rows, and both need to write through
 * whatever screen-level provider they are inside — Today has its own snapshot to
 * refresh, the Calendar has its own window. Declaring the shape in one place
 * means a task row behaves identically in both without either screen having to
 * know about the other.
 */
export type Mutator = <T>(
  action: () => Promise<Result<T>>,
  options?: { success?: string; quiet?: boolean },
) => Promise<Result<T>>;
