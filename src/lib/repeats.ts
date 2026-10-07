import type { Entity, ISODate, Recurrence, Task } from '../types';
import { addDays, diffDays } from './date';
import { occursOn } from './recurrence';

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type OccState = 'done' | 'dropped' | 'missed' | 'open';

// ---------- chains: a subscription's periods (price changes, pauses) ----------

export const chainKey = (t: Task) => t.chainId ?? t.id;

export interface Chain {
  key: string;
  /** every period, oldest first */
  periods: Task[];
  /** the period running today */
  current?: Task;
  /** a period that starts after today (a scheduled plan change, or resubscribing later) */
  upcoming?: Task;
  /** the one that stands for the chain: current, else upcoming, else the latest */
  rep: Task;
  /** no period runs today or later: cancelled or paused */
  paused: boolean;
}

const endOf = (t: Task) => t.recurrence?.until;

/** All repeats grouped into chains. */
export function chains(entities: Record<string, Entity>, today: ISODate): Map<string, Chain> {
  const groups = new Map<string, Task[]>();
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || e.deleted || !e.recurrence || !e.date) continue;
    const k = chainKey(e);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out = new Map<string, Chain>();
  for (const [key, list] of groups) {
    const periods = list.sort((a, b) => a.date!.localeCompare(b.date!));
    const current = periods.find((p) => p.date! <= today && !(endOf(p) && endOf(p)! < today));
    const upcoming = periods.find((p) => p.date! > today);
    const rep = current ?? upcoming ?? periods[periods.length - 1];
    out.set(key, { key, periods, current, upcoming, rep, paused: !current && !upcoming });
  }
  return out;
}

/** The chain a repeat belongs to (a chain of one when it has no siblings). */
export function chainOf(entities: Record<string, Entity>, t: Task, today: ISODate): Chain {
  return chains(entities, today).get(chainKey(t)) ?? { key: chainKey(t), periods: [t], rep: t, paused: false };
}

/** What one occurrence actually cost: the one-off amount if one was recorded, else the period's price. */
export const chargeOn = (t: Task, d: ISODate) => t.cost?.charged?.[d] ?? t.cost?.amount ?? 0;

/** What a chain actually charged between two days (inclusive): each period at its own price, gaps free. */
export function chainSpent(periods: Task[], from: ISODate, to: ISODate): number {
  let sum = 0;
  for (const p of periods) {
    if (!p.cost?.amount && !p.cost?.charged) continue;
    const end = endOf(p) && endOf(p)! < to ? endOf(p)! : to;
    for (let d = from < p.date! ? p.date! : from; d <= end; d = addDays(d, 1)) {
      const s = p.completions?.[d];
      if (s !== 'deleted' && s !== 'moved' && s !== 'dropped' && occursOn(p.recurrence!, p.date!, d)) sum += chargeOn(p, d);
    }
  }
  return sum;
}

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
  // one card per chain: the period running now (or the next one, or the last one)
  return [...chains(entities, today).values()].map((c) => repeatInfo(c.rep, today));
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
  // auto-pay happens by itself: past occurrences count as done, never as missed
  if (t.cost?.autopay) for (const x of recent) if (x.state === 'missed') x.state = 'done';
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

// ---------- money ----------

/** How many times a year this repeat happens (ignoring any end date). */
export function perYear(r: Recurrence): number {
  const iv = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case 'daily':
      return 365.25 / iv;
    case 'weekly':
      return ((365.25 / 7) * Math.max(1, r.byWeekday?.length ?? 1)) / iv;
    case 'monthly':
      return 12 / iv;
    case 'yearly':
      return 1 / iv;
  }
}

/** The cost spread evenly over months: $120 a year → $10 a month. */
export const monthlyCost = (t: Task) => (t.cost && t.recurrence ? (t.cost.amount * perYear(t.recurrence)) / 12 : 0);

export interface Charge {
  date: ISODate;
  task: Task;
  amount: number;
}

/** Every actual charge between two days (inclusive), in date order. */
export function chargesBetween(entities: Record<string, Entity>, from: ISODate, to: ISODate): Charge[] {
  const out: Charge[] = [];
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || e.deleted || !e.recurrence || !e.date || !e.cost?.amount) continue;
    for (let d = from < e.date ? e.date : from; d <= to; d = addDays(d, 1)) {
      const s = e.completions?.[d];
      if (s !== 'deleted' && s !== 'moved' && s !== 'dropped' && occursOn(e.recurrence, e.date, d)) out.push({ date: d, task: e, amount: chargeOn(e, d) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}

/** Bills still running (not ended) — the ones that make up the monthly total. One per chain: the period that applies now. */
export const activeBills = (entities: Record<string, Entity>, today: ISODate) =>
  [...chains(entities, today).values()].map((c) => c.rep).filter((t) => !!t.cost?.amount && !(t.recurrence!.until && t.recurrence!.until < today));

// ---------- history: repeats that ended or were deleted ----------

export interface PastRepeat {
  task: Task;
  /** first and last day it ran */
  from: ISODate;
  to: ISODate;
  how: 'ended' | 'deleted';
  /** every period of its chain, oldest first (one for a plain repeat) */
  periods: Task[];
  /** the same start date, the next time it comes round (for "add it again") */
  again: ISODate;
  /** days until `again` — set when it's coming up soon (a seasonal nudge) */
  soonIn?: number;
}

const SEASON_NUDGE = 30; // days ahead

/** Same month and day, next time it comes round on or after `today`. */
function nextAnniversary(d: ISODate, today: ISODate): ISODate {
  let y = Number(today.slice(0, 4));
  let c = `${y}${d.slice(4)}`;
  if (c < today) c = `${++y}${d.slice(4)}`;
  return c.endsWith('-02-29') && Number(c.slice(0, 4)) % 4 ? `${c.slice(0, 4)}-02-28` : c;
}

/** Repeats that have finished or were deleted, newest first; one entry per name. */
export function pastRepeats(entities: Record<string, Entity>, today: ISODate): PastRepeat[] {
  const liveTitles = new Set(
    Object.values(entities)
      .filter((e): e is Task => e.type === 'task' && !e.deleted && !!e.recurrence && !(e.recurrence.until && e.recurrence.until < today))
      .map((t) => t.title.trim().toLowerCase()),
  );
  const all = Object.values(entities).filter((e): e is Task => e.type === 'task' && !!e.recurrence && !!e.date && !e.purged);
  const periodsOf = (t: Task) => all.filter((e) => chainKey(e) === chainKey(t) && e.deleted === t.deleted).sort((a, b) => a.date!.localeCompare(b.date!));
  const best = new Map<string, PastRepeat>();
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || !e.recurrence || !e.date || e.purged) continue;
    const ended = !!e.recurrence.until && e.recurrence.until < today;
    if (!e.deleted && !ended) continue;
    const key = e.title.trim().toLowerCase();
    if (liveTitles.has(key)) continue; // it's running again already
    const to = ended ? e.recurrence.until! : new Date(e.updatedAt).toISOString().slice(0, 10);
    const again = nextAnniversary(e.date, today);
    const gap = diffDays(today, again);
    const periods = periodsOf(e);
    const first = periods[0]?.date ?? e.date;
    const p: PastRepeat = { task: e, from: first < e.date ? first : e.date, to: to < e.date ? e.date : to, how: e.deleted ? 'deleted' : 'ended', again, periods, ...(gap <= SEASON_NUDGE ? { soonIn: gap } : {}) };
    const prev = best.get(key);
    if (!prev || p.to > prev.to) best.set(key, p);
  }
  return [...best.values()].sort((a, b) => b.to.localeCompare(a.to));
}
