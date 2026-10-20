import { describe, expect, it } from 'vitest';

import { summariseCalendar, visibleCalendarItems, type CalendarItem } from '@/lib/domain/calendar';

/**
 * The "at a glance" strip must report what is actually in the view: tasks, not
 * events, and tracked minutes keyed to the task they were recorded against.
 */

function item(overrides: Partial<CalendarItem> & Pick<CalendarItem, 'id'>): CalendarItem {
  const start = new Date('2025-03-10T09:00:00Z');
  return {
    kind: 'task',
    sourceId: overrides.id,
    seriesId: null,
    title: 'Task',
    description: null,
    date: '2025-03-10',
    start,
    end: new Date(start.getTime() + 45 * 60_000),
    minutes: 45,
    isAllDay: false,
    category: 'study',
    priority: 'secondary',
    status: 'planned',
    goalId: null,
    goalTitle: null,
    eventKind: null,
    location: null,
    isRecurring: false,
    rescheduledFrom: null,
    isTerminal: false,
    ...overrides,
  };
}

describe('visibleCalendarItems', () => {
  it('drops removed tasks from what a calendar view may draw', () => {
    const visible = visibleCalendarItems([
      item({ id: 'task:1' }),
      item({ id: 'task:2', status: 'cancelled' }),
      item({ id: 'task:3', status: 'completed' }),
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(['task:1', 'task:3']);
  });

  it('keeps every status the calendar still draws', () => {
    const statuses = ['planned', 'in_progress', 'completed', 'missed', 'skipped'] as const;
    const visible = visibleCalendarItems(
      statuses.map((status, index) => item({ id: `task:${index}`, status })),
    );

    expect(visible).toHaveLength(statuses.length);
  });

  it('drops a removed event for the same reason', () => {
    const visible = visibleCalendarItems([
      item({ id: 'event:1', kind: 'event', category: 'personal', status: 'cancelled' }),
      item({ id: 'event:2', kind: 'event', category: 'personal' }),
    ]);

    expect(visible.map((entry) => entry.id)).toEqual(['event:2']);
  });
});

describe('summariseCalendar', () => {
  it('counts planned and completed tasks', () => {
    const summary = summariseCalendar(
      [
        item({ id: 'task:1' }),
        item({ id: 'task:2', status: 'completed' }),
        item({ id: 'task:3', status: 'missed' }),
      ],
      new Map(),
    );

    expect(summary.plannedTasks).toBe(3);
    expect(summary.completedTasks).toBe(1);
  });

  it('ignores events, which are commitments rather than units of work', () => {
    const summary = summariseCalendar(
      [
        item({ id: 'task:1' }),
        item({ id: 'event:1', kind: 'event', category: 'personal' }),
      ],
      new Map([
        ['task:1', 25],
        ['event:1', 90],
      ]),
    );

    expect(summary.plannedTasks).toBe(1);
    expect(summary.trackedMinutes).toBe(25);
  });

  it('excludes removed tasks from both the plan and the tracked total', () => {
    const summary = summariseCalendar(
      [item({ id: 'task:1' }), item({ id: 'task:2', status: 'cancelled' })],
      new Map([
        ['task:1', 10],
        ['task:2', 50],
      ]),
    );

    expect(summary.plannedTasks).toBe(1);
    expect(summary.trackedMinutes).toBe(10);
  });

  it('sums tracked minutes per task and treats a missing entry as zero', () => {
    const summary = summariseCalendar(
      [item({ id: 'task:1' }), item({ id: 'task:2' }), item({ id: 'task:3' })],
      new Map([
        ['task:1', 30],
        ['task:2', 45],
      ]),
    );

    expect(summary.trackedMinutes).toBe(75);
  });
});
