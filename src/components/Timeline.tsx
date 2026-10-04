import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { SortToggle } from './SortToggle';
import type { DayItem, ISODate, Project, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, diffDays, fromISO, MONTHS, WD, weekday } from '../lib/date';
import { eventsFor, itemsFor, type DayEvent } from '../lib/dayIndex';
import { useDayIndex, useIsMobile } from '../lib/hooks';
import { useBoxSelect } from '../lib/boxSelect';
import { cls } from '../lib/id';
import { capture, getProject, getTask, moveMany, moveOccurrence, schedule, trackerUpdate } from '../actions';
import { DRAG_MIME, ItemCard, type DragPayload } from './ItemCard';

const COL_W = 252;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;

type Drop = { date: ISODate; index: number } | null;

/** Where you were looking when you left the Days tab (this session only). */
let lastAnchor: ISODate | undefined;

export function Timeline({ today }: { today: ISODate }) {
  const idx = useDayIndex();
  const mobile = useIsMobile();
  const jump = useStore((s) => s.ui.jump);
  const ref = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const [vh, setVh] = useState(0);
  const [left, setLeft] = useState(0);
  const [drop, setDrop] = useState<Drop>(null);
  const zoom = useStore((s) => s.settings.timelineZoom ?? 1);
  const daySort = useStore((s) => s.settings.daySort ?? 'time');
  const colW = mobile ? Math.max(vw, 280) : Math.round(COL_W * zoom);
  /** while zooming: keep the day under the cursor (or screen centre) exactly where it was */
  const zoomFocus = useRef<{ day: number; x: number } | null>(null);
  const pinch = useRef<{ raw: number; idle?: ReturnType<typeof setTimeout> }>({ raw: 0 });
  // visible window only — tasks outside it are not touched, just not drawn
  const BACK = useStore((s) => s.settings.rangeBackDays ?? 365);
  const FWD = useStore((s) => s.settings.rangeFwdDays ?? 730);
  const TOTAL = BACK + FWD + 1;
  const origin = useMemo(() => addDays(today, -BACK), [today, BACK]);
  // first visible day: kept across resizes, and across switching tabs (fresh launch starts at today)
  const anchor = useRef<ISODate>(lastAnchor ?? addDays(today, mobile ? 0 : -1));
  const raf = useRef(0);

  const scrollToDate = (date: ISODate, smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    const i = diffDays(origin, date) - (mobile ? 0 : 1);
    const target = Math.max(0, i * colW);
    // glide for short hops; long jumps (months away) land instantly instead of a long blur
    const near = Math.abs(target - el.scrollLeft) < el.clientWidth * 3;
    el.scrollTo({ left: target, behavior: smooth && near && document.visibilityState === 'visible' ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => {
      setVw(el.clientWidth);
      setVh(el.clientHeight);
    });
    ro.observe(el);
    setVw(el.clientWidth);
    setVh(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // keep the same day in view when the column width changes (desktop ⇄ phone layout)
  useLayoutEffect(() => {
    if (!vw) return;
    const el = ref.current!;
    if (zoomFocus.current) {
      el.scrollLeft = zoomFocus.current.day * colW - zoomFocus.current.x;
      zoomFocus.current = null;
    } else {
      const i = Math.min(TOTAL - 1, Math.max(0, diffDays(origin, anchor.current)));
      el.scrollLeft = i * colW;
    }
    setLeft(el.scrollLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colW, vw > 0, BACK, FWD]);

  useEffect(() => {
    if (jump) scrollToDate(jump.date, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n]);

  // zoom: columns scale fully, text only half as much (50% → 0.75× text) so it stays readable
  // trackpad pinch (arrives as ctrl+wheel), ⌘+/⌘−/⌘0, or the top-bar control
  useEffect(() => {
    const el = ref.current!;
    const apply = (next: number, x = el.clientWidth / 2) => {
      const cur = S().settings.timelineZoom ?? 1;
      // snap to 5% steps: 50%, 55%, … 150%
      const z = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 20) / 20;
      if (Math.abs(z - cur) < 0.001 || mobile) return;
      zoomFocus.current = { day: (el.scrollLeft + x) / colW, x };
      S().setSettings({ timelineZoom: z });
    };
    // a pinch arrives as many tiny ctrl+wheel events; follow the fingers continuously
    // and only show the nearest 5% step, so slow pinches still move
    const g = pinch.current; // survives re-renders mid-gesture
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain two-finger swipes keep scrolling
      e.preventDefault();
      if (!g.raw) g.raw = S().settings.timelineZoom ?? 1;
      g.raw = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, g.raw * Math.exp(-e.deltaY * 0.01)));
      clearTimeout(g.idle);
      g.idle = setTimeout(() => (g.raw = 0), 250); // gesture over
      apply(g.raw, e.clientX - el.getBoundingClientRect().left);
    };
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent<number | 'reset'>).detail;
      apply(d === 'reset' ? 1 : (S().settings.timelineZoom ?? 1) + d);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('tl-zoom', onZoom);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('tl-zoom', onZoom);
    };
  }, [colW, mobile]);

  useEffect(() => {
    const on = (e: Event) => ref.current?.scrollBy({ left: (e as CustomEvent<number>).detail * colW, behavior: 'smooth' });
    window.addEventListener('tl-scroll', on);
    return () => window.removeEventListener('tl-scroll', on);
  }, [colW]);

  const onScroll = () => {
    const el = ref.current;
    if (el) anchor.current = lastAnchor = addDays(origin, Math.round(el.scrollLeft / colW));
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => ref.current && setLeft(ref.current.scrollLeft));
  };

  const onHeaderWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) ref.current!.scrollLeft += e.deltaY;
  };

  // Phone: native swipe-one-day snapping needs a snap target for every day, not just the rendered ones.
  const snapPoints = useMemo(
    () => (mobile ? Array.from({ length: TOTAL }, (_, i) => <i key={i} className="snap-pt" style={{ left: i * colW, width: colW }} />) : null),
    [mobile, colW, TOTAL],
  );

  // tell the top bar which days are on screen (only when it actually changes)
  useEffect(() => {
    if (!vw) return;
    const from = addDays(origin, Math.min(TOTAL - 1, Math.round(left / colW)));
    const to = addDays(origin, Math.min(TOTAL - 1, Math.floor((left + vw - 1) / colW)));
    const v = S().ui.visible;
    if (v?.from !== from || v?.to !== to) S().setUI({ visible: { from, to } });
  }, [left, vw, colW, origin, TOTAL]);

  const first = Math.max(0, Math.floor(left / colW) - 2);
  const last = Math.min(TOTAL - 1, Math.floor((left + (vw || 1200)) / colW) + 2);
  const cols: ISODate[] = [];
  for (let i = first; i <= last; i++) cols.push(addDays(origin, i));
  const tz = mobile ? 1 : 0.5 + zoom / 2;

  // Split each day: the sorted list on top, and "tracks" underneath — project steps and numbered
  // repeats without a time — each track on the same row across days, like the old sheet.
  const colData = cols.map((date) => {
    const regular: DayItem[] = [];
    const tracks = new Map<string, DayItem[]>();
    for (const it of itemsFor(idx, date, daySort, today)) {
      const k = trackKey(it, idx.series);
      if (!k) regular.push(it);
      else tracks.set(k, [...(tracks.get(k) ?? []), it]);
    }
    return { date, regular, tracks, events: eventsFor(idx, date) };
  });
  // one band height for every visible day, so multi-day events line up as bars
  const eventLanes = colData.reduce((m, c) => Math.max(m, ...c.events.map((e) => e.lane + 1)), 0);
  const chunk = Math.floor(first / 14) * 14;
  const trackRows = useMemo(() => {
    const max = new Map<string, number>();
    for (let i = Math.max(0, chunk - 14); i <= Math.min(TOTAL - 1, chunk + 42); i++) {
      const counts = new Map<string, number>();
      for (const it of itemsFor(idx, addDays(origin, i), daySort, today)) {
        const k = trackKey(it, idx.series);
        if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      for (const [k, n] of counts) max.set(k, Math.max(max.get(k) ?? 0, n));
    }
    const label = (k: string) => (k.startsWith('p:') ? idx.projects[k.slice(2)]?.title ?? '' : idx.series.find((x) => x.id === k.slice(2))?.title ?? '');
    const rank = (k: string) => (k.startsWith('p:') ? idx.projects[k.slice(2)]?.order ?? 0 : Number.MAX_SAFE_INTEGER);
    return [...max]
      .sort(([a], [b]) => rank(a) - rank(b) || label(a).localeCompare(label(b)))
      .map(([key, n]) => ({ key, h: n * TRACK_CARD_H + (n - 1) * 4 }));
  }, [chunk, idx, origin, daySort, today, TOTAL]);
  const tracksCollapsed = useStore((s) => !!s.settings.tracksCollapsed);

  // tracks start below the tallest sorted list on screen, so their rows line up across days
  const [regH, setRegH] = useState<Record<ISODate, number>>({});
  const pending = useRef<Record<ISODate, number>>({});
  const flush = useRef(0);
  const report = useCallback((date: ISODate, h: number) => {
    pending.current[date] = h;
    cancelAnimationFrame(flush.current);
    flush.current = requestAnimationFrame(() => {
      const p = pending.current;
      pending.current = {};
      setRegH((prev) => (Object.keys(p).some((d) => Math.abs((prev[d] ?? -1) - p[d]) > 0.5) ? { ...prev, ...p } : prev));
    });
  }, []);
  // the section is pinned to the bottom of the window (like a frozen row), so it never jumps;
  // the page is just tall enough for the longest day plus that section
  const tallest = Math.ceil(Math.max(0, ...cols.map((d) => regH[d] ?? 0)));
  // at most MAX_TRACK_ROWS rows are visible; the rest scroll inside the strip (all days together)
  // cap by cards, not rows: a project with 3 steps on one day makes a 3-card row
  const allTrackH = trackRows.reduce((s, r) => s + r.h + 6, 0);
  const tracksCapH = Math.min(allTrackH, MAX_TRACK_CARDS * (TRACK_CARD_H + 6));
  const totalCards = trackRows.reduce((s, r) => s + Math.round((r.h + 4) / (TRACK_CARD_H + 4)), 0);
  const tracksH = trackRows.length ? 32 + (tracksCollapsed ? 0 : tracksCapH) : 0;
  const pageH = Math.max(vh, (HEAD_H + eventLanes * EV_H + tallest + tracksH + 40) * tz);

  useBoxSelect(ref);

  return (
    <div className={cls('timeline', mobile && 'snap')} ref={ref} onScroll={onScroll} style={{ '--tlz': tz } as React.CSSProperties}>
      <div className="tl-track" style={{ width: TOTAL * colW, height: pageH }}>
        {snapPoints}
        {colData.map(({ date, regular, tracks, events }) => (
          <DayColumn
            key={date}
            date={date}
            today={today}
            items={regular}
            events={events}
            eventLanes={eventLanes}
            tracks={tracks}
            trackRows={trackRows}
            collapsed={tracksCollapsed}
            capH={tracksCapH}
            hiddenRows={Math.max(0, totalCards - MAX_TRACK_CARDS)}
            tz={tz}
            onMeasure={report}
            projects={idx.projects}
            left={diffDays(origin, date) * colW}
            width={colW}
            dropIndex={drop?.date === date ? drop.index : -1}
            setDrop={setDrop}
            onHeaderWheel={onHeaderWheel}
          />
        ))}
      </div>
    </div>
  );
}

