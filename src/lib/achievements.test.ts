import { describe, expect, it } from 'vitest';
import { computeStats, computeTrend, periodRange } from './achievements';
import type { Entity, Task } from '../types';

const T = (p: Partial<Task>): Task => ({
  id: p.id ?? Math.random().toString(36).slice(2),
  type: 'task',
  title: 'x',
  date: null,
  importance: 'should',
  status: 'open',
  order: 0,
  createdAt: 0,
  updatedAt: 0,
  ...p,
});
const db = (...ts: Task[]): Record<string, Entity> => Object.fromEntries(ts.map((t) => [t.id, t]));
const at = (d: string, h = 9) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();

describe('achievements', () => {
  const today = '2026-10-02'; // a Friday

  it('picks the right ranges', () => {
    expect(periodRange('week', today)).toMatchObject({ from: '2026-09-28', to: today, prevFrom: '2026-09-21', prevTo: '2026-09-25' });
    expect(periodRange('month', today)).toMatchObject({ from: '2026-10-01', prevFrom: '2026-09-01', prevTo: '2026-09-02' });
    expect(periodRange('month', '2026-03-31')).toMatchObject({ prevFrom: '2026-02-01', prevTo: '2026-02-28' });
    expect(periodRange('year', today)).toMatchObject({ from: '2026-01-01', prevFrom: '2025-01-01', prevTo: '2025-10-02' });
  });

  it('counts wins by importance, including days of repeating tasks', () => {
    const s = computeStats(
      db(
        T({ id: 'a', title: 'Call the dentist', importance: 'must', status: 'done', date: '2026-09-30', doneAt: at('2026-09-30') }),
        T({ id: 'b', importance: 'could', status: 'done', date: '2026-09-29', doneAt: at('2026-09-29') }),
        T({ id: 'old', status: 'done', date: '2026-09-22', doneAt: at('2026-09-22') }),
        T({ id: 'open', importance: 'must', date: '2026-09-29', firstScheduled: '2026-09-25' }),
        T({ id: 'r', title: 'Spanish L#', date: '2026-09-28', recurrence: { freq: 'daily', interval: 1 }, completions: { '2026-09-28': 'done', '2026-09-29': 'done', '2026-09-30': 'deleted' } }),
      ),
      'week',
      today,
    );
    expect(s.wins.length).toBe(4);
    expect(s.byLevel).toEqual({ must: 1, should: 2, could: 1 });
    expect(s.prevTotal).toBe(1);
    expect(s.longestStreak).toBe(3); // Mon–Wed
    expect(s.currentStreak).toBe(0);
    expect(s.habits[0]).toMatchObject({ title: 'Spanish L#', done: 2, scheduled: 4 }); // 28, 29, 1, 2 (30 deleted)
    expect(s.left.overdue.map((t) => t.id)).toEqual(['open']);
    expect(s.left.byLevel.must).toBe(1);
  });

  it('dates imported tasks by their own day, not the moment of import', () => {
    const now = at(today, 15);
    const s = computeStats(
      db(
        T({ id: 't_imp_a', status: 'done', date: '2026-03-04', doneAt: now, createdAt: now }), // old import
        T({ id: 't_imp_b', status: 'done', date: '2026-03-05', doneAt: at('2026-03-05', 12), createdAt: now }), // new import
        T({ id: 't_imp_c', status: 'done', date: '2026-09-30', doneAt: at(today, 18), createdAt: now - 86400000 * 3 }), // imported open, ticked later
      ),
      'year',
      today,
    );
    expect(s.wins.map((w) => [w.date, w.hour])).toEqual([['2026-03-04', undefined], ['2026-03-05', undefined], [today, 18]]);
    expect(computeStats(db(T({ id: 't_imp_a', status: 'done', date: '2026-03-04', doneAt: now, createdAt: now })), 'week', today).wins).toEqual([]);
  });

  it('finds the comeback task', () => {
    const s = computeStats(db(T({ title: 'Renew passport', status: 'done', firstScheduled: '2026-09-01', date: '2026-10-01', doneAt: at('2026-10-01') })), 'month', today);
    expect(s.comeback).toMatchObject({ title: 'Renew passport', carried: 30 });
    expect(s.currentStreak).toBe(1);
  });
});

describe('trend', () => {
  it('buckets wins by importance and counts what was left behind', () => {
    const today = '2026-10-02';
    const tr = computeTrend(
      db(
        T({ id: 'a', importance: 'must', status: 'done', date: '2026-10-01', doneAt: new Date('2026-10-01T10:00').getTime() }),
        T({ id: 'b', importance: 'could', date: '2026-10-02', firstScheduled: '2026-09-30' }), // pushed from 9/30
        T({ id: 'c', status: 'dropped', date: '2026-09-29' }),
        T({ id: 'r', date: '2026-09-30', recurrence: { freq: 'daily', interval: 1 }, completions: { '2026-09-30': 'done' } }), // 10/1 missed, today pending
      ),
      '2w',
      today,
    );
    expect(tr.unit).toBe('day');
    expect(tr.points.length).toBe(14);
    const at = (d: string) => tr.points.find((p) => p.from === d)!;
    expect(at('2026-10-01')).toMatchObject({ must: 1, left: 1 });
    expect(at('2026-09-30')).toMatchObject({ should: 1, left: 1 });
    expect(at('2026-09-29').left).toBe(1);
    expect(at('2026-10-02').left).toBe(0);
  });
});
