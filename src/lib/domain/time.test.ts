import { describe, expect, it } from 'vitest';

import {
  MINUTES_PER_DAY,
  addDaysToKey,
  clampDayKey,
  clockOffsetFrom,
  combineLocalDateTime,
  correctedNow,
  dayKeyOf,
  dayOfWeek,
  diffInDays,
  eachDayKey,
  elapsedDaysIn,
  endOfMonthKey,
  endTimeString,
  formatDuration,
  formatInstant,
  formatStopwatch,
  humanDay,
  instantToLocalMinutes,
  minutesBetween,
  minutesToClock,
  minutesToTimeString,
  parseClockInput,
  parseDateInput,
  startOfMonthKey,
  startOfWeekKey,
  timeToMinutes,
  todayInZone,
} from '@/lib/domain/time';

/**
 * The two kinds of value the app never lets itself confuse: day keys
 * (`YYYY-MM-DD`), which are calendar days and must not move with a timezone,
 * and instants, which are absolute and must.
 *
 * Every clock is passed in. Nothing here reads the current time, so nothing
 * here can become flaky at midnight or on a machine with a wrong date.
 */

describe('day keys', () => {
  it('adds and subtracts days across month, leap-year and year boundaries', () => {
    expect(addDaysToKey('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDaysToKey('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDaysToKey('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDaysToKey('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDaysToKey('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDaysToKey('2025-03-01', -1)).toBe('2025-02-28');
  });

  it('keeps a day a day across a daylight-saving change', () => {
    // The UK clocks go forward on 2025-03-30 and back on 2025-10-26. Day-key
    // arithmetic never touches instants, so neither moves the answer.
    expect(addDaysToKey('2025-03-30', 1)).toBe('2025-03-31');
    expect(addDaysToKey('2025-10-26', 1)).toBe('2025-10-27');
    expect(diffInDays('2025-03-31', '2025-03-30')).toBe(1);
    expect(diffInDays('2025-10-27', '2025-10-26')).toBe(1);
  });

  it('counts differences as calendar days, in both directions', () => {
    expect(diffInDays('2025-01-15', '2025-01-15')).toBe(0);
    expect(diffInDays('2025-01-16', '2025-01-15')).toBe(1);
    expect(diffInDays('2025-01-15', '2025-01-16')).toBe(-1);
    expect(diffInDays('2025-01-01', '2024-12-31')).toBe(1);
    expect(diffInDays('2025-03-01', '2025-02-28')).toBe(1);
  });

  it('enumerates an inclusive range and refuses a backwards one', () => {
    expect(eachDayKey('2025-01-01', '2025-01-01')).toEqual(['2025-01-01']);
    expect(eachDayKey('2025-02-27', '2025-03-02')).toEqual([
      '2025-02-27',
      '2025-02-28',
      '2025-03-01',
      '2025-03-02',
    ]);
    expect(eachDayKey('2025-01-03', '2025-01-01')).toEqual([]);
  });

  it('clamps a day into a window without ever leaving it', () => {
    expect(clampDayKey('2025-01-10', '2025-01-01', '2025-01-31')).toBe('2025-01-10');
    expect(clampDayKey('2024-12-20', '2025-01-01', '2025-01-31')).toBe('2025-01-01');
    expect(clampDayKey('2025-02-05', '2025-01-01', '2025-01-31')).toBe('2025-01-31');
  });

  it('names weekdays, month boundaries and week starts', () => {
    expect(dayOfWeek('2025-01-15')).toBe(3); // Wednesday
    expect(startOfWeekKey('2025-01-15', 1)).toBe('2025-01-13'); // Monday
    expect(startOfWeekKey('2025-01-15', 0)).toBe('2025-01-12'); // Sunday
    expect(startOfMonthKey('2025-01-15')).toBe('2025-01-01');
    expect(endOfMonthKey('2025-02-10')).toBe('2025-02-28');
    expect(endOfMonthKey('2024-02-10')).toBe('2024-02-29');
  });

  it('labels nearby days relatively and distant ones absolutely', () => {
    expect(humanDay('2025-01-15', '2025-01-15')).toBe('Today');
    expect(humanDay('2025-01-16', '2025-01-15')).toBe('Tomorrow');
    expect(humanDay('2025-01-14', '2025-01-15')).toBe('Yesterday');
    expect(humanDay('2025-01-20', '2025-01-15')).toBe('Mon 20 Jan');
  });

  it('counts the days of a window that have elapsed, inclusive of both ends', () => {
    // Mid-window: from the 1st to today is five days.
    expect(elapsedDaysIn('2025-01-01', '2025-01-10', '2025-01-05')).toBe(5);
    // A window that has already ended counts all of itself.
    expect(elapsedDaysIn('2025-01-01', '2025-01-03', '2025-01-05')).toBe(3);
    // A window that is only today counts one day.
    expect(elapsedDaysIn('2025-01-05', '2025-01-10', '2025-01-05')).toBe(1);
    // A window that has not started yet has elapsed nothing.
    expect(elapsedDaysIn('2025-01-06', '2025-01-10', '2025-01-05')).toBe(0);
  });
});

describe('timezones', () => {
  it('puts an instant on the calendar date it falls on locally', () => {
    const lateEvening = '2025-01-15T23:30:00.000Z';
    expect(dayKeyOf(lateEvening, 'UTC')).toBe('2025-01-15');
    expect(dayKeyOf(lateEvening, 'Europe/London')).toBe('2025-01-15'); // UTC+0 in January
    expect(dayKeyOf(lateEvening, 'Pacific/Kiritimati')).toBe('2025-01-16'); // UTC+14
  });

  it('can put the same instant on the previous day west of UTC', () => {
    const earlyMorning = '2025-01-15T02:30:00.000Z';
    expect(dayKeyOf(earlyMorning, 'UTC')).toBe('2025-01-15');
    expect(dayKeyOf(earlyMorning, 'America/Los_Angeles')).toBe('2025-01-14'); // UTC-8
  });

  it('answers "today" in the given zone, not on the machine', () => {
    const instant = new Date('2025-06-30T23:30:00.000Z');
    expect(todayInZone('UTC', instant)).toBe('2025-06-30');
    expect(todayInZone('Pacific/Kiritimati', instant)).toBe('2025-07-01');
  });

  it('builds the instant a local wall-clock time belongs to, including under DST', () => {
    expect(combineLocalDateTime('2025-01-15', '09:00', 'Europe/London').toISOString()).toBe(
      '2025-01-15T09:00:00.000Z',
    );
    // British Summer Time: 09:00 local is 08:00 UTC.
    expect(combineLocalDateTime('2025-07-15', '09:00', 'Europe/London').toISOString()).toBe(
      '2025-07-15T08:00:00.000Z',
    );
    // The day the clocks go forward, midday is already UTC+1.
    expect(combineLocalDateTime('2025-03-30', '12:00', 'Europe/London').toISOString()).toBe(
      '2025-03-30T11:00:00.000Z',
    );
    // A half-hour zone.
    expect(combineLocalDateTime('2025-01-15', '09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2025-01-15T03:30:00.000Z',
    );
  });

  it('accepts a time with or without seconds', () => {
    expect(combineLocalDateTime('2025-01-15', '09:00:00', 'UTC').toISOString()).toBe(
      '2025-01-15T09:00:00.000Z',
    );
  });

  it('reads wall-clock minutes back out of an instant', () => {
    const instant = new Date('2025-07-15T08:00:00.000Z');
    expect(instantToLocalMinutes(instant, 'UTC')).toBe(480);
    expect(instantToLocalMinutes(instant, 'Europe/London')).toBe(540);
  });

  it('formats an instant in a zone, with a pattern', () => {
    const instant = '2025-01-15T09:00:00.000Z';
    expect(formatInstant(instant, 'UTC')).toBe('09:00');
    expect(formatInstant(instant, 'America/New_York')).toBe('04:00');
    expect(formatInstant(instant, 'America/New_York', 'yyyy-MM-dd HH:mm')).toBe('2025-01-15 04:00');
  });
});

describe('the server-corrected clock', () => {
  it('records how far the device clock is from the server', () => {
    const server = new Date('2025-01-15T09:00:00.000Z');
    const device = new Date('2025-01-15T09:00:30.000Z');
    expect(clockOffsetFrom(server, device)).toEqual({ offsetMs: -30_000 });
  });

  it('applies that offset to a later reading', () => {
    const offset = { offsetMs: -30_000 };
    expect(correctedNow(offset, new Date('2025-01-15T09:05:00.000Z')).toISOString()).toBe(
      '2025-01-15T09:04:30.000Z',
    );
  });
});

describe('durations and clock strings', () => {
  it('parses time-of-day strings into minutes since midnight', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('09:30')).toBe(570);
    expect(timeToMinutes('9:30')).toBe(570);
    expect(timeToMinutes('09:30:00')).toBe(570);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('formats minutes since midnight for PostgreSQL and for people', () => {
    expect(minutesToTimeString(570)).toBe('09:30:00');
    expect(minutesToTimeString(0)).toBe('00:00:00');
    // A time that runs past midnight wraps rather than overflowing.
    expect(minutesToTimeString(MINUTES_PER_DAY + 60)).toBe('01:00:00');
    expect(minutesToTimeString(-60)).toBe('23:00:00');

    expect(minutesToClock(570)).toBe('09:30');
    expect(minutesToClock(0, false)).toBe('12:00 AM');
    expect(minutesToClock(720, false)).toBe('12:00 PM');
    expect(minutesToClock(810, false)).toBe('1:30 PM');
  });

  it('ends a task at the clock time it actually finishes', () => {
    expect(endTimeString('09:30', 45)).toBe('10:15');
    expect(endTimeString('23:30', 60)).toBe('00:30');
  });

  it('reads a duration in hours and minutes', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(-10)).toBe('0m');
  });

  it('reads the stopwatch, which must never jitter or show negative time', () => {
    expect(formatStopwatch(0)).toBe('00:00');
    expect(formatStopwatch(59)).toBe('00:59');
    expect(formatStopwatch(60)).toBe('01:00');
    expect(formatStopwatch(3599)).toBe('59:59');
    expect(formatStopwatch(3600)).toBe('1:00:00');
    expect(formatStopwatch(3725)).toBe('1:02:05');
    expect(formatStopwatch(-5)).toBe('00:00');
  });

  it('measures between two instants, never below zero', () => {
    const nine = new Date('2025-01-15T09:00:00.000Z');
    const nineFortyFive = new Date('2025-01-15T09:45:00.000Z');
    expect(minutesBetween(nine, nineFortyFive)).toBe(45);
    expect(minutesBetween(nineFortyFive, nine)).toBe(0);
  });
});

describe('reading what someone typed', () => {
  it('accepts a time field, and refuses anything it cannot trust', () => {
    expect(parseClockInput('09:05')).toBe(545);
    expect(parseClockInput('9:05')).toBe(545);
    expect(parseClockInput(' 9:05 ')).toBe(545);
    expect(parseClockInput('24:00')).toBeNull();
    expect(parseClockInput('09:60')).toBeNull();
    expect(parseClockInput('9:5')).toBeNull();
    expect(parseClockInput('')).toBeNull();
    expect(parseClockInput('quarter past nine')).toBeNull();
  });

  it('accepts a complete date field, and refuses anything else', () => {
    expect(parseDateInput('2025-01-15')).toBe('2025-01-15');
    expect(parseDateInput('2024-02-29')).toBe('2024-02-29');
    expect(parseDateInput('')).toBeNull();
    expect(parseDateInput('not a date')).toBeNull();
  });
});
