import type { Importance, ISODate, Task } from '../types';
import { diffDays } from './date';

export const IMPORTANCE_HELP: Record<Importance, { label: string; hint: string }> = {
  must: { label: 'Must', hint: 'Real consequence if it slips — money, health, legal, someone waiting' },
  should: { label: 'Should', hint: 'Annoying if it slips a week' },
  could: { label: 'Could', hint: 'Nothing much happens if it slips' },
};

export const isClosed = (t: Task) => t.status === 'done' || t.status === 'dropped';

/** How many days this task has been pushed forward from its first planned day. */
export function carriedDays(t: Task): number {
  if (!t.firstScheduled || !t.date) return 0;
  return Math.max(0, diffDays(t.firstScheduled, t.date));
}
export const isStale = (t: Task) => !isClosed(t) && !t.recurrence && carriedDays(t) >= 3;

/**
 * Importance is what you said; urgency comes from the deadline. The colour shown is
 * the higher of the two, so a "could" with a deadline tomorrow still turns red.
 */
export function effectiveLevel(t: Task, today: ISODate): { level: Importance; reason?: string } {
  if (isClosed(t) || !t.deadline) return { level: t.importance };
  const left = diffDays(today, t.deadline);
  if (left <= 1 && t.importance !== 'must')
    return { level: 'must', reason: left < 0 ? `overdue ${-left}d` : left === 0 ? 'due today' : 'due tomorrow' };
  if (left <= 3 && t.importance === 'could') return { level: 'should', reason: `due in ${left}d` };
  return { level: t.importance };
}

const W: Record<Importance, number> = { must: 300, should: 200, could: 100 };
/** Ranking used by "sort by priority" and the plan view. */
export function score(t: Task, today: ISODate): number {
  let s = W[effectiveLevel(t, today).level];
  if (t.deadline) s += Math.max(0, 14 - diffDays(today, t.deadline)) * 6;
  s += Math.min(carriedDays(t), 10) * 4;
  if (t.status === 'doing') s += 15;
  if (t.status === 'waiting') s -= 60;
  return s;
}
