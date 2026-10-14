'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

import { loadScheduleFacts, type ScheduleFacts } from '@/lib/data/schedule';
import type { Result } from '@/lib/data/result';
import { todayInZone, type DayKey } from '@/lib/domain/time';
import { useRealtime } from '@/lib/hooks/use-realtime';
import { useServerClock } from '@/lib/hooks/use-server-clock';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import type { Mutator } from '@/components/tasks/types';

/**
 * The schedule's data layer.
 *
 * The window is fixed — today plus four weeks — because the question this screen
 * answers is "what does my rhythm look like from here", and a window that paged
 * away from today would make the routines' next days meaningless. Writes go
 * through the same `mutate` contract as every other screen, so a failure is
 * reported and reverted rather than shown as if it had landed.
 */

const REALTIME_TABLES = ['scheduled_tasks', 'task_templates', 'calendar_events'];

export interface ScheduleApi {
  facts: ScheduleFacts;
  /** The day whose plan and availability are on screen. */
  day: DayKey;
  clock: Date;
  today: DayKey;
  error: string | null;
  loading: boolean;
  sync: 'idle' | 'connecting' | 'live' | 'unavailable';
  setDay: (day: DayKey) => void;
  goToToday: () => void;
  refresh: () => void;
  mutate: Mutator;
}

const ScheduleContext = createContext<ScheduleApi | null>(null);

export function useScheduleApi(): ScheduleApi {
  const api = useContext(ScheduleContext);
  if (!api) throw new Error('useScheduleApi must be used inside <ScheduleProvider>.');
  return api;
}

export function ScheduleProvider({
  initial,
  children,
}: {
  initial: ScheduleFacts;
  children: ReactNode;
}) {
  const supabase = useSupabase();
  const viewer = useViewer();

  const [facts, setFacts] = useState<ScheduleFacts>(initial);
  const [day, setDayState] = useState<DayKey>(initial.today);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clock = useServerClock({ tickMs: 60_000 });
  const today = todayInZone(viewer.timeZone, clock);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!options.silent) setLoading(true);
      try {
        const result = await loadScheduleFacts(supabase, {
          today: todayInZone(viewer.timeZone, clock),
          timeZone: viewer.timeZone,
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
            : 'Your routine could not be loaded. Nothing you recorded was lost.',
        );
      } finally {
        setLoading(false);
      }
    },
    [supabase, viewer.timeZone, clock],
  );

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const mutate = useCallback<Mutator>(
    async (action, options = {}) => {
      let result: Result<unknown>;
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
        toast.error(result.error);
        return result;
      }

      if (options.success && !options.quiet) toast.success(options.success);
      await load({ silent: true });
      return result;
    },
    [load],
  );

  const sync = useRealtime(viewer.userId, REALTIME_TABLES, () => {
    void load({ silent: true });
  });

  const setDay = useCallback((next: DayKey) => setDayState(next), []);

  const value = useMemo<ScheduleApi>(
    () => ({
      facts,
      day,
      clock,
      today,
      error,
      loading,
      sync,
      setDay,
      goToToday: () => setDayState(todayInZone(viewer.timeZone, clock)),
      refresh,
      mutate,
    }),
    [facts, day, clock, today, error, loading, sync, setDay, viewer.timeZone, refresh, mutate],
  );

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}
