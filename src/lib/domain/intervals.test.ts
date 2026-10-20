import { describe, expect, it } from 'vitest';

import { placeOnTimeline, type PlaceableInput } from '@/lib/domain/intervals';

/**
 * Lane packing is what stops two pieces of work being drawn on top of each
 * other. These tests use UTC and fixed timestamps so the answer never depends
 * on the machine's timezone or on the current time.
 */

const DAY = '2025-03-10';

function at(time: string, durationMinutes: number): Date {
  const start = new Date(`${DAY}T${time}:00Z`);
  return new Date(start.getTime() + durationMinutes * 60_000);
}

function block(key: string, time: string, durationMinutes: number): PlaceableInput {
  return {
    key,
    start: new Date(`${DAY}T${time}:00Z`),
    end: at(time, durationMinutes),
  };
}

describe('placeOnTimeline', () => {
  it('gives the layout footprint of a short task a readable minimum', () => {
    const placed = placeOnTimeline([block('short', '09:00', 5)], 'UTC', {
      minDurationMinutes: 20,
    });

    const result = placed.get('short');
    expect(result?.startMinutes).toBe(540);
    // The *record* is five minutes; the *layout* is twenty, so the title fits.
    expect(result?.endMinutes).toBe(560);
  });

  it('packs the next task beside a short one instead of underneath it', () => {
    const placed = placeOnTimeline(
      [block('short', '09:00', 5), block('next', '09:10', 30)],
      'UTC',
      { minDurationMinutes: 20 },
    );

    expect(placed.get('short')?.lane).toBe(0);
    // Without the floor, 09:10 would start after the five-minute record ended
    // and both blocks would share lane 0 — drawing "next" over "short".
    expect(placed.get('next')?.lane).toBe(1);
    expect(placed.get('next')?.laneCount).toBe(2);
  });

  it('keeps the default floor at eight minutes', () => {
    const placed = placeOnTimeline([block('tiny', '09:00', 2)], 'UTC');

    expect(placed.get('tiny')?.endMinutes).toBe(548);
  });

  it('never shortens a block that is already longer than the floor', () => {
    const placed = placeOnTimeline([block('hour', '09:00', 60)], 'UTC', {
      minDurationMinutes: 20,
    });

    expect(placed.get('hour')?.endMinutes).toBe(600);
  });

  it('does not push a late block past the end of the day', () => {
    const placed = placeOnTimeline([block('late', '23:50', 30)], 'UTC', {
      minDurationMinutes: 20,
    });

    expect(placed.get('late')?.endMinutes).toBe(1440);
  });
});
