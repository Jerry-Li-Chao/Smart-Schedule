import type { Importance, ISODate, Recurrence } from '../types';
import { addDays, addMonths, daysInMonth, fromISO, nextMonday, nextWeekday, toISO, weekendOf } from './date';

/**
 * Quick-capture parser. Understands things like
 *   "call the bank tmr 7:55am !!"      → tomorrow, 07:55, must
 *   "passport renewal in 6 months"  → date 6 months out
 *   "pay credit card every month on 10/25"
 *   "明天下午3点 看牙医"  "每周一 健身"
 * Anything it doesn't recognise stays in the title.
 */
export interface Parsed {
  title: string;
  date?: ISODate;
  time?: string;
  importance?: Importance;
  recurrence?: Recurrence;
  deadline?: ISODate;
  someday?: boolean;
}

const WD_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WD_RE = '(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?';
const CN_WD: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');

function wdIndex(word: string): number {
  const w = word.toLowerCase().slice(0, 3);
  return WD_NAMES.findIndex((n) => n.startsWith(w));
}
function addUnit(today: ISODate, n: number, unit: string): ISODate {
  const u = unit.toLowerCase();
  if (u.startsWith('day') || u === '天') return addDays(today, n);
  if (u.startsWith('week') || u === '周' || u.includes('星期')) return addDays(today, 7 * n);
  if (u.startsWith('month') || u.includes('月')) return addMonths(today, n);
  return addMonths(today, 12 * n);
}
/** Interpret month/day without a year: the next time it comes around (allowing ~a month in the past). */
function resolveMD(today: ISODate, m: number, d: number, y?: number): ISODate | undefined {
  if (m < 1 || m > 12 || d < 1) return undefined;
  let year = y ?? fromISO(today).getFullYear();
  if (year < 100) year += 2000;
  if (d > daysInMonth(year, m - 1)) return undefined;
  let iso = toISO(new Date(year, m - 1, d));
  if (y === undefined && iso < addDays(today, -30)) iso = toISO(new Date(year + 1, m - 1, d));
  return iso;
}

