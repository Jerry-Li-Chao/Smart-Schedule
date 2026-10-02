import type { Entity, Importance, ISODate, Project, Task } from '../types';
import { addDays, addMonths, diffDays, startOfWeekMon, toISO, weekday } from './date';
import { effectiveLevel, isClosed } from './priority';
import { numberedTitle, occursOn } from './recurrence';

export type Period = 'week' | 'month' | 'year';
export const LEVELS: Importance[] = ['must', 'should', 'could'];

/** One thing you got done. */
export interface Win {
  key: string;
  title: string;
  date: ISODate;
  importance: Importance;
  /** hour of day it was ticked off (only known for one-off tasks) */
  hour?: number;
  projectId?: string;
}

export interface Habit {
  id: string;
  title: string;
  done: number;
  scheduled: number;
}

export interface Stats {
  period: Period;
  from: ISODate;
  to: ISODate;
  days: ISODate[];
  wins: Win[];
  byLevel: Record<Importance, number>;
  prevTotal: number;
  perDay: Record<ISODate, number>;
  byWeekday: number[]; // Mon … Sun
  busiest: { date: ISODate; count: number } | null;
  /** 'morning' | 'afternoon' | 'evening' | 'night', when enough timed wins exist */
  chronotype: { kind: 'morning' | 'afternoon' | 'evening' | 'night'; share: number } | null;
  longestStreak: number;
  currentStreak: number;
  activeDays: number;
  habits: Habit[];
  projects: { project: Project; steps: number; finished: boolean }[];
  dropped: number;
  left: {
    byLevel: Record<Importance, number>;
    overdue: Task[]; // open, scheduled on or before today, most important first
    inbox: number;
    nextMusts: Task[]; // musts in the next 7 days
  };
}

/**
 * Calendar periods, all ending today: this week (Mon–today), this month (1st–today), this year (Jan 1–today).
 * Each is compared with the same stretch of the previous week / month / year, so a Wednesday is
 * compared with last Mon–Wed, not with a whole week.
 */
export function periodRange(p: Period, today: ISODate): { from: ISODate; to: ISODate; prevFrom: ISODate; prevTo: ISODate } {
  if (p === 'week') {
    const from = startOfWeekMon(today);
    return { from, to: today, prevFrom: addDays(from, -7), prevTo: addDays(today, -7) };
  }
  if (p === 'month') {
    const from = `${today.slice(0, 8)}01`;
    // same day last month, clamped to its end (Mar 31 → Feb 1–28)
    return { from, to: today, prevFrom: addMonths(from, -1), prevTo: addMonths(today, -1) };
  }
  const y = Number(today.slice(0, 4));
  const prevTo = today.slice(5) === '02-29' ? `${y - 1}-02-28` : `${y - 1}${today.slice(4)}`;
  return { from: `${y}-01-01`, to: today, prevFrom: `${y - 1}-01-01`, prevTo };
}

export const PERIOD_LABEL: Record<Period, { now: string; prev: string }> = {
  week: { now: 'This week', prev: 'this point last week' },
  month: { now: 'This month', prev: 'this point last month' },
  year: { now: 'This year', prev: 'this point last year' },
};

/** a series' name without its trailing number placeholder ("Vitamin D #" → "Vitamin D") */
const seriesName = (t: Task) => t.title.replace(/\s+#\s*$/, '').trim();

/**
 * Tasks imported from the sheet only know their day. Older imports stamped them "done" at the
 * moment of import, which would make a whole history look like this week's work — use their day.
 */
function dayOnly(t: Task): boolean {
  if (!t.id.startsWith('t_imp') || !t.date || !t.doneAt) return false;
  return Math.abs(t.doneAt - t.createdAt) < 120_000 || t.doneAt === new Date(`${t.date}T12:00:00`).getTime();
}

/** Every completion in the data, one per task or per day of a repeating task. */
export function allWins(entities: Record<string, Entity>): Win[] {
  const out: Win[] = [];
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || e.deleted) continue;
    if (e.recurrence) {
      for (const [d, s] of Object.entries(e.completions ?? {}))
        if (s === 'done') out.push({ key: `${e.id}|${d}`, title: numberedTitle(e, d), date: d, importance: e.importance, projectId: e.projectId });
    } else if (e.status === 'done') {
      const at = e.doneAt && !dayOnly(e) ? new Date(e.doneAt) : null;
      const date = at ? toISO(at) : e.date;
      if (!date) continue;
      out.push({
        key: e.id,
        title: e.title,
        date,
        importance: e.importance,
        hour: at?.getHours(),
        projectId: e.projectId,
      });
    }
  }
  return out;
}

