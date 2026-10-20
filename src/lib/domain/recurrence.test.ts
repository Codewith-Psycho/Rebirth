import { describe, expect, it } from 'vitest';

import {
  type RecurrenceRule,
  describeRecurrence,
  expandOccurrences,
  occursOn,
  previewRoutineDays,
  taskSlot,
  weekdayName,
  weekdayShort,
} from '@/lib/domain/recurrence';

/**
 * Recurrence rules.
 *
 * The interesting cases are the boundaries: the day a rule starts, the day it
 * ends (which is inclusive), and the days a window clips off. Getting any of
 * them wrong duplicates or silently drops a series.
 */

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return { kind: 'daily', weekdays: [], startsOn: '2025-01-01', endsOn: null, ...overrides };
}

describe('occursOn', () => {
  it('produces nothing before the rule starts', () => {
    const daily = rule({ startsOn: '2025-01-15' });
    expect(occursOn(daily, '2025-01-14')).toBe(false);
    expect(occursOn(daily, '2025-01-15')).toBe(true);
    expect(occursOn(daily, '2025-01-16')).toBe(true);
  });

  it('includes the end day and stops the day after', () => {
    const bounded = rule({ startsOn: '2025-01-15', endsOn: '2025-01-20' });
    expect(occursOn(bounded, '2025-01-20')).toBe(true);
    expect(occursOn(bounded, '2025-01-21')).toBe(false);
  });

  it('covers Monday to Friday for a weekday rule', () => {
    const weekdays = rule({ kind: 'weekdays' });
    expect(occursOn(weekdays, '2025-01-20')).toBe(true); // Monday
    expect(occursOn(weekdays, '2025-01-17')).toBe(true); // Friday
    expect(occursOn(weekdays, '2025-01-18')).toBe(false); // Saturday
    expect(occursOn(weekdays, '2025-01-19')).toBe(false); // Sunday
  });

  it('covers only the weekend for a weekend rule', () => {
    const weekends = rule({ kind: 'weekends' });
    expect(occursOn(weekends, '2025-01-18')).toBe(true); // Saturday
    expect(occursOn(weekends, '2025-01-19')).toBe(true); // Sunday
    expect(occursOn(weekends, '2025-01-17')).toBe(false); // Friday
  });

  it('follows the chosen weekdays for a custom week', () => {
    const monWedFri = rule({ kind: 'custom_weekly', weekdays: [1, 3, 5] });
    expect(occursOn(monWedFri, '2025-01-20')).toBe(true); // Monday
    expect(occursOn(monWedFri, '2025-01-22')).toBe(true); // Wednesday
    expect(occursOn(monWedFri, '2025-01-24')).toBe(true); // Friday
    expect(occursOn(monWedFri, '2025-01-21')).toBe(false); // Tuesday
    expect(occursOn(monWedFri, '2025-01-25')).toBe(false); // Saturday
  });

  it('never fires a custom week with no days chosen', () => {
    const nothing = rule({ kind: 'custom_weekly', weekdays: [] });
    expect(occursOn(nothing, '2025-01-15')).toBe(false);
  });

  it('fires a one-off rule on its own day only', () => {
    const once = rule({ kind: 'none', startsOn: '2025-01-15' });
    expect(occursOn(once, '2025-01-14')).toBe(false);
    expect(occursOn(once, '2025-01-15')).toBe(true);
    expect(occursOn(once, '2025-01-16')).toBe(false);
  });
});

