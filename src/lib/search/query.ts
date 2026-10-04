import type { Importance, ISODate } from '../../types';
import { addDays, addMonths, daysInMonth, fromISO, startOfWeekMon, toISO } from '../date';

/**
 * Pull filters out of what the user typed: "dentist last month" → text "dentist" + a date range.
 * Whatever isn't recognised stays as search text.
 */
export interface Filters {
  from?: ISODate;
  to?: ISODate;
  /** human label for the date chip, e.g. "last month" */
  dateLabel?: string;
  status?: 'open' | 'done';
  importance?: Importance;
  bills?: boolean;
}

export interface ParsedQuery {
  text: string;
  filters: Filters;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

export function parseQuery(input: string, today: ISODate): ParsedQuery {
  const f: Filters = {};
  let s = ` ${input.trim()} `;
  // fn may return false to leave the words in place (not a filter after all)
  const take = (re: RegExp, fn: (...m: string[]) => boolean | void) => {
    s = s.replace(re, (...m: string[]) => (fn(...m) === false ? m[0] : ' '));
  };
  const range = (from: ISODate, to: ISODate, label: string) => {
    Object.assign(f, { from, to, dateLabel: label });
  };
  const year = Number(today.slice(0, 4));

  // relative ranges
  take(/\s(today|今天)(?=\s)/i, () => range(today, today, 'today'));
  take(/\s(yesterday|昨天)(?=\s)/i, () => range(addDays(today, -1), addDays(today, -1), 'yesterday'));
  take(/\s(tomorrow|明天)(?=\s)/i, () => range(addDays(today, 1), addDays(today, 1), 'tomorrow'));
  take(/\s(this|last|next|上|下|这|本)\s?(week|month|year|周|个月|月|年)(?=\s)/i, (_m, which, unit) => {
    const w = ({ this: 0, 这: 0, 本: 0, last: -1, 上: -1, next: 1, 下: 1 } as Record<string, number>)[which.toLowerCase()];
    const u = unit.toLowerCase();
    if (u === 'week' || u === '周') {
      const from = addDays(startOfWeekMon(today), 7 * w);
      range(from, addDays(from, 6), `${which.toLowerCase()} week`);
    } else if (u === 'year' || u === '年') {
      range(`${year + w}-01-01`, `${year + w}-12-31`, `${which.toLowerCase()} year`);
    } else {
      const from = addMonths(`${today.slice(0, 8)}01`, w);
      range(from, addDays(addMonths(from, 1), -1), `${which.toLowerCase()} month`);
    }
  });
  // "in march", "march 2026", "march"
  take(new RegExp(`\\s(in\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?(?=\\s)`, 'i'), (_m, inWord, mon, y) => {
    const m = MONTHS.indexOf(mon.toLowerCase());
    if (m === 4 && !inWord && !y && /^\s*may\s*$/i.test(_m)) return false; // "may" is usually just a word
    let yy = y ? Number(y) : year;
    // a month without a year means the most recent one (this year's, or last year's if it's still ahead)
    if (!y && m > fromISO(today).getMonth()) yy -= 1;
    const from = toISO(new Date(yy, m, 1));
    range(from, toISO(new Date(yy, m, daysInMonth(yy, m))), `${MONTHS[m][0].toUpperCase()}${MONTHS[m].slice(1)} ${yy}`);
  });
  // "in 2025"
  take(/\s(?:in\s+)?(20\d\d)(?=\s)/, (_m, y) => range(`${y}-01-01`, `${y}-12-31`, y));

  // status / importance / bills
  take(/\s(done|finished|completed|已完成|完成)(?=\s)/i, () => {
    f.status = 'done';
  });
  take(/\s(open|unfinished|todo|to-do|not done|未完成)(?=\s)/i, () => {
    f.status = 'open';
  });
  take(/\s(must|should|could)s?(?=\s)/i, (_m, l) => {
    f.importance = l.toLowerCase() as Importance;
  });
  take(/\s(bills?|subscriptions?|账单|订阅)(?=\s)/i, () => {
    f.bills = true;
  });

  return { text: s.replace(/\s+/g, ' ').trim(), filters: f };
}
