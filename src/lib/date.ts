import type { ISODate } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const todayISO = () => toISO(new Date());

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function daysInMonth(y: number, m0: number) {
  return new Date(y, m0 + 1, 0).getDate();
}
export function addMonths(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toISO(d);
}
/** b − a in whole days */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}
export const weekday = (s: ISODate) => fromISO(s).getDay();

/** Next date (>= from, or > from when strict) falling on weekday wd. */
export function nextWeekday(from: ISODate, wd: number, strict = false): ISODate {
  let diff = (wd - weekday(from) + 7) % 7;
  if (diff === 0 && strict) diff = 7;
  return addDays(from, diff);
}
export const startOfWeekMon = (s: ISODate) => addDays(s, -((weekday(s) + 6) % 7));

export function fmtMD(s: ISODate) {
  const d = fromISO(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
export function fmtDay(s: ISODate, today = todayISO()) {
  const d = fromISO(s);
  const y = d.getFullYear() !== fromISO(today).getFullYear() ? `/${String(d.getFullYear()).slice(2)}` : '';
  return `${WD[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}${y}`;
}
export function relDay(s: ISODate, today = todayISO()): string {
  const n = diffDays(today, s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WD[weekday(s)];
  if (n >= 7) return n < 60 ? `in ${n} days` : `in ${Math.round(n / 30.4)} months`;
  return `${-n} days ago`;
}
export function fmtTime(t?: string) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`;
}
export function localDateTime(d: Date) {
  return `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseLocalDateTime(s: string): Date {
  const [date, time = '09:00'] = s.split('T');
  const d = fromISO(date);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}
/** Upcoming Saturday (today if it's already the weekend). */
export function weekendOf(today: ISODate) {
  const wd = weekday(today);
  return wd === 6 || wd === 0 ? today : nextWeekday(today, 6);
}
export const nextMonday = (today: ISODate) => nextWeekday(today, 1, true);
