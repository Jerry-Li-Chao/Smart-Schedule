import type { ISODate, Recurrence, Task } from '../types';
import { addDays, daysInMonth, diffDays, fromISO, startOfWeekMon, weekday, WD } from './date';

export function occursOn(r: Recurrence, start: ISODate, d: ISODate): boolean {
  if (d < start) return false;
  if (r.until && d > r.until) return false;
  const iv = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case 'daily':
      return diffDays(start, d) % iv === 0;
    case 'weekly': {
      const days = r.byWeekday?.length ? r.byWeekday : [weekday(start)];
      if (!days.includes(weekday(d))) return false;
      return Math.round(diffDays(startOfWeekMon(start), startOfWeekMon(d)) / 7) % iv === 0;
    }
    case 'monthly': {
      const s = fromISO(start);
      const x = fromISO(d);
      const months = (x.getFullYear() - s.getFullYear()) * 12 + x.getMonth() - s.getMonth();
      if (months % iv) return false;
      return x.getDate() === Math.min(s.getDate(), daysInMonth(x.getFullYear(), x.getMonth()));
    }
    case 'yearly': {
      const s = fromISO(start);
      const x = fromISO(d);
      if ((x.getFullYear() - s.getFullYear()) % iv || x.getMonth() !== s.getMonth()) return false;
      return x.getDate() === Math.min(s.getDate(), daysInMonth(x.getFullYear(), x.getMonth()));
    }
  }
}

export function nextOccurrence(r: Recurrence, start: ISODate, from: ISODate, horizon = 800): ISODate | null {
  let d = from < start ? start : from;
  for (let i = 0; i < horizon; i++, d = addDays(d, 1)) if (occursOn(r, start, d)) return d;
  return null;
}

export function describeRecurrence(r: Recurrence, start: ISODate): string {
  const iv = Math.max(1, r.interval || 1);
  const every = (unit: string) => (iv === 1 ? `Every ${unit}` : `Every ${iv} ${unit}s`);
  let s: string;
  switch (r.freq) {
    case 'daily':
      s = every('day');
      break;
    case 'weekly': {
      const days = r.byWeekday?.length ? r.byWeekday : [weekday(start)];
      const isWeekdays = days.length === 5 && [1, 2, 3, 4, 5].every((x) => days.includes(x));
      s = isWeekdays && iv === 1 ? 'Every weekday' : `${every('week')} on ${days.map((x) => WD[x]).join(', ')}`;
      break;
    }
    case 'monthly':
      s = `${every('month')} on the ${ordinal(fromISO(start).getDate())}`;
      break;
    case 'yearly':
      s = `${every('year')} on ${fromISO(start).getMonth() + 1}/${fromISO(start).getDate()}`;
      break;
  }
  return r.until ? `${s} until ${r.until}` : s;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------- numbered repeats
// "Spanish L#" → Spanish L1, L2, L3…   "Vitamin D #" starting at 42 → Vitamin D 42, Vitamin D 43…
// Days you delete don't use up a number; skipped days keep theirs.

const numCache = new Map<string, number>();

export function occurrenceNumber(t: Task, date: ISODate): number {
  const start = t.numbering?.start ?? 1;
  if (!t.recurrence || !t.date || date < t.date) return start;
  const key = `${t.id}|${t.updatedAt}|${date}`;
  const hit = numCache.get(key);
  if (hit !== undefined) return hit;
  let n = start - 1;
  for (let d = t.date; d <= date; d = addDays(d, 1))
    if (occursOn(t.recurrence, t.date, d) && t.completions?.[d] !== 'deleted') n++;
  if (numCache.size > 5000) numCache.clear();
  numCache.set(key, n);
  return n;
}

/** Title for one day of a repeating task: "#" becomes the number, or it's appended. */
export function numberedTitle(t: Task, date: ISODate): string {
  if (!t.numbering) return t.title;
  const n = String(occurrenceNumber(t, date));
  return t.title.includes('#') ? t.title.replace('#', n) : `${t.title} ${n}`;
}
