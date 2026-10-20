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

import { loadCalendarFacts, type CalendarFacts } from '@/lib/data/calendar-view';
import {
  rangeFor,
  type CalendarRange,
  type CalendarView,
} from '@/lib/domain/calendar-range';
import { todayInZone, type DayKey } from '@/lib/domain/time';
import { useRealtime } from '@/lib/hooks/use-realtime';
import { useServerClock } from '@/lib/hooks/use-server-clock';
import { useSupabase, useViewer } from '@/lib/hooks/use-viewer';
import type { Mutator } from '@/components/tasks/types';

/**
 * The calendar's data layer.
 *
 * Two things this deliberately does:
 *
 *   1. **The range is derived from the view.** Changing view or paging re-loads
 *      exactly the days that are now on screen, so the grid never renders a day
 *      it has no data for while quietly showing the previous window's contents.
 *   2. **Writes go through the same `mutate` contract as everything else.** A
 *      failure surfaces the database's own explanation and nothing is applied
 *      optimistically, so the calendar cannot show a change that did not land.
 */

const REALTIME_TABLES = [
  'scheduled_tasks',
  'task_sessions',
  'calendar_events',
  'important_events',
  'goal_milestones',
];

export interface CalendarMutateOptions {
  success?: string;
  quiet?: boolean;
}

export interface CalendarApi {
  facts: CalendarFacts;
  view: CalendarView;
  anchor: DayKey;
  range: CalendarRange;
  clock: Date;
  today: DayKey;
  error: string | null;
  loading: boolean;
  sync: 'idle' | 'connecting' | 'live' | 'unavailable';
  setView: (view: CalendarView) => void;
  setAnchor: (anchor: DayKey) => void;
  goToToday: () => void;
  refresh: () => void;
  mutate: Mutator;
}

const CalendarContext = createContext<CalendarApi | null>(null);

export function useCalendarApi(): CalendarApi {
  const api = useContext(CalendarContext);
  if (!api) throw new Error('useCalendarApi must be used inside <CalendarProvider>.');
  return api;
}

export function CalendarProvider({
  initial,
  initialAnchor,
  children,
}: {
  initial: CalendarFacts;
  initialAnchor: DayKey;
  children: ReactNode;
}) {
  const supabase = useSupabase();
  const viewer = useViewer();
  const weekStartsOn = viewer.preferences.week_starts_on;

  // Week is the default: a month is too coarse to act on, and a single day
  // hides the context that makes planning a week possible.
  const [view, setViewState] = useState<CalendarView>('week');
  const [anchor, setAnchorState] = useState<DayKey>(initialAnchor);
  const [facts, setFacts] = useState<CalendarFacts>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const clock = useServerClock({ tickMs: 30_000 });
  const today = todayInZone(viewer.timeZone, clock);

  const range = useMemo(() => rangeFor(view, anchor, weekStartsOn), [view, anchor, weekStartsOn]);
  const rangeKey = `${range.from}:${range.to}`;
  const loadedRangeKey = useRef(
    `${rangeFor('week', initialAnchor, weekStartsOn).from}:${rangeFor('week', initialAnchor, weekStartsOn).to}`,
  );
  const inFlight = useRef(false);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!options.silent) setLoading(true);

      try {
        const result = await loadCalendarFacts(supabase, {
          from: range.from,
          to: range.to,
          today: todayInZone(viewer.timeZone, clock),
          timeZone: viewer.timeZone,
        });

        if (result.ok) {
          setFacts(result.data);
          loadedRangeKey.current = rangeKey;
          setError(null);
        } else {
          setError(result.error);
        }
      } catch (thrown) {
        setError(
          thrown instanceof Error
            ? thrown.message
            : 'The calendar could not be loaded. Nothing you recorded was lost.',
        );
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [supabase, range.from, range.to, rangeKey, viewer.timeZone, clock],
  );

  // Re-load whenever the window on screen changes.
  useEffect(() => {
    if (loadedRangeKey.current === rangeKey) return;
    void load({ silent: true });
  }, [rangeKey, load]);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  const mutate = useCallback<Mutator>(
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

  const setView = useCallback((next: CalendarView) => setViewState(next), []);
  const setAnchor = useCallback((next: DayKey) => setAnchorState(next), []);
  const goToToday = useCallback(() => {
    setAnchorState(todayInZone(viewer.timeZone, clock));
  }, [viewer.timeZone, clock]);

  const value = useMemo<CalendarApi>(
    () => ({
      facts,
      view,
      anchor,
      range,
      clock,
      today,
      error,
      loading,
      sync,
      setView,
      setAnchor,
      goToToday,
      refresh,
      mutate,
    }),
    [facts, view, anchor, range, clock, today, error, loading, sync, setView, setAnchor, goToToday, refresh, mutate],
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}