const HEAD_H = 38;
const EV_H = 26;

/** All-day events pinned above the day's tasks; a multi-day one keeps its lane so it reads as a bar. */
function EventBand({ events, lanes }: { events: DayEvent[]; lanes: number }) {
  const sel = useStore((s) => s.ui.selectedId);
  return (
    <div className="day-events" style={{ height: lanes * EV_H }}>
      {events.map((ev) => {
        const t = ev.task;
        const item: DayItem = t.recurrence ? { kind: 'occ', key: ev.key, task: t, date: ev.date } : { kind: 'task', key: t.id, task: t };
        return (
          <div
            key={ev.key}
            data-card
            className={cls('ev', ev.n === 1 && 'ev-start', ev.n === ev.total && 'ev-end', sel === t.id && 'selected', `lvl-${t.importance}`)}
            style={{ top: ev.lane * EV_H }}
            title={ev.total > 1 ? `${t.title} — day ${ev.n} of ${ev.total}` : t.title}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify(t.recurrence ? { kind: 'occ', id: t.id, date: ev.date } : { kind: 'task', id: t.id, offset: ev.n - 1 }));
              e.dataTransfer.effectAllowed = 'move';
            }}
            onClick={() => S().setUI({ selectedId: t.id, occDate: t.recurrence ? ev.date : undefined, multi: undefined })}
            onContextMenu={(e) => {
              e.preventDefault();
              S().setUI({ menu: { x: e.clientX, y: e.clientY, item } });
            }}
          >
            <span className="ev-title">{t.title}</span>
            {ev.total > 1 && <span className="ev-n">{ev.n}/{ev.total}</span>}
          </div>
        );
      })}
    </div>
  );
}
const MAX_TRACK_CARDS = 3;