describe('expandOccurrences', () => {
  it('returns exactly the days inside the window', () => {
    expect(expandOccurrences(rule(), '2025-01-03', '2025-01-05')).toEqual([
      '2025-01-03',
      '2025-01-04',
      '2025-01-05',
    ]);
  });

  it('does not reach back before the rule starts', () => {
    expect(expandOccurrences(rule({ startsOn: '2025-01-10' }), '2025-01-01', '2025-01-12')).toEqual([
      '2025-01-10',
      '2025-01-11',
      '2025-01-12',
    ]);
  });

  it('does not reach past the day the rule ends', () => {
    const bounded = rule({ startsOn: '2025-01-01', endsOn: '2025-01-03' });
    expect(expandOccurrences(bounded, '2025-01-01', '2025-01-10')).toEqual([
      '2025-01-01',
      '2025-01-02',
      '2025-01-03',
    ]);
  });

  it('returns nothing for a window that has already passed, or one out of order', () => {
    const ended = rule({ startsOn: '2025-01-01', endsOn: '2025-01-05' });
    expect(expandOccurrences(ended, '2025-01-10', '2025-01-20')).toEqual([]);
    expect(expandOccurrences(rule(), '2025-01-05', '2025-01-01')).toEqual([]);
  });

  it('collects only the chosen weekdays, in ascending order', () => {
    const monWedFri = rule({ kind: 'custom_weekly', weekdays: [1, 3, 5] });
    expect(expandOccurrences(monWedFri, '2025-01-01', '2025-01-07')).toEqual([
      '2025-01-01', // Wednesday
      '2025-01-03', // Friday
      '2025-01-06', // Monday
    ]);
  });
});

describe('describeRecurrence', () => {
  it('names each kind in plain words', () => {
    expect(describeRecurrence(rule({ kind: 'daily' }))).toBe('Every day');
    expect(describeRecurrence(rule({ kind: 'weekdays' }))).toBe('Monday to Friday');
    expect(describeRecurrence(rule({ kind: 'weekends' }))).toBe('Weekends');
    expect(describeRecurrence(rule({ kind: 'none' }))).toBe('One time');
  });

  it('lists custom days in week order, not the order they were picked', () => {
    expect(describeRecurrence(rule({ kind: 'custom_weekly', weekdays: [5, 1] }))).toBe('Mon, Fri');
  });

  it('says "every day" when every day is chosen, and nothing when none is', () => {
    expect(describeRecurrence(rule({ kind: 'custom_weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }))).toBe(
      'Every day',
    );
    expect(describeRecurrence(rule({ kind: 'custom_weekly', weekdays: [] }))).toBe('No days selected');
  });
});

describe('weekday names', () => {
  it('names the days and stays quiet outside them', () => {
    expect(weekdayName(0)).toBe('Sunday');
    expect(weekdayName(6)).toBe('Saturday');
    expect(weekdayShort(0)).toBe('Sun');
    expect(weekdayShort(6)).toBe('Sat');
    expect(weekdayName(7)).toBe('');
    expect(weekdayShort(-1)).toBe('');
  });
});

describe('previewRoutineDays', () => {
  it('previews the next days a routine would land on', () => {
    expect(previewRoutineDays(rule({ startsOn: '2025-01-15' }), '2025-01-15', 3)).toEqual([
      '2025-01-15',
      '2025-01-16',
      '2025-01-17',
    ]);
  });

  it('previews enough days even when the rule only fires weekly', () => {
    const fridays = rule({ kind: 'custom_weekly', weekdays: [5], startsOn: '2025-01-15' });
    expect(previewRoutineDays(fridays, '2025-01-15', 3)).toEqual([
      '2025-01-17',
      '2025-01-24',
      '2025-01-31',
    ]);
  });

  it('previews fewer days when the routine ends sooner', () => {
    const bounded = rule({
      kind: 'custom_weekly',
      weekdays: [5],
      startsOn: '2025-01-15',
      endsOn: '2025-01-24',
    });
    expect(previewRoutineDays(bounded, '2025-01-15', 3)).toEqual(['2025-01-17', '2025-01-24']);
  });
});

describe('taskSlot', () => {
  it('prefers the recorded slot and falls back to the scheduled day', () => {
    expect(taskSlot({ occurrence_date: '2025-01-16', scheduled_date: '2025-01-15' })).toBe('2025-01-16');
    expect(taskSlot({ occurrence_date: null, scheduled_date: '2025-01-15' })).toBe('2025-01-15');
  });
});
