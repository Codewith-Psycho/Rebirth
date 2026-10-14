import type { DayMode } from '@/lib/types/database';
import { type DayKey, dayOfWeek, diffInDays } from './time';

/**
 * Planning vs doing.
 *
 * The mode is derived, never stored as a mutable flag, so it cannot drift out
 * of step with the user's preferences or their calendar. An explicit override
 * always wins over the schedule-derived default.
 */

export interface PressureWindow {
  title: string;
  startsOn: DayKey;
  endsOn: DayKey | null;
  pressureLeadDays: number;
  recoveryDays: number;
}

export interface DayModeInput {
  day: DayKey;
  plannerDay: number;
  override: DayMode | null;
  pressureEvents: PressureWindow[];
}

export interface DayModeResult {
  mode: DayMode;
  reason: string;
  /** The event driving Pressure-Week, when there is one. */
  pressureEvent: PressureWindow | null;
  isRecoveryDay: boolean;
}

export function resolveDayMode(input: DayModeInput): DayModeResult {
  const { day, plannerDay, override, pressureEvents } = input;

  for (const event of pressureEvents) {
    const end = event.endsOn ?? event.startsOn;
    const pressureStart = shiftDays(event.startsOn, -event.pressureLeadDays);
    const recoveryEnd = shiftDays(end, event.recoveryDays);

    if (diffInDays(day, pressureStart) >= 0 && diffInDays(day, end) <= 0) {
      return {
        mode: 'pressure',
        reason: `${event.title} is close. Deep work is capped and breaks are enforced until it is over.`,
        pressureEvent: event,
        isRecoveryDay: false,
      };
    }

    if (event.recoveryDays > 0 && diffInDays(day, end) > 0 && diffInDays(day, recoveryEnd) <= 0) {
      return {
        mode: 'plan',
        reason: `${event.title} is behind you. This is a Recovery Day — the schedule stays light on purpose.`,
        pressureEvent: event,
        isRecoveryDay: true,
      };
    }
  }

  if (override !== null) {
    return {
      mode: override,
      reason: 'Set manually in Settings.',
      pressureEvent: null,
      isRecoveryDay: false,
    };
  }

  const weekday = dayOfWeek(day);
  if (weekday === plannerDay && pressureEvents.length === 0) {
    return {
      mode: 'plan',
      reason: 'Your planning day. The week gets looked at, then the week gets lived.',
      pressureEvent: null,
      isRecoveryDay: false,
    };
  }

  return {
    mode: 'do',
    reason: 'A working day. Today is for executing what is already planned.',
    pressureEvent: null,
    isRecoveryDay: false,
  };
}

export function isPlanningUnlocked(mode: DayMode): boolean {
  return mode === 'plan';
}

/** Days in the current window where planning is deliberately closed. */
export function planningLockMessage(mode: DayMode, plannerDay: number): string | null {
  if (mode === 'plan') return null;
  const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][plannerDay] ?? 'Sunday';
  if (mode === 'pressure') {
    return 'Planning is closed while Pressure-Week is active. Quick capture still works, and urgent changes are never blocked.';
  }
  return `Planning opens on ${name}. Until then, ideas go to quick capture and the day stays simple.`;
}

function shiftDays(day: DayKey, amount: number): DayKey {
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Greeting copy. Deliberately flat and non-evaluative: a greeting is not the
 * place to editorialise about how the day is going.
 */
export function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Winding down';
}