// Every day has its own copy of the strip; keep them scrolled to the same row so they stay aligned.
let trackScrollTop = 0;
let syncing = false;
function onTrackScroll(e: React.UIEvent<HTMLDivElement>) {
  if (syncing) return;
  trackScrollTop = e.currentTarget.scrollTop;
  syncing = true;
  document.querySelectorAll<HTMLDivElement>('.tracks-scroll').forEach((el) => {
    if (el !== e.currentTarget) el.scrollTop = trackScrollTop;
  });
  requestAnimationFrame(() => (syncing = false));
}
/** New columns scrolling into view start at the shared position. */
function syncTrackScroll(el: HTMLDivElement | null) {
  if (el && el.scrollTop !== trackScrollTop) el.scrollTop = trackScrollTop;
}
const TRACK_CARD_H = 44;

/** Which aligned row an item belongs to, or null for the normal sorted list. */
function trackKey(it: DayItem, series: Task[]): string | null {
  if (it.kind === 'follow' || it.task.time) return null;
  if (it.task.projectId) return `p:${it.task.projectId}`;
  if (it.kind === 'occ' && it.task.numbering) return `s:${it.task.id}`;
  if (it.task.seriesId && series.find((x) => x.id === it.task.seriesId)?.numbering) return `s:${it.task.seriesId}`;
  return null;
}

