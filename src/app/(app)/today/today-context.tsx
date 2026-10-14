'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { useRealtime } from '@/lib/hooks/use-realtime';
import { useServerClock } from '@/lib/hooks/use-server-clock';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import { loadToday, type TodayFacts } from '@/lib/data/today';
import type { Result } from '@/lib/data/result';
import { todayInZone } from '@/lib/domain/time';

/**
 * The Today screen's data and write layer.
 *
 * Three properties this deliberately has:
 *
 *   1. **One snapshot.** Every panel on the page reads the same `facts` object,
 *      so the metrics and the list can never disagree about what happened.
 *   2. **Writes are honest.** `mutate` reports the database's own answer. A
 *      failure shows the calm explanation it came with and *no* success toast,
 *      and a success is only announced after the write actually landed.
 *   3. **The day is derived, not assumed.** A timer running past midnight, or a
 *      tab left open overnight, triggers a reload against the new local day
 *      rather than quietly filing tonight's work under yesterday.
 */

/** Tables that can change what this screen shows. */
const REALTIME_TABLES = [
  'scheduled_tasks',
  'task_sessions',
  'task_session_pauses',
  'daily_energy_logs',
  'daily_reflections',
  'goal_milestones',
  'important_events',
];

export interface MutateOptions {
  /** Shown only once the write has actually succeeded. */
  success?: string;
  /** Skip the success announcement for a change the user can already see. */
  quiet?: boolean;
}

export interface TodayApi {
  facts: TodayFacts;
  /** Server-corrected now, refreshed every 30s; the timer uses its own 1s clock. */
  clock: Date;
  error: string | null;
  refreshing: boolean;
  /** Whether changes made elsewhere are arriving on their own. */
  sync: 'idle' | 'connecting' | 'live' | 'unavailable';
  refresh: () => void;
  mutate: <T>(
    action: () => Promise<Result<T>>,
    options?: MutateOptions,
  ) => Promise<Result<T>>;
}

const TodayContext = createContext<TodayApi | null>(null);

export function useTodayApi(): TodayApi {
  const api = useContext(TodayContext);
  if (!api) throw new Error('useTodayApi must be used inside <TodayProvider>.');
  return api;
}

export function TodayProvider({
  initial,
  children,
}: {
  initial: TodayFacts;
  children: ReactNode;
}) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const [facts, setFacts] = useState<TodayFacts>(initial);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // The day-level clock is cheap and coarse; the focus timer runs its own 1s
  // tick, so the whole page is not re-rendered once a second for a date.
  const clock = useServerClock({ tickMs: 30_000 });

  const clockRef = useRef(clock);
  clockRef.current = clock;
  const inFlight = useRef(false);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      // Two reloads arriving together (a Realtime ping and a user action) should
      // coalesce rather than race.
      if (inFlight.current) return;
      inFlight.current = true;
      if (!options.silent) setRefreshing(true);

      try {
        const now = clockRef.current;
        const result = await loadToday(supabase, {
          day: todayInZone(viewer.timeZone, now),
          timeZone: viewer.timeZone,
          preferences: viewer.preferences,
          now,
        });

        if (result.ok) {
          setFacts(result.data);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch (thrown) {
        setError(
          thrown instanceof Error
            ? thrown.message
            : 'Your day could not be loaded. Nothing you recorded was lost.',
        );
      } finally {
        inFlight.current = false;
        setRefreshing(false);
      }
    },
    [supabase, viewer.timeZone, viewer.preferences],
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const mutate = useCallback<TodayApi['mutate']>(
    async (action, options = {}) => {
      // Derived from `action` so the caller's generic flows through. Annotating
      // this as `Result<unknown>` erased `T` and broke the `Mutator` contract.
      let result: Awaited<ReturnType<typeof action>>;
      try {
        result = await action();
      } catch (thrown) {
        const message =
          thrown instanceof Error
            ? thrown.message
            : 'That change did not reach the database. Nothing was altered.';
        toast.error(message);
        return { ok: false, error: message, hint: null, code: null };
      }

      if (!result.ok) {
        // The failure keeps the explanation the data layer attached to it —
        // never a generic "something went wrong" in place of a real reason.
        toast.error(result.error);
        return result;
      }

      if (options.success && !options.quiet) toast.success(options.success);
      await load({ silent: true });
      return result;
    },
    [load],
  );

  const realtimeStatus = useRealtime(viewer.userId, REALTIME_TABLES, () => {
    void load({ silent: true });
  });

  // If the tab was open across midnight, the screen is showing yesterday. This
  // is the only thing that notices, so it is checked on every clock tick.
  const dayKey = todayInZone(viewer.timeZone, clock);
  useEffect(() => {
    if (dayKey !== facts.day) void load({ silent: true });
  }, [dayKey, facts.day, load]);

  const value = useMemo<TodayApi>(
    () => ({ facts, clock, error, refreshing, sync: realtimeStatus, refresh, mutate }),
    [facts, clock, error, refreshing, realtimeStatus, refresh, mutate],
  );

  return <TodayContext.Provider value={value}>{children}</TodayContext.Provider>;
}
