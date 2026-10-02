import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarSearch, ChevronLeft, ChevronRight, LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';
import type { ISODate } from '../types';
import { useStore } from '../store';
import { addMonths, fmtDay, fromISO, MONTHS, relDay, todayISO } from '../lib/date';
import { parseQuick } from '../lib/parse';
import { cls } from '../lib/id';
import { jumpTo } from '../actions';
import { isSubmitKey } from './ui';

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October 2026", "Sep – Oct 2026", "Dec 2026 – Jan 2027" */
export function rangeLabel(from: ISODate, to: ISODate) {
  const a = fromISO(from);
  const b = fromISO(to);
  if (a.getFullYear() !== b.getFullYear()) return `${MONTHS[a.getMonth()]} ${a.getFullYear()} – ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  if (a.getMonth() !== b.getMonth()) return `${MONTHS[a.getMonth()]} – ${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  return `${FULL_MONTHS[a.getMonth()]} ${a.getFullYear()}`;
}

const scrollWeeks = (n: number) => window.dispatchEvent(new CustomEvent('tl-scroll', { detail: 7 * n }));

export function DateNav({ today }: { today: ISODate }) {
  const visible = useStore((s) => s.ui.visible);
  const where = !visible ? 'in' : today < visible.from ? 'before' : today > visible.to ? 'after' : 'in';
  return (
    <div className="date-nav">
      <div className="nav-group">
        <button className="nav-btn" title="Show the previous week  ( [ )" onClick={() => scrollWeeks(-1)}>
          <ChevronLeft size={15} /> Week
        </button>
        <button
          className={cls('nav-btn today-btn', where !== 'in' && 'away')}
          title={where === 'in' ? 'Today is on screen — click to centre it  (T)' : 'Jump back to today  (T)'}
          onClick={() => jumpTo(today)}
        >
          {where === 'before' && <ArrowLeft size={13} />}
          <LocateFixed size={13} /> {where === 'in' ? 'Today' : 'Back to today'}
          {where === 'after' && <ArrowRight size={13} />}
        </button>
        <button className="nav-btn" title="Show the next week  ( ] )" onClick={() => scrollWeeks(1)}>
          Week <ChevronRight size={15} />
        </button>
      </div>
      <GoToDate today={today} />
      <ZoomControl />
      {visible && <span className="range-label" title="Months and year currently on screen">{rangeLabel(visible.from, visible.to)}</span>}
    </div>
  );
}

/** "Go to date…" popover: type anything the sticky understands, pick from a calendar, or use a shortcut. */
function GoToDate({ today }: { today: ISODate }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const parsed = q.trim() ? parseQuick(q, today).date : undefined;
  const go = (d: ISODate) => {
    jumpTo(d);
    setOpen(false);
    setQ('');
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && e.target instanceof Node && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'g' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const shortcuts: [string, ISODate][] = [
    ['Next month', addMonths(today, 1)],
    ['In 3 months', addMonths(today, 3)],
    ['In 6 months', addMonths(today, 6)],
    ['In a year', addMonths(today, 12)],
    ['A month ago', addMonths(today, -1)],
    [`Jan 1, ${fromISO(today).getFullYear() + 1}`, `${fromISO(today).getFullYear() + 1}-01-01`],
  ];
  return (
    <div className="goto" ref={ref}>
      <button className={cls('nav-btn', open && 'on')} title="Go to any date  (G)" onClick={() => setOpen((o) => !o)}>
        <CalendarSearch size={14} /> Go to date…
      </button>
      {open && (
        <div className="goto-pop">
          <input
            autoFocus
            value={q}
            placeholder="12/25, next month, in 6 months, 3月15日…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => isSubmitKey(e) && parsed && go(parsed)}
          />
          <div className={cls('goto-parsed', !parsed && q.trim() && 'none')}>
            {q.trim() ? (parsed ? <>↵ {fmtDay(parsed, todayISO())} · {relDay(parsed, today)} · {fromISO(parsed).getFullYear()}</> : 'Not a date I understand yet') : 'Type a date, or pick one below'}
          </div>
          <div className="goto-grid">
            {shortcuts.map(([l, d]) => (
              <button key={l} className="chip-btn" onClick={() => go(d)}>
                {l}
              </button>
            ))}
          </div>
          <label className="goto-cal">
            <span>Pick on a calendar</span>
            <input type="date" onChange={(e) => e.target.value && go(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}


const zoomBy = (d: number | 'reset') => window.dispatchEvent(new CustomEvent('tl-zoom', { detail: d }));

/** − 100% + : how many days fit on screen. Pinch on the trackpad does the same. */
function ZoomControl() {
  const zoom = useStore((s) => s.settings.timelineZoom ?? 1);
  return (
    <div className="nav-group zoom-ctl" title="Zoom the days — pinch with two fingers, or ⌘+ / ⌘−">
      <button className="nav-btn" disabled={zoom <= 0.5} onClick={() => zoomBy(-0.1)} title="See more days (⌘−)">
        <ZoomOut size={14} />
      </button>
      <button className="nav-btn zoom-val" onClick={() => zoomBy('reset')} title="Back to 100% (⌘0)">
        {Math.round(zoom * 100)}%
      </button>
      <button className="nav-btn" disabled={zoom >= 1.5} onClick={() => zoomBy(0.1)} title="See fewer, bigger days (⌘+)">
        <ZoomIn size={14} />
      </button>
    </div>
  );
}