interface ColProps {
  date: ISODate;
  today: ISODate;
  items: DayItem[];
  events: DayEvent[];
  eventLanes: number;
  tracks: Map<string, DayItem[]>;
  trackRows: { key: string; h: number }[];
  collapsed: boolean;
  capH: number;
  hiddenRows: number;
  tz: number;
  onMeasure: (date: ISODate, h: number) => void;
  projects: Record<string, Project>;
  left: number;
  width: number;
  dropIndex: number;
  setDrop: (d: Drop) => void;
  onHeaderWheel: (e: React.WheelEvent) => void;
}

const DayColumn = memo(function DayColumn({ date, today, items, events, eventLanes, tracks, trackRows, collapsed, capH, hiddenRows, tz, onMeasure, projects, left, width, dropIndex, setDrop, onHeaderWheel }: ColProps) {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = listRef.current!;
    const measure = () => onMeasure(date, el.getBoundingClientRect().height / tz);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [date, tz, onMeasure]);
  const [adding, setAdding] = useState(false);
  const busyBeforeClick = useRef(false);
  const d = fromISO(date);
  const wd = weekday(date);
  const isToday = date === today;
  const allItems = [...items, ...[...tracks.values()].flat()];
  const open = allItems.filter((i) => i.kind !== 'follow' && (i.kind === 'occ' ? !i.state : i.task.status !== 'done' && i.task.status !== 'dropped')).length;

  const indexAt = (y: number) => {
    const cards = listRef.current?.querySelectorAll('[data-card]') ?? [];
    for (let k = 0; k < cards.length; k++) {
      const r = cards[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return cards.length;
  };

  return (
    <section
      onMouseDownCapture={() => (busyBeforeClick.current = !!S().ui.selectedId || !!S().ui.multi?.length || adding)}
      onClick={(e) => {
        // empty space only — not cards, buttons, inputs, the header or the projects strip
        if (busyBeforeClick.current) return; // first click just closes the open task / selection
        if (e.target instanceof Element && e.target.closest('[data-card], button, input, textarea, select, .day-head, .tracks-dock, .menu')) return;
        setAdding(true);
      }}
      className={cls('day', isToday && 'today', date < today && 'past', (wd === 0 || wd === 6) && 'weekend', d.getDate() === 1 && 'month-start')}
      style={{ left, width }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        setDrop({ date, index: indexAt(e.clientY) });
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDrop(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(null);
        const raw = e.dataTransfer.getData(DRAG_MIME);
        if (raw) handleDrop(JSON.parse(raw), date, indexAt(e.clientY), items);
      }}
    >
      <header className="day-head" onWheel={onHeaderWheel} onDoubleClick={() => setAdding(true)}>
        <div className="day-title">
          <span className="dow">{isToday ? 'Today' : WD[wd]}</span>
          <span className="dnum">{d.getDate() === 1 ? `${MONTHS[d.getMonth()]} 1` : `${d.getMonth() + 1}/${d.getDate()}`}</span>
          {(d.getDate() === 1 || d.getFullYear() !== fromISO(today).getFullYear()) && <span className="dyear">{d.getFullYear()}</span>}
          {open > 0 && <span className="count">{open}</span>}
        </div>
        <div className="day-actions">
          <SortToggle />
          <button className="icon-btn" title="Add" onClick={() => setAdding(true)}>
            <Plus size={14} />
          </button>
        </div>
      </header>
      <div className="day-body">
      {eventLanes > 0 && <EventBand events={events} lanes={eventLanes} />}
      <div className="day-list" ref={listRef}>
        {items.map((it, i) => (
          <div key={it.key} className={cls('slot', dropIndex === i && 'drop-before')}>
            <ItemCard item={it} today={today} project={it.kind !== 'follow' && it.task.projectId ? projects[it.task.projectId] : undefined} />
          </div>
        ))}
        <div className={cls('slot-end', dropIndex === items.length && 'drop-before')} />
        {adding ? <ColumnAdd date={date} onDone={() => setAdding(false)} /> : (
          <button className="add-row" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add
          </button>
        )}
      </div>
      </div>
      {trackRows.length > 0 && (
        <div className={cls('tracks-dock', collapsed && 'collapsed')}>
          <button className="tracks-label" onClick={() => S().setSettings({ tracksCollapsed: !collapsed })} title={collapsed ? 'Show projects & series' : 'Hide to see more of each day'}>
            {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Projects &amp; series
            {collapsed && <span className="tracks-count">{[...tracks.values()].flat().length || ''}</span>}
            {!collapsed && hiddenRows > 0 && <span className="tracks-more" title="Scroll this strip to see the rest">+{hiddenRows} ↓</span>}
          </button>
          {!collapsed && (
            <div className={cls('tracks-scroll', hiddenRows > 0 && 'has-more')} style={{ maxHeight: capH }} ref={syncTrackScroll} onScroll={onTrackScroll}>
              {trackRows.map((row) => (
                <div key={row.key} className="track-row" style={{ height: row.h }}>
                  {(tracks.get(row.key) ?? []).map((it) => (
                    <ItemCard key={it.key} item={it} today={today} project={it.kind !== 'follow' && it.task.projectId ? projects[it.task.projectId] : undefined} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
});

function ColumnAdd({ date, onDone }: { date: ISODate; onDone: () => void }) {
  const [v, setV] = useState('');
  return (
    <input
      className="col-input"
      autoFocus
      value={v}
      placeholder="Task… (9am, every week, ?)"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim()) capture(v, { date });
        onDone();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          if (v.trim()) capture(v, { date });
          setV('');
        }
        if (e.key === 'Escape') onDone();
      }}
    />
  );
}

function orderOf(it?: DayItem) {
  return it && it.kind !== 'follow' ? it.task.order : undefined;
}

function handleDrop(p: DragPayload, date: ISODate, index: number, items: DayItem[]) {
  if (p.kind === 'follow') {
    trackerUpdate(p.projectId, (es) => es.map((x) => (x.id === p.entryId ? { ...x, followUp: date } : x)), 'Moved follow-up');
    return;
  }
  if (p.kind === 'many') {
    moveMany(p.keys, date);
    return;
  }
  if (p.kind === 'occ') {
    const s = getTask(p.id);
    if (s && p.date !== date) moveOccurrence(s, p.date, date);
    return;
  }
  const t = getTask(p.id);
  if (!t) return;
  if (t.allDay) {
    // grabbed on day n of a span: keep that day under the cursor
    const start = addDays(date, -(p.offset ?? 0));
    if (start !== t.date) schedule(t.id, start);
    return;
  }
  const others = items.filter((i) => !(i.kind === 'task' && i.task.id === t.id));
  const draggedIdx = items.findIndex((i) => i.kind === 'task' && i.task.id === t.id);
  const at = draggedIdx >= 0 && draggedIdx < index ? index - 1 : index;
  const prev = orderOf(others[at - 1]);
  const next = orderOf(others[at]);
  const order = prev !== undefined && next !== undefined ? (prev + next) / 2 : prev !== undefined ? prev + 1 : next !== undefined ? next - 1 : Date.now();
  if (t.date === date && t.order === order) return;
  const mode = S().settings.daySort ?? 'time';
  if (t.date === date && mode !== 'manual' && !(mode === 'time' && !t.time)) {
    S().toast('This day is sorted automatically — click the sort icon until “My order” to arrange by hand.', undefined, 4500);
  }
  if (t.recurrence) {
    S().toast('That’s a repeating task — drag a single day’s copy, or edit the repeat rule.');
    return;
  }
  schedule(t.id, date, order);
  if (t.projectId && !t.date) S().toast(`Scheduled “${t.title}” from ${getProject(t.projectId)?.title ?? 'project'}`);
}
