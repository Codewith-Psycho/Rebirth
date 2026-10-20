import { describe, expect, it } from 'vitest';

import {
  type TimeBlock,
  assessDayLoad,
  blockFromTimes,
  findConflicts,
  firstFreeSlot,
  freeIntervals,
  futureDays,
  futureMoveTargetAllowed,
  intervalLabel,
  makeBlock,
  nextWeekday,
  overlapMinutes,
  overlaps,
  replanDay,
  suggestSlots,
} from '@/lib/domain/scheduling';
import { MINUTES_PER_DAY } from '@/lib/domain/time';

/**
 * Schedule arithmetic. Everything is minutes since local midnight, so the whole
 * module can be exercised with plain integers — no clock, no database.
 */

function block(
  id: string,
  startMinutes: number,
  endMinutes: number,
  extra: Partial<TimeBlock> = {},
): TimeBlock {
  return makeBlock({ id, title: id, startMinutes, endMinutes, ...extra });
}

describe('overlap arithmetic', () => {
  it('treats back-to-back blocks as not overlapping', () => {
    const morning = { startMinutes: 540, endMinutes: 600 };
    const next = { startMinutes: 600, endMinutes: 660 };
    expect(overlaps(morning, next)).toBe(false);
    expect(overlapMinutes(morning, next)).toBe(0);
  });

  it('detects containment and identical spans', () => {
    const hour = { startMinutes: 540, endMinutes: 600 };
    const inside = { startMinutes: 555, endMinutes: 570 };
    expect(overlaps(hour, inside)).toBe(true);
    expect(overlapMinutes(hour, inside)).toBe(15);
    expect(overlaps(hour, { ...hour })).toBe(true);
    expect(overlapMinutes(hour, { ...hour })).toBe(60);
  });

  it('measures only the shared minutes', () => {
    const a = { startMinutes: 540, endMinutes: 600 };
    expect(overlapMinutes(a, { startMinutes: 570, endMinutes: 630 })).toBe(30);
    expect(overlapMinutes(a, { startMinutes: 610, endMinutes: 700 })).toBe(0);
  });

  it('is symmetrical', () => {
    const a = { startMinutes: 540, endMinutes: 600 };
    const b = { startMinutes: 570, endMinutes: 630 };
    expect(overlaps(a, b)).toBe(overlaps(b, a));
    expect(overlapMinutes(a, b)).toBe(overlapMinutes(b, a));
  });
});

describe('findConflicts', () => {
  it('reports each real overlap with its shared window, worst first', () => {
    const conflicts = findConflicts([
      block('a', 540, 600), // 09:00–10:00
      block('b', 570, 630), // 09:30–10:30 → 30 minutes with a
      block('c', 570, 660), // 09:30–11:00 → 30 with a, 60 with b
    ]);

    expect(conflicts[0]).toEqual({
      aId: 'b',
      bId: 'c',
      overlapMinutes: 60,
      window: { startMinutes: 570, endMinutes: 630 },
    });
    expect(conflicts.map((c) => c.overlapMinutes)).toEqual([60, 30, 30]);
  });

  it('finds nothing in a day that merely runs back to back', () => {
    expect(findConflicts([block('a', 540, 600), block('b', 600, 660), block('c', 660, 720)])).toEqual(
      [],
    );
  });

  it('does not stop early when a later block clears an earlier one', () => {
    // Sorted by start: a(09:00–10:00), b(09:30–11:00), c(10:30–12:00). a and c
    // do not overlap, so the scan past a must not hide the b/c clash.
    const conflicts = findConflicts([block('c', 630, 720), block('a', 540, 600), block('b', 570, 660)]);
    expect(conflicts.map((c) => `${c.aId}${c.bId}`).sort()).toEqual(['ab', 'bc']);
  });

  it('ignores input order', () => {
    const forwards = findConflicts([block('a', 540, 600), block('b', 570, 630)]);
    const backwards = findConflicts([block('b', 570, 630), block('a', 540, 600)]);
    expect(backwards).toEqual(forwards);
  });
});