export function computeStats(entities: Record<string, Entity>, period: Period, today: ISODate): Stats {
  const { from, to, prevFrom, prevTo } = periodRange(period, today);
  const every = allWins(entities);
  const wins = every.filter((w) => w.date >= from && w.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const prevTotal = every.filter((w) => w.date >= prevFrom && w.date <= prevTo).length;

  const days: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);

  const byLevel: Record<Importance, number> = { must: 0, should: 0, could: 0 };
  const perDay: Record<ISODate, number> = {};
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const w of wins) {
    byLevel[w.importance]++;
    perDay[w.date] = (perDay[w.date] ?? 0) + 1;
    byWeekday[(weekday(w.date) + 6) % 7]++;
  }

  let busiest: Stats['busiest'] = null;
  for (const d of days) if (perDay[d] && (!busiest || perDay[d] > busiest.count)) busiest = { date: d, count: perDay[d] };

  // streaks: consecutive days with at least one win
  let longestStreak = 0;
  let run = 0;
  for (const d of days) {
    run = perDay[d] ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  let currentStreak = 0;
  // today not done yet doesn't break the streak
  for (let d = perDay[today] ? today : addDays(today, -1); d >= from && perDay[d]; d = addDays(d, -1)) currentStreak++;

  const timed = wins.filter((w) => w.hour !== undefined);
  let chronotype: Stats['chronotype'] = null;
  if (timed.length >= 5) {
    const bucket = (h: number) => (h >= 5 && h < 12 ? 'morning' : h < 17 && h >= 12 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night');
    const c: Record<string, number> = {};
    for (const w of timed) c[bucket(w.hour!)] = (c[bucket(w.hour!)] ?? 0) + 1;
    const [kind, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    chronotype = { kind: kind as 'morning', share: n / timed.length };
  }

  const tasks = Object.values(entities).filter((e): e is Task => e.type === 'task' && !e.deleted);

  const habits: Habit[] = [];
  for (const t of tasks) {
    if (!t.recurrence || !t.date) continue;
    let scheduled = 0;
    let done = 0;
    const start = t.date > from ? t.date : from;
    const end = t.recurrence.until && t.recurrence.until < to ? t.recurrence.until : to;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!occursOn(t.recurrence, t.date, d)) continue;
      const s = t.completions?.[d];
      if (s === 'deleted' || s === 'moved') continue;
      scheduled++;
      if (s === 'done') done++;
    }
    if (done) habits.push({ id: t.id, title: seriesName(t), done, scheduled });
  }
  habits.sort((a, b) => b.done - a.done || b.done / b.scheduled - a.done / a.scheduled);

  const projMap = new Map<string, number>();
  for (const w of wins) if (w.projectId) projMap.set(w.projectId, (projMap.get(w.projectId) ?? 0) + 1);
  const projects = [...projMap]
    .map(([id, steps]) => ({ project: entities[id] as Project, steps }))
    .filter((p) => p.project?.type === 'project' && !p.project.deleted)
    .map((p) => ({ ...p, finished: p.project.status === 'done' }))
    .sort((a, b) => b.steps - a.steps);

  const dropped = tasks.filter((t) => !t.recurrence && t.status === 'dropped' && t.date && t.date >= from && t.date <= to).length;

  const rank: Record<Importance, number> = { must: 0, should: 1, could: 2 };
  const open = tasks.filter((t) => !t.recurrence && !isClosed(t) && !t.someday && t.date && t.date <= today);
  const leftLevel: Record<Importance, number> = { must: 0, should: 0, could: 0 };
  for (const t of open) leftLevel[effectiveLevel(t, today).level]++;
  const overdue = open
    .map((t) => ({ t, l: effectiveLevel(t, today).level }))
    .sort((a, b) => rank[a.l] - rank[b.l] || a.t.date!.localeCompare(b.t.date!))
    .map((x) => x.t);
  const soon = addDays(today, 7);
  const nextMusts = tasks
    .filter((t) => !t.recurrence && !isClosed(t) && t.date && t.date > today && t.date <= soon && effectiveLevel(t, today).level === 'must')
    .sort((a, b) => a.date!.localeCompare(b.date!));

  return {
    period,
    from,
    to,
    days,
    wins,
    byLevel,
    prevTotal,
    perDay,
    byWeekday,
    busiest,
    chronotype,
    longestStreak,
    currentStreak,
    activeDays: Object.keys(perDay).length,
    habits,
    projects,
    dropped,
    left: { byLevel: leftLevel, overdue, inbox: tasks.filter((t) => t.date === null && !t.someday && !t.projectId && !t.recurrence && !isClosed(t)).length, nextMusts },
  };
}

