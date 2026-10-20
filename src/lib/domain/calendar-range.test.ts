import { describe, expect, it } from 'vitest';

import {
  CALENDAR_VIEWS,
  VIEW_LABELS,
  daysInRange,
  rangeContains,
  rangeFor,
  rangeLabel,
  rangeLength,
  shiftAnchor,
} from '@/lib/domain/calendar-range';

/**
 * Which days each view covers.
 *
 * The two mistakes worth guarding against are a month view that starts on the
 * 1st instead of on the first day of the week that contains it (which leaves a
 * ragged first row), and paging that jumps from the 31st into the wrong month.
 */

describe('rangeFor', () => {
  it('covers a single day in the day view', () => {
    expect(rangeFor('day', '2025-01-15', 1)).toEqual({ from: '2025-01-15', to: '2025-01-15' });
  });

  it('covers seven days from the chosen week start', () => {
    // Wednesday 15 January 2025.
    expect(rangeFor('week', '2025-01-15', 1)).toEqual({ from: '2025-01-13', to: '2025-01-19' });
    expect(rangeFor('week', '2025-01-15', 0)).toEqual({ from: '2025-01-12', to: '2025-01-18' });
  });

  it('gives the month view whole weeks, not the 1st to the 31st', () => {
    // January 2025 runs Wednesday 1st to Friday 31st, so the view spans the
    // Monday of the first week to the Sunday of the last.
    expect(rangeFor('month', '2025-01-15', 1)).toEqual({ from: '2024-12-30', to: '2025-02-02' });
  });

  it('always spans whole weeks, whichever day of the month is the anchor', () => {
    const anchors = ['2025-01-01', '2025-01-15', '2025-01-31', '2024-02-29', '2025-06-01'];
    for (const anchor of anchors) {
      const range = rangeFor('month', anchor, 1);
      expect(rangeLength(range) % 7).toBe(0);
      expect(rangeContains(range, anchor)).toBe(true);
    }
  });
});

describe('rangeLength and daysInRange', () => {
  it('counts both ends', () => {
    expect(rangeLength({ from: '2025-01-15', to: '2025-01-15' })).toBe(1);
    expect(rangeLength({ from: '2025-01-13', to: '2025-01-19' })).toBe(7);
    expect(rangeLength({ from: '2024-12-30', to: '2025-02-02' })).toBe(35);
  });

  it('lists the days in order, starting with the first', () => {
    const days = daysInRange({ from: '2025-01-13', to: '2025-01-19' });
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2025-01-13');
    expect(days.at(-1)).toBe('2025-01-19');
    expect(days[3]).toBe('2025-01-16');
  });

  it('agrees with the length of the range it describes', () => {
    const range = rangeFor('month', '2025-02-10', 1);
    expect(daysInRange(range)).toHaveLength(rangeLength(range));
  });
});

describe('shiftAnchor', () => {
  it('moves a day at a time, and a week at a time', () => {
    expect(shiftAnchor('day', '2025-01-15', -1)).toBe('2025-01-14');
    expect(shiftAnchor('day', '2025-01-15', 1)).toBe('2025-01-16');
    expect(shiftAnchor('week', '2025-01-15', 1)).toBe('2025-01-22');
    expect(shiftAnchor('week', '2025-01-15', -1)).toBe('2025-01-08');
  });

  it('pages by calendar month, keeping the day of the month', () => {
    expect(shiftAnchor('month', '2025-01-15', 1)).toBe('2025-02-15');
    expect(shiftAnchor('month', '2025-01-15', -1)).toBe('2024-12-15');
    expect(shiftAnchor('month', '2025-12-15', 1)).toBe('2026-01-15');
  });

  it('clamps to the last day of a shorter month instead of skipping it', () => {
    expect(shiftAnchor('month', '2025-01-31', 1)).toBe('2025-02-28');
    expect(shiftAnchor('month', '2024-01-31', 1)).toBe('2024-02-29');
    expect(shiftAnchor('month', '2025-03-31', -1)).toBe('2025-02-28');
  });
});

describe('rangeLabel', () => {
  it('names a single day in full', () => {
    expect(rangeLabel('day', '2025-01-15', { from: '2025-01-15', to: '2025-01-15' })).toBe(
      'Wednesday 15 January 2025',
    );
  });

  it('names the month being viewed', () => {
    expect(rangeLabel('month', '2025-01-15', rangeFor('month', '2025-01-15', 1))).toBe('January 2025');
  });

  it('shortens a week inside one month', () => {
    expect(rangeLabel('week', '2025-01-15', { from: '2025-01-13', to: '2025-01-19' })).toBe(
      '13–19 January 2025',
    );
  });

  it('keeps both month names when a week crosses a boundary', () => {
    expect(rangeLabel('week', '2025-01-27', { from: '2025-01-27', to: '2025-02-02' })).toBe(
      '27 Jan – 2 Feb 2025',
    );
  });
});

describe('rangeContains', () => {
  it('includes both ends and excludes the day after', () => {
    const range = { from: '2025-01-13', to: '2025-01-19' };
    expect(rangeContains(range, '2025-01-12')).toBe(false);
    expect(rangeContains(range, '2025-01-13')).toBe(true);
    expect(rangeContains(range, '2025-01-19')).toBe(true);
    expect(rangeContains(range, '2025-01-20')).toBe(false);
  });
});

describe('the view list', () => {
  it('offers every view, in order, with a label', () => {
    expect(CALENDAR_VIEWS).toEqual(['month', 'week', 'day']);
    expect(VIEW_LABELS).toEqual({ month: 'Month', week: 'Week', day: 'Day' });
  });
});
