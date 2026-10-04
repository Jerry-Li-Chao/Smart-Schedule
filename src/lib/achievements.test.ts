import { describe, expect, it } from 'vitest';
import { computeStats, computeTrend, lastImportDay, periodLabel, periodRange } from './achievements';
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

  it('steps back to whole past periods', () => {
    expect(periodRange('month', today, -1)).toEqual({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-31' });
    expect(periodRange('week', today, -1)).toEqual({ from: '2026-09-21', to: '2026-09-27', prevFrom: '2026-09-14', prevTo: '2026-09-20' });
    expect(periodRange('year', today, -1)).toMatchObject({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodLabel('month', today, -1)).toEqual({ now: 'Last month (September)', prev: 'August' });
    expect(periodLabel('week', today, -2).now).toBe('The week of Sep 14');
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
    expect(lastImportDay(db(T({ id: 't_imp_a', status: 'done', date: '2026-03-04', doneAt: now, createdAt: now }), T({ id: 'x', status: 'done', date: today, doneAt: now })))).toBe(today);
    expect(computeStats(db(T({ id: 't_imp_a', status: 'done', date: '2026-03-04', doneAt: now, createdAt: now })), 'week', today).wins).toEqual([]);
  });

  it('keeps a streak alive before today is done', () => {
    const s = computeStats(db(T({ title: 'Renew passport', status: 'done', date: '2026-10-01', doneAt: at('2026-10-01') })), 'month', today);
    expect(s.currentStreak).toBe(1);
  });
});

describe('trend', () => {
  it('buckets wins by importance and counts what was left behind', () => {
    const today = '2026-10-02';
    const tr = computeTrend(
      db(
        T({ id: 'a', importance: 'must', status: 'done', date: '2026-10-01', doneAt: new Date('2026-10-01T10:00').getTime() }),
        T({ id: 'b', importance: 'could', date: '2026-09-30', stay: true }), // left on its day
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

describe('all-day lanes', () => {
  it('keeps a multi-day event in one lane and stacks overlaps', async () => {
    const { buildDayIndex, eventsFor, itemsFor } = await import('./dayIndex');
    const idx = buildDayIndex(
      db(
        T({ id: 'v', title: 'Vacation', date: '2026-10-10', endDate: '2026-10-13', allDay: true }),
        T({ id: 'h', title: 'Holiday', date: '2026-10-12', allDay: true }),
        T({ id: 'x', title: 'Pack', date: '2026-10-12' }),
      ),
    );
    expect(eventsFor(idx, '2026-10-10').map((e) => [e.task.id, e.lane, e.n, e.total])).toEqual([['v', 0, 1, 4]]);
    expect(eventsFor(idx, '2026-10-12').map((e) => [e.task.id, e.lane, e.n])).toEqual([['v', 0, 3], ['h', 1, 1]]);
    expect(eventsFor(idx, '2026-10-14')).toEqual([]);
    expect(itemsFor(idx, '2026-10-12').map((i) => i.key)).toEqual(['x']); // events never mix into the task list
  });
});

describe('repeats', () => {
  it('finds next date, history, misses and an upcoming end', async () => {
    const { repeatInfo } = await import('./repeats');
    const today = '2026-10-02';
    const r = repeatInfo(
      T({
        title: 'Protein shake',
        date: '2026-09-28',
        recurrence: { freq: 'daily', interval: 1, until: '2026-10-20' },
        completions: { '2026-09-28': 'done', '2026-09-29': 'done', '2026-09-30': 'deleted', '2026-10-02': 'done' },
      }),
      today,
    );
    expect(r.today).toBe('done');
    expect(r.next).toBe(today);
    expect(r.upcoming).toEqual(['2026-10-03', '2026-10-04', '2026-10-05']);
    expect(r.recent.map((x) => x.state)).toEqual(['missed', 'done', 'done']); // 10/1, 9/29, 9/28 (9/30 deleted)
    expect(r.missed).toEqual(['2026-10-01']);
    expect(r.rate).toBeCloseTo(2 / 3);
    expect(r.endsIn).toBe(18);

    const rent = repeatInfo(T({ title: 'Rent', date: '2026-01-01', recurrence: { freq: 'monthly', interval: 1 } }), today);
    expect([rent.next, rent.today, rent.endsIn]).toEqual(['2026-11-01', undefined, undefined]);
  });
});

describe('money', () => {
  it('amortizes to a monthly cost and lists upcoming charges', async () => {
    const { monthlyCost, chargesBetween, repeatInfo } = await import('./repeats');
    const yearly = T({ id: 'y', title: 'Domain', date: '2026-01-15', recurrence: { freq: 'yearly', interval: 1 }, cost: { amount: 120 } });
    const weekly = T({ id: 'w', title: 'Meal kit', date: '2026-09-07', recurrence: { freq: 'weekly', interval: 1 }, cost: { amount: 10, autopay: true } });
    expect(monthlyCost(yearly)).toBe(10);
    expect(monthlyCost(weekly)).toBeCloseTo(43.48, 1);
    const ch = chargesBetween(db(yearly, weekly), '2026-10-01', '2026-10-31');
    expect(ch.map((c) => c.date)).toEqual(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
    expect(repeatInfo(weekly, '2026-10-02').missed).toEqual([]); // auto-pay is never "missed"
  });
});

describe('past repeats', () => {
  it('keeps ended and deleted repeats, nudges when the season comes back', async () => {
    const { pastRepeats } = await import('./repeats');
    const today = '2026-10-02';
    const list = pastRepeats(
      db(
        T({ id: 's', title: 'Ski pass', date: '2025-10-20', recurrence: { freq: 'monthly', interval: 1, until: '2026-03-20' }, cost: { amount: 80 } }),
        T({ id: 'g', title: 'Garden service', date: '2026-04-01', recurrence: { freq: 'weekly', interval: 1 }, deleted: true, updatedAt: new Date('2026-08-30T12:00').getTime() }),
        T({ id: 'r', title: 'Rent', date: '2026-01-01', recurrence: { freq: 'monthly', interval: 1 } }),
        T({ id: 'r0', title: 'rent', date: '2025-01-01', recurrence: { freq: 'monthly', interval: 1, until: '2025-12-01' } }), // running again
      ),
      today,
    );
    expect(list.map((p) => [p.task.id, p.how, p.from, p.to, p.again, p.soonIn])).toEqual([
      ['g', 'deleted', '2026-04-01', '2026-08-30', '2027-04-01', undefined],
      ['s', 'ended', '2025-10-20', '2026-03-20', '2026-10-20', 18],
    ]);
  });
});
