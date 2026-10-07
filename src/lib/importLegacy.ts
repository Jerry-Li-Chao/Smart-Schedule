import type { ISODate, Importance, Status, Task, TaskColor } from '../types';
import { fromISO, toISO } from './date';
import { extractTime } from './parse';
import { hashId } from './id';

/**
 * Converts the old "one column per day, colour = meaning" sheet into tasks.
 * red → must · orange, yellow → should · green → done · grey (any shade) → obsolete · white → could.
 * Any other colour (purple, blue, pink…) has no meaning in the planner: it becomes a could task that keeps
 * the nearest palette colour, with a note saying which colour the cell had.
 */
export interface LegacySheet {
  name: string;
  header: string[]; // display values of row 1
  cells: string[][]; // rows 2..n, display values
  bgs: string[][]; // rows 2..n, hex backgrounds
  /** cells merged across several day columns: row (0 = row 2), first column, number of columns */
  spans?: { r: number; c: number; cols: number }[];
}

export interface ColorKind {
  importance: Importance;
  status: Status;
  /** set for colours with no planner meaning: the cell's colour, kept as a label */
  other?: { color: TaskColor; name: string; hex: string };
}

export function classifyColor(hex: string): ColorKind | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return { importance: 'could', status: 'open' };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if (l > 0.97) return { importance: 'could', status: 'open' }; // white
  if (sat < 0.12) return { importance: 'could', status: 'dropped' }; // grey
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 22 || h >= 335) return { importance: 'must', status: 'open' };
  // orange sits between yellow and red; there's no level for it, so it rounds down to should
  if (h >= 22 && h < 68) return { importance: 'should', status: 'open' };
  if (h >= 68 && h < 170) return { importance: 'could', status: 'done' };
  const [color, name]: [TaskColor, string] = h < 200 ? ['teal', 'cyan'] : h < 250 ? ['blue', 'blue'] : h < 300 ? ['purple', 'purple'] : ['pink', 'magenta'];
  return { importance: 'could', status: 'open', other: { color, name, hex: '#' + m[1].toLowerCase() } };
}

/** "9/28", "9/28/2026", "2026-09-28", "Mon 9/28" → ISO, inferring the year as columns advance. */
export function parseHeaderDates(header: string[], sheetName: string, fallbackYear: number): (ISODate | null)[] {
  let year = Number(/20\d\d/.exec(sheetName)?.[0] ?? fallbackYear);
  let lastMonth = 0;
  return header.map((h) => {
    const s = String(h ?? '').trim();
    let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) {
      year = Number(m[1]);
      lastMonth = Number(m[2]);
      return toISO(new Date(year, Number(m[2]) - 1, Number(m[3])));
    }
    m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(s);
    if (!m) return null;
    const mo = Number(m[1]);
    if (m[3]) year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    else if (lastMonth && mo < lastMonth - 6) year += 1; // Dec → Jan
    lastMonth = mo;
    return toISO(new Date(year, mo - 1, Number(m[2])));
  });
}

/** "(cont.)" / "(continued)" / "(续)" at the end of a cell = the same task carried to another day */
const CONT_RE = /\s*[(（]\s*(续|cont\.?|continued)\s*[)）]\s*$/i;

export interface ImportOptions {
  from: ISODate;
  to?: ISODate;
  today: ISODate;
  /** what to do with red/yellow/white cells before `today` that were never marked green */
  /** what to do with red/yellow/white cells on past days: leave them as they are, or mark them obsolete */
  oldUnfinished: 'keep' | 'obsolete';
  existing: Set<string>;
}

export function legacyToTasks(sheet: LegacySheet, opts: ImportOptions): Task[] {
  const dates = parseHeaderDates(sheet.header, sheet.name, fromISO(opts.today).getFullYear());
  const out: Task[] = [];
  const byTitle = new Map<string, Task>(); // for merging "(cont.)" continuations
  const now = Date.now();
  const spanAt = new Map((sheet.spans ?? []).filter((s) => s.cols > 1).map((s) => [`${s.r}|${s.c}`, s.cols]));

  dates.forEach((date, col) => {
    if (!date || date < opts.from || (opts.to && date > opts.to)) return;
    sheet.cells.forEach((row, r) => {
      const raw = String(row[col] ?? '').trim();
      if (!raw) return;
      const kind = classifyColor(sheet.bgs[r]?.[col] ?? '#ffffff');
      if (!kind) return;
      // a block merged across several days = a multi-day all-day event (a trip, a holiday, a course week)
      const cols = spanAt.get(`${r}|${col}`);
      if (cols) {
        const covered = dates.slice(col, col + cols).filter((d): d is ISODate => !!d && (!opts.to || d <= opts.to));
        const end = covered[covered.length - 1];
        if (end && end > date) {
          const id = hashId('t_imp', `${sheet.name}|${date}|${r}|${raw}`);
          const { title } = extractTime(raw.replace(CONT_RE, ''));
          const ev: Task = {
            type: 'task',
            id,
            title,
            date,
            endDate: end,
            allDay: true,
            firstScheduled: date,
            importance: 'could',
            status: 'open',
            order: r,
            createdAt: now,
            updatedAt: now,
            notes: kind.other ? `Imported colour: ${kind.other.name} (${kind.other.hex})` : undefined,
          };
          if (!opts.existing.has(id)) out.push(ev);
          return;
        }
      }
      const isCont = CONT_RE.test(raw);
      const { title, time } = extractTime(raw.replace(CONT_RE, ''));
      const key = title.toLowerCase();
      let status = kind.status;
      if (status === 'open' && date < opts.today && opts.oldUnfinished === 'obsolete') status = 'dropped';

      const prev = isCont ? byTitle.get(key) : undefined;
      if (prev) {
        // same task carried to another day: keep one task, remember when it started
        prev.date = date;
        prev.status = status;
        prev.doneAt = status === 'done' ? doneOn(date) : undefined;
        if (kind.importance !== 'could') prev.importance = kind.importance;
        return;
      }
      const id = hashId('t_imp', `${sheet.name}|${date}|${r}|${raw}`);
      const t: Task = {
        type: 'task',
        id,
        title,
        time,
        date,
        firstScheduled: date,
        importance: kind.importance,
        status,
        doneAt: status === 'done' ? doneOn(date) : undefined, // the sheet only knows the day, not the moment
        order: r,
        createdAt: now,
        updatedAt: now,
        notes: kind.other ? `Imported colour: ${kind.other.name} (${kind.other.hex})` : undefined,
        color: kind.other?.color,
      };
      byTitle.set(key, t); // registered even when skipped, so its "(cont.)" copies are skipped too
      if (!opts.existing.has(id)) out.push(t);
    });
  });
  // past days stay where they were in the sheet instead of all piling onto today
  for (const t of out) if (t.date && t.date < opts.today) t.stay = true;
  return out;
}

/** Imported tasks were done on their own day — never "at import time", or they'd all count as this week's wins. */
const doneOn = (d: ISODate) => new Date(`${d}T12:00:00`).getTime();
