import { describe, expect, it } from 'vitest';

import { explainDatabaseError } from '@/lib/domain/limits';

/**
 * Database refusals must become sentences the user can act on. These cases are
 * the ones the recurring-task RPCs raise; the rest of the mapper is exercised
 * through the screens that hit those errors.
 */
describe('explainDatabaseError', () => {
  it('explains a whole-routine move that would go into the past', () => {
    const message = explainDatabaseError('future_move_into_past', null);
    expect(message).toContain('today or a later day');
    expect(message).toContain('Only this one');
  });

  it('still explains a task that disappeared on another device', () => {
    expect(explainDatabaseError('task_not_found')).toContain('no longer exists');
  });
});