describe('free time', () => {
  it('returns the whole day when nothing is scheduled', () => {
    expect(freeIntervals([])).toEqual([{ startMinutes: 0, endMinutes: MINUTES_PER_DAY }]);
  });

  it('merges touching and overlapping blocks before looking for gaps', () => {
    expect(freeIntervals([block('a', 540, 600), block('b', 585, 660)])).toEqual([
      { startMinutes: 0, endMinutes: 540 },
      { startMinutes: 660, endMinutes: MINUTES_PER_DAY },
    ]);
  });

  it('clips blocks to the day bounds', () => {
    // A block that starts before the day and ends after it leaves no gap at all.
    expect(freeIntervals([block('a', -60, MINUTES_PER_DAY + 60)])).toEqual([]);
  });

  it('drops the part of the day that has already gone', () => {
    // From 15:00, with 16:00–17:00 busy.
    expect(freeIntervals([block('a', 960, 1020)], 0, MINUTES_PER_DAY, 900)).toEqual([
      { startMinutes: 900, endMinutes: 960 },
      { startMinutes: 1020, endMinutes: MINUTES_PER_DAY },
    ]);
  });

  it('honours a shortened waking day', () => {
    expect(freeIntervals([block('a', 600, 660)], 540, 720)).toEqual([
      { startMinutes: 540, endMinutes: 600 },
      { startMinutes: 660, endMinutes: 720 },
    ]);
  });

  it('does not mutate the blocks it was given', () => {
    const blocks = [block('a', 540, 600), block('b', 570, 630)];
    freeIntervals(blocks);
    expect(blocks.map((b) => [b.startMinutes, b.endMinutes])).toEqual([
      [540, 600],
      [570, 630],
    ]);
  });
});

describe('firstFreeSlot', () => {
  it('snaps the start forward to the next five-minute mark', () => {
    // Free from 09:02, so the slot starts at 09:05 rather than 09:02.
    expect(firstFreeSlot([block('a', 0, 542)], 30)).toEqual({ startMinutes: 545, endMinutes: 575 });
  });

  it('returns null when nothing long enough is left', () => {
    // Busy from 09:00 to 23:40, so only the last twenty minutes of the day
    // remain — and the search starts at 09:00, not at midnight.
    expect(firstFreeSlot([block('a', 540, 1420)], 30, { afterMinutes: 540 })).toBeNull();
  });

  it('never proposes a slot that would run past the end of the day', () => {
    // Ten free minutes at the end of the day will hold a ten-minute task...
    expect(firstFreeSlot([block('a', 0, 1430)], 10)).toEqual({
      startMinutes: 1430,
      endMinutes: 1440,
    });
    // ...and twenty-five will not hold a thirty-minute one.
    expect(firstFreeSlot([block('a', 0, 1415)], 30)).toBeNull();
  });

  it('skips time that has already passed', () => {
    expect(firstFreeSlot([], 30, { afterMinutes: 600 })).toEqual({
      startMinutes: 600,
      endMinutes: 630,
    });
  });

  it('obeys a shortened day', () => {
    // Fifteen minutes left between now and the end of a short day.
    expect(firstFreeSlot([], 30, { afterMinutes: 540, dayEndMinutes: 555 })).toBeNull();
  });
});

describe('suggestSlots', () => {
  it('labels each suggestion with the clock window it occupies', () => {
    expect(suggestSlots([block('a', 0, 540)], 45)).toEqual([
      { startMinutes: 540, endMinutes: 585, durationMinutes: 45, label: '09:00 – 09:45' },
    ]);
  });

  it('stops at the requested limit', () => {
    const busy = [block('a', 540, 600), block('b', 660, 720), block('c', 780, 840)];
    expect(suggestSlots(busy, 30, { limit: 2 })).toHaveLength(2);
  });

  it('ignores a gap too short to hold the task', () => {
    // Only 09:30–10:00 is free, which is 30 minutes against a 45-minute task.
    expect(suggestSlots([block('a', 0, 570), block('b', 600, MINUTES_PER_DAY)], 45)).toEqual([]);
  });
});