export function parseQuick(input: string, today: ISODate): Parsed {
  const out: Parsed = { title: '' };
  let s = ' ' + input.replace(/^\s*(?:\d+[.)、]|[-•*·])\s+/, '') + ' ';
  const take = (re: RegExp, fn: (...m: string[]) => boolean | void) => {
    s = s.replace(re, (...m: string[]) => (fn(...m) === false ? m[0] : ' '));
  };
  let byDeadline = false;

  // someday / idea
  take(/^\s*(?:idea|someday|想法)\s*[:：]\s*/i, () => { out.someday = true; });
  take(/\s#?someday(?=\s)/i, () => { out.someday = true; });


  // ---- recurrence ----
  take(/\bevery\s+(?:week)?days?\b(?=\s)|\bweekdays\b|每个?工作日/i, (m) => {
    if (/^every\s+days?$/i.test(m.trim())) { out.recurrence = { freq: 'daily', interval: 1 }; return; }
    out.recurrence = { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] };
  });
  take(new RegExp(`\\bevery\\s+(other\\s+)?(${WD_RE}(?:\\s*(?:,|and|&)\\s*${WD_RE})*)\\b`, 'i'), (_m, other, list) => {
    const days = list.split(/\s*(?:,|and|&)\s*/i).map(wdIndex).filter((x) => x >= 0);
    out.recurrence = { freq: 'weekly', interval: other ? 2 : 1, byWeekday: days };
  });
  take(/\bevery\s+(other\s+)?(?:(\d+)\s+)?(day|week|month|year)s?\b/i, (_m, other, n, unit) => {
    out.recurrence = { freq: (unit.toLowerCase() === 'day' ? 'daily' : unit.toLowerCase() + 'ly') as Recurrence['freq'], interval: other ? 2 : Number(n || 1) };
  });
  take(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (_m, d) => {
    out.recurrence = { freq: 'monthly', interval: 1 };
    let cand = today;
    while (fromISO(cand).getDate() !== Number(d)) cand = addDays(cand, 1);
    out.date = cand;
  });
  take(/\b(daily|weekly|monthly|yearly|annually)\b/i, (m) => {
    const f = m.toLowerCase() === 'annually' ? 'yearly' : m.toLowerCase();
    out.recurrence = { freq: f as Recurrence['freq'], interval: 1 };
  });
  take(/每天/, () => { out.recurrence = { freq: 'daily', interval: 1 }; });
  take(/每(?:周|星期|礼拜)([一二三四五六日天])/, (_m, c) => {
    out.recurrence = { freq: 'weekly', interval: 1, byWeekday: [CN_WD[c]] };
  });
  take(/每(?:周|星期)/, () => { out.recurrence = { freq: 'weekly', interval: 1 }; });
  take(/每个?月(?:(\d{1,2})[号日])?/, (_m, d) => {
    out.recurrence = { freq: 'monthly', interval: 1 };
    if (d) { let c = today; while (fromISO(c).getDate() !== Number(d)) c = addDays(c, 1); out.date = c; }
  });
  take(/每年/, () => { out.recurrence = { freq: 'yearly', interval: 1 }; });

  // ---- relative dates ----
  take(/\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\b/i, (_m, n, unit) => {
    out.date = addUnit(today, Number(n) || NUM_WORDS[n.toLowerCase()], unit);
  });
  take(/(\d+)\s*(天|周|个?星期|个?月|年)(?:后|之后|以后)/, (_m, n, unit) => {
    out.date = addUnit(today, Number(n), unit.replace('个', ''));
  });
  take(/\b(?:the\s+)?day\s+after\s+tomorrow\b|大后天|后天/i, (m) => { out.date = addDays(today, m === '大后天' ? 3 : 2); });
  take(/\b(today|tonight|tod)\b|今天|今晚|今早/i, () => { out.date = today; });
  take(/\b(tmr|tmrw|tmw|tomorrow|tomorow)\b|明天|明早|明晚/i, () => { out.date = addDays(today, 1); });
  take(/\bnext\s+week\b/i, () => { out.date = nextMonday(today); });
  take(/\bnext\s+month\b|下个?月/i, () => { out.date = addMonths(today, 1); });
  take(/\b(?:this\s+)?weekend\b|周末/i, () => { out.date = weekendOf(today); });
  take(new RegExp(`\\bnext\\s+${WD_RE}\\b`, 'i'), (m) => {
    const wd = wdIndex(m.trim().split(/\s+/)[1]);
    out.date = addDays(nextMonday(today), (wd + 6) % 7);
  });
  take(/下(?:周|星期|礼拜)([一二三四五六日天])/, (_m, c) => { out.date = addDays(nextMonday(today), (CN_WD[c] + 6) % 7); });
  take(/下(?:周|星期)/, () => { out.date = nextMonday(today); });
  take(/(?:这|本)?(?:周|星期|礼拜)([一二三四五六日天])/, (_m, c) => { out.date = nextWeekday(today, CN_WD[c]); });
  // full weekday names stand alone; short ones need "on/this/by" so "sat"/"sun" in sentences survive
  take(new RegExp(`\\b(on|this|by)\\s+${WD_RE}\\b|\\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b`, 'i'), (m, pre) => {
    if (!out.recurrence || out.date) {
      const words = m.trim().split(/\s+/);
      out.date = nextWeekday(today, wdIndex(words[words.length - 1]));
      if (pre?.toLowerCase() === 'by') byDeadline = true;
    } else return false;
  });

  // ---- explicit dates ----
  take(/(?<=\s)(?:(on|by)\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/i, (_m, pre, mo, d, y) => {
    const iso = resolveMD(today, Number(mo), Number(d), y ? Number(y) : undefined);
    if (!iso) return false;
    out.date = iso;
    if (pre?.toLowerCase() === 'by') byDeadline = true;
  });
  take(new RegExp(`\\b(?:(on|by)\\s+)?(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'), (_m, pre, mon, d, y) => {
    const iso = resolveMD(today, MONTHS.indexOf(mon.toLowerCase().slice(0, 3)) + 1, Number(d), y ? Number(y) : undefined);
    if (!iso) return false;
    out.date = iso;
    if (pre?.toLowerCase() === 'by') byDeadline = true;
  });
  take(/(\d{1,2})月(\d{1,2})[日号]?/, (_m, mo, d) => {
    const iso = resolveMD(today, Number(mo), Number(d));
    if (!iso) return false;
    out.date = iso;
  });

  // ---- times ----
  take(/(?:\bat\s+|@\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.;)]|$)/i, (_m, h, mi, ap) => {
    let hh = Number(h) % 12;
    if (ap.toLowerCase().startsWith('p')) hh += 12;
    if (Number(h) > 12) return false;
    out.time = `${pad(hh)}:${mi ?? '00'}`;
  });
  if (!out.time)
    take(/(?:\bat\s+|@\s*)?\b([01]?\d|2[0-3]):([0-5]\d)\b/i, (_m, h, mi) => { out.time = `${pad(Number(h))}:${mi}`; });
  if (!out.time)
    take(/\b(?:at\s+)?noon\b|中午12点/i, () => { out.time = '12:00'; });
  if (!out.time)
    take(/(上午|早上|中午|下午|晚上)?(\d{1,2})[点點](半|(\d{1,2})分?)?/, (_m, part, h, half, mi) => {
      let hh = Number(h);
      if ((part === '下午' || part === '晚上') && hh < 12) hh += 12;
      out.time = `${pad(hh)}:${half === '半' ? '30' : pad(Number(mi || 0))}`;
    });

  if (byDeadline) out.deadline = out.date;
  if (out.time && !out.date) out.date = today;
  if (out.recurrence && !out.date) {
    // weekly on several days: start on whichever of those days comes first (today counts)
    const days = out.recurrence.freq === 'weekly' ? out.recurrence.byWeekday ?? [] : [];
    out.date = days.length ? days.map((d) => nextWeekday(today, d)).sort()[0] : today;
  }

  out.title = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?，。；：])/g, '$1')
    .replace(/^[\s,，;；:：\-–]+|[\s,，;；:：\-–]+$/g, '')
    .replace(/\s+(on|at|by|in)$/i, '')
    .trim();
  if (!out.title) out.title = input.trim();
  return out;
}

/** Only the time part — used when importing cells like "9AM 晨会". */
export function extractTime(text: string): { title: string; time?: string } {
  const m = text.match(/^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*/i);
  if (!m || Number(m[1]) > 12) return { title: text };
  let hh = Number(m[1]) % 12;
  if (m[3].toLowerCase() === 'pm') hh += 12;
  return { title: text.slice(m[0].length).trim() || text, time: `${pad(hh)}:${m[2] ?? '00'}` };
}

/**
 * Split a pasted sticky note into items. Numbered / top-level lines become items;
 * indented or "- " lines directly under an item become that item's notes.
 */
export function splitCapture(text: string): { line: string; notes?: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
  if (lines.length <= 1) return lines.map((line) => ({ line }));
  const numbered = lines.some((l) => /^\s*\d+[.)、]\s/.test(l));
  const items: { line: string; notes?: string }[] = [];
  for (const l of lines) {
    const isSub = numbered ? !/^\s*\d+[.)、]\s/.test(l) : /^\s+/.test(l);
    if (isSub && items.length) {
      const last = items[items.length - 1];
      last.notes = (last.notes ? last.notes + '\n' : '') + l.trim();
    } else items.push({ line: l.trim() });
  }
  return items;
}
