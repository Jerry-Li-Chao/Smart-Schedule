import type { Entity, ISODate, Task } from '../types';
import { addDays, diffDays } from './date';
import { occursOn } from './recurrence';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type OccState = 'done' | 'dropped' | 'missed' | 'open';

export interface RepeatInfo {
  task: Task;
  cadence: Cadence;
  /** next day it happens, today included (null = it has ended) */
  next: ISODate | null;
  /** the few after that */
  upcoming: ISODate[];
  /** most recent past occurrences, newest first */
  recent: { date: ISODate; state: OccState }[];
  /** past occurrences not ticked off (within the recent window) */
  missed: ISODate[];
  /** done ÷ (done + missed) over the recent window; null when nothing is past yet */
  rate: number | null;
  /** today's occurrence, if there is one, and its state */
  today?: OccState;
  /** the repeat has an end date coming up (renewal) */
  endsIn?: number;
  ended: boolean;
}

const RECENT = 8;
const LOOKBACK = 800; // days searched backwards for history (covers yearly)
const ENDING_SOON = 45; // days

/** Every repeating task, with what's next and how it has been going. */
export function repeatInfos(entities: Record<string, Entity>, today: ISODate): RepeatInfo[] {
  const out: RepeatInfo[] = [];
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || e.deleted || !e.recurrence || !e.date) continue;
    out.push(repeatInfo(e, today));
  }
  return out;
}

export function repeatInfo(t: Task, today: ISODate): RepeatInfo {
  const r = t.recurrence!;
  const start = t.date!;
  const live = (d: ISODate) => occursOn(r, start, d) && t.completions?.[d] !== 'deleted' && t.completions?.[d] !== 'moved';

  const upcoming: ISODate[] = [];
  for (let d = today < start ? start : today, i = 0; i < LOOKBACK && upcoming.length < 4; i++, d = addDays(d, 1)) {
    if (r.until && d > r.until) break;
    if (live(d)) upcoming.push(d);
  }

  const recent: RepeatInfo['recent'] = [];
  for (let d = addDays(today, -1), i = 0; i < LOOKBACK && recent.length < RECENT && d >= start; i++, d = addDays(d, -1)) {
    if (!live(d)) continue;
    const s = t.completions?.[d];
    recent.push({ date: d, state: s === 'done' ? 'done' : s === 'dropped' ? 'dropped' : 'missed' });
  }
  const missed = t.allDay ? [] : recent.filter((x) => x.state === 'missed').map((x) => x.date);
  const done = recent.filter((x) => x.state === 'done').length;
  const rate = t.allDay || done + missed.length === 0 ? null : done / (done + missed.length);

  const todayState: OccState | undefined = live(today)
    ? t.completions?.[today] === 'done'
      ? 'done'
      : t.completions?.[today] === 'dropped'
        ? 'dropped'
        : 'open'
    : undefined;

  const ended = !!r.until && r.until < today;
  const left = r.until ? diffDays(today, r.until) : undefined;
  return {
    task: t,
    cadence: r.freq,
    next: upcoming[0] ?? null,
    upcoming: upcoming.slice(1),
    recent,
    missed,
    rate,
    today: todayState,
    endsIn: left !== undefined && left >= 0 && left <= ENDING_SOON ? left : undefined,
    ended,
  };
}