// ---------- trend chart ----------

export type TrendRange = '2w' | '1m' | '3m' | '6m' | '1y' | 'all';
export interface TrendPoint {
  from: ISODate;
  to: ISODate;
  must: number;
  should: number;
  could: number;
  /** planned in this stretch but not done in it (missed repeats, tasks moved past it, dropped) */
  left: number;
}

/**
 * Completions per importance vs. things left behind, bucketed by day (≤ 1 month),
 * week (≤ 1 year) or month (all time).
 */
export function computeTrend(entities: Record<string, Entity>, range: TrendRange, today: ISODate): { unit: 'day' | 'week' | 'month'; points: TrendPoint[] } {
  const wins = allWins(entities);
  const tasks = Object.values(entities).filter((e): e is Task => e.type === 'task' && !e.deleted);

  let start: ISODate;
  if (range === 'all') {
    const firsts = [...wins.map((w) => w.date), ...tasks.map((t) => t.date).filter((d): d is ISODate => !!d && d <= today)];
    start = firsts.length ? firsts.reduce((a, b) => (a < b ? a : b)) : addDays(today, -29);
  } else start = addDays(today, -({ '2w': 13, '1m': 29, '3m': 90, '6m': 181, '1y': 364 }[range]));
  const unit = range === '2w' || range === '1m' ? 'day' : range === 'all' && diffDays(start, today) > 400 ? 'month' : 'week';

  const points: TrendPoint[] = [];
  let b = unit === 'week' ? startOfWeekMon(start) : unit === 'month' ? `${start.slice(0, 8)}01` : start;
  while (b <= today) {
    const next = unit === 'day' ? addDays(b, 1) : unit === 'week' ? addDays(b, 7) : addMonths(b, 1);
    const end = addDays(next, -1);
    points.push({ from: b, to: end > today ? today : end, must: 0, should: 0, could: 0, left: 0 });
    b = next;
  }
  const find = (d: ISODate) => {
    // buckets are sorted; binary search
    let lo = 0;
    let hi = points.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (d < points[m].from) hi = m - 1;
      else if (d > points[m].to) lo = m + 1;
      else return points[m];
    }
    return undefined;
  };

  for (const w of wins) {
    const p = find(w.date);
    if (p) p[w.importance]++;
  }
  // left behind: only judged on days that are over
  for (const t of tasks) {
    if (t.recurrence) {
      if (!t.date) continue;
      const s0 = t.date > points[0]?.from ? t.date : points[0]?.from;
      const end = t.recurrence.until && t.recurrence.until < today ? addDays(t.recurrence.until, 1) : today;
      for (let d = s0; d && d < end; d = addDays(d, 1)) if (occursOn(t.recurrence, t.date, d) && !t.completions?.[d]) find(d) && find(d)!.left++;
      continue;
    }
    const planned = t.date;
    if (!planned || planned >= today || t.someday) continue;
    const p = find(planned);
    if (!p) continue;
    const doneDay = t.status === 'done' ? (t.doneAt && !dayOnly(t) ? toISO(new Date(t.doneAt)) : t.date) : null;
    if (!doneDay || doneDay > p.to) p.left++;
  }
  return { unit, points };
}