describe('replanDay', () => {
  const base = {
    fixedBlocks: [] as TimeBlock[],
    nowMinutes: 540,
    dayEndMinutes: 1080,
    breakMinutes: 0,
    deepWorkCapMinutes: 600,
  };

  function task(
    id: string,
    durationMinutes: number,
    priority: 'main' | 'secondary' = 'secondary',
    originalStartMinutes = 540,
  ) {
    return { id, title: id, durationMinutes, priority, originalStartMinutes };
  }

  it('places MAIN first and leaves everything else in its original order', () => {
    const proposal = replanDay({
      ...base,
      remaining: [
        task('later', 30, 'secondary', 600),
        task('main', 30, 'main', 900),
        task('early', 30, 'secondary', 570),
      ],
    });
    expect(proposal.assignments.map((a) => a.id)).toEqual(['main', 'early', 'later']);
  });

  it('is honest about what moved and what did not', () => {
    const proposal = replanDay({
      ...base,
      remaining: [task('a', 30, 'main', 540), task('b', 60, 'secondary', 900)],
    });

    expect(proposal.assignments).toEqual([
      { id: 'a', title: 'a', startMinutes: 540, endMinutes: 570, moved: false, previousStartMinutes: 540 },
      { id: 'b', title: 'b', startMinutes: 570, endMinutes: 630, moved: true, previousStartMinutes: 900 },
    ]);
    expect(proposal.totalPlannedMinutes).toBe(90);
    expect(proposal.summary).toBe('Proposed 1 change.');
  });

  it('routes around blocks that cannot move', () => {
    const proposal = replanDay({
      ...base,
      fixedBlocks: [
        makeBlock({
          id: 'appointment',
          title: 'Appointment',
          startMinutes: 600,
          endMinutes: 660,
          isFixed: true,
        }),
      ],
      remaining: [task('a', 30), task('b', 90)],
    });

    expect(proposal.assignments.map((a) => [a.id, a.startMinutes, a.endMinutes])).toEqual([
      ['a', 540, 570],
      ['b', 660, 750],
    ]);
  });

  it('stops at the end of the day and reports the rest instead of cramming it in', () => {
    const proposal = replanDay({
      ...base,
      dayEndMinutes: 560,
      remaining: [task('a', 30), task('b', 30)],
    });

    expect(proposal.assignments).toEqual([]);
    expect(proposal.unplaced).toEqual([
      { id: 'a', title: 'a', durationMinutes: 30 },
      { id: 'b', title: 'b', durationMinutes: 30 },
    ]);
    expect(proposal.summary).toBe('Nothing left to place today.');
  });

  it('inserts a break once a stretch reaches the cadence, and does not count it as work', () => {
    const proposal = replanDay({
      ...base,
      breakMinutes: 15,
      remaining: [task('a', 30), task('b', 30), task('c', 30)],
    });

    expect(proposal.breaksInserted).toBe(1);
    expect(proposal.assignments.map((a) => a.startMinutes)).toEqual([540, 570, 615]);
    expect(proposal.totalPlannedMinutes).toBe(90);
  });

  it('does not insert a break before there is a stretch to break up', () => {
    const proposal = replanDay({
      ...base,
      breakMinutes: 15,
      remaining: [task('a', 30), task('b', 30)],
    });
    expect(proposal.breaksInserted).toBe(0);
  });

  it('warns when the remaining work exceeds the deep-work cap', () => {
    const proposal = replanDay({
      ...base,
      deepWorkCapMinutes: 120,
      remaining: [task('a', 240, 'main')],
    });

    expect(proposal.totalPlannedMinutes).toBe(240);
    expect(proposal.capNotice).toContain('4h of focused work');
    expect(proposal.capNotice).toContain('cap is 2h');
  });

  it('says nothing about the cap when the work fits under it', () => {
    const proposal = replanDay({ ...base, deepWorkCapMinutes: 600, remaining: [task('a', 240)] });
    expect(proposal.capNotice).toBeNull();
  });
});

describe('assessDayLoad', () => {
  it('flags planned work that is over the cap', () => {
    const load = assessDayLoad('2025-01-15', [block('a', 540, 900)], 240);
    expect(load.plannedMinutes).toBe(360);
    expect(load.taskCount).toBe(1);
    expect(load.isOverloaded).toBe(true);
    expect(load.reason).toBe('Planned work is 6h against a 4h cap.');
  });

  it('flags a day with less than an hour of unscheduled time', () => {
    // The waking window is 07:00–23:00 (960 minutes); 901 planned leaves 59.
    const load = assessDayLoad('2025-01-15', [block('a', 420, 1321)], 1440);
    expect(load.freeMinutes).toBe(59);
    expect(load.isOverloaded).toBe(true);
    expect(load.reason).toBe('Less than an hour of unscheduled time is left in the day.');
  });

  it('leaves a day alone when exactly an hour is still free', () => {
    const load = assessDayLoad('2025-01-15', [block('a', 420, 1320)], 1440);
    expect(load.freeMinutes).toBe(60);
    expect(load.isOverloaded).toBe(false);
    expect(load.reason).toBeNull();
  });

  it('counts breaks separately from planned work', () => {
    const load = assessDayLoad(
      '2025-01-15',
      [block('work', 540, 600), block('rest', 600, 615, { isBreak: true })],
      600,
    );
    expect(load.plannedMinutes).toBe(60);
    expect(load.breakMinutes).toBe(15);
    expect(load.taskCount).toBe(1);
    expect(load.freeMinutes).toBe(885);
  });
});

describe('small helpers', () => {
  it('labels an interval and builds one from clock strings', () => {
    expect(intervalLabel({ startMinutes: 545, endMinutes: 605 })).toBe('09:05 – 10:05');

    const standup = blockFromTimes('x', 'Standup', '09:00', '10:30');
    expect(standup.startMinutes).toBe(540);
    expect(standup.endMinutes).toBe(630);
    expect(standup.priority).toBe('secondary');
    expect(standup.isFixed).toBe(false);
    expect(standup.isBreak).toBe(false);
  });

  it('counts only the days still ahead of the reference day', () => {
    expect(futureDays('2025-01-01', '2025-01-10', '2025-01-05')).toBe(5);
    expect(futureDays('2025-01-01', '2025-01-05', '2025-01-05')).toBe(0);
    expect(futureDays('2025-01-01', '2025-01-04', '2025-01-05')).toBe(0);
  });

  it('finds the next occurrence of a weekday, counting today', () => {
    // Wednesday 15 January 2025.
    expect(nextWeekday('2025-01-15', 3)).toBe('2025-01-15');
    expect(nextWeekday('2025-01-15', 1)).toBe('2025-01-20'); // Monday
    expect(nextWeekday('2025-01-15', 0)).toBe('2025-01-19'); // Sunday, wrapping forward
  });
});

describe('future-scope move policy', () => {
  it('allows today and any later day', () => {
    expect(futureMoveTargetAllowed('2025-01-15', '2025-01-15')).toBe(true);
    expect(futureMoveTargetAllowed('2025-01-16', '2025-01-15')).toBe(true);
    expect(futureMoveTargetAllowed('2025-02-01', '2025-01-15')).toBe(true);
  });

  it('refuses a day before the user’s local today', () => {
    expect(futureMoveTargetAllowed('2025-01-14', '2025-01-15')).toBe(false);
    expect(futureMoveTargetAllowed('2024-12-31', '2025-01-15')).toBe(false);
  });
});
