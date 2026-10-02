import { memo, useEffect, useRef, useState } from 'react';
import { AlarmClock, ArrowUpRight, Check, CornerDownRight, Hourglass, Play, Repeat, Sparkles, StickyNote, UserRound } from 'lucide-react';
import type { DayItem, ISODate, Project, Status, Task } from '../types';
import { useStore, S } from '../store';
import { carriedDays, effectiveLevel, IMPORTANCE_HELP } from '../lib/priority';
import { addDays, fmtMD, fmtTime, nextMonday, todayISO } from '../lib/date';
import { cls } from '../lib/id';
import { numberedTitle } from '../lib/recurrence';
import { itemKey, toggleMulti, cycleImportance, duplicateTask, requestDelete, schedule, setItemStatus, trackerUpdate, updateTask, moveOccurrence } from '../actions';

export const DRAG_MIME = 'text/x-planner';
export type DragPayload =
  | { kind: 'task'; id: string }
  | { kind: 'occ'; id: string; date: ISODate }
  | { kind: 'follow'; projectId: string; entryId: string };

export function itemStatus(item: DayItem): Status {
  if (item.kind === 'occ') return item.state ?? 'open';
  if (item.kind === 'task') return item.task.status;
  return item.entry.outcome === 'pending' ? 'open' : 'done';
}

function startDrag(e: React.DragEvent, p: DragPayload) {
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(p));
  e.dataTransfer.effectAllowed = 'move';
}

export const ItemCard = memo(function ItemCard({ item, today, project }: { item: DayItem; today: ISODate; project?: Project }) {
  const inMulti = useStore((s) => !!s.ui.multi?.includes(itemKey(item)));
  const selected = useStore((s) => s.ui.selectedId === (item.kind === 'follow' ? undefined : item.task.id) && (item.kind !== 'occ' || s.ui.occDate === item.date));

  if (item.kind === 'follow') {
    const { project: p, entry } = item;
    return (
      <div
        className="card follow"
        data-card
        draggable
        onDragStart={(e) => startDrag(e, { kind: 'follow', projectId: p.id, entryId: entry.id })}
        onClick={() => S().setUI({ view: 'projects', projectId: p.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          S().setUI({ menu: { x: e.clientX, y: e.clientY, item } });
        }}
      >
        <UserRound size={14} className="card-icon" />
        <div className="card-body">
          <div className="card-title">Follow up: {entry.name}</div>
          <div className="card-meta">
            <span className="chip" style={{ '--c': p.color } as React.CSSProperties}>{p.title}</span>
          </div>
        </div>
      </div>
    );
  }

  const t = item.task;
  const [editing, setEditing] = useState(false);
  const status = itemStatus(item);
  const closed = status === 'done' || status === 'dropped';
  const { level, reason } = effectiveLevel(item.kind === 'occ' ? { ...t, status } : t, today);
  const carried = item.kind === 'task' && !closed ? carriedDays(t) : 0;
  const missed = item.kind === 'task' && !!t.time && !!t.date && t.date < today && !closed;

  return (
    <div
      className={cls('card', `lvl-${level}`, `st-${status}`, selected && 'selected', inMulti && 'multi', missed && 'missed')}
      data-card
      draggable={!editing}
      onDragStart={(e) => startDrag(e, item.kind === 'occ' ? { kind: 'occ', id: t.id, date: item.date } : { kind: 'task', id: t.id })}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return toggleMulti(itemKey(item));
        S().setUI({ selectedId: t.id, occDate: item.kind === 'occ' ? item.date : undefined, multi: undefined });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        S().setUI({ menu: { x: e.clientX, y: e.clientY, item } });
      }}
    >
      <button
        className="check"
        title={closed ? 'Reopen' : 'Done'}
        onClick={(e) => {
          e.stopPropagation();
          setItemStatus(item, closed ? 'open' : 'done');
        }}
      >
        {status === 'done' && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="card-body">
        {editing ? (
          <InlineRename t={t} onDone={() => setEditing(false)} />
        ) : (
          <div
            className="card-title"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
          >
            {t.time && <span className="time">{fmtTime(t.time)}</span>}
            {(item.kind === 'occ' ? numberedTitle(t, item.date) : t.title) || <em className="muted">Untitled</em>}
          </div>
        )}
        <Meta t={t} item={item} project={project} carried={carried} reason={reason} missed={missed} status={status} />
      </div>
      <PriorityStrip t={t} repeating={item.kind === 'occ'} reason={reason} />
    </div>
  );
});

const BAR_COUNT = { could: 1, should: 2, must: 3 } as const;
const NEXT = { could: 'should', should: 'must', must: 'could' } as const;

/** Right edge of a card: signal-style bars; click cycles could → should → must. */
function PriorityStrip({ t, repeating, reason }: { t: Task; repeating: boolean; reason?: string }) {
  const n = BAR_COUNT[t.importance];
  const tip =
    `Priority: ${IMPORTANCE_HELP[t.importance].label} — ${IMPORTANCE_HELP[t.importance].hint}.\n` +
    `Click to make it ${IMPORTANCE_HELP[NEXT[t.importance]].label}${repeating ? ' (applies to every repeat)' : ''}.` +
    (reason ? `\nShowing red/yellow because it's ${reason}.` : '');
  return (
    <button
      className={cls('prio', `p-${t.importance}`)}
      title={tip}
      aria-label={`Priority ${t.importance}, click to change`}
      onClick={(e) => {
        e.stopPropagation();
        cycleImportance(t);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
    >
      <span className="bars" key={t.importance}>
        {[1, 2, 3].map((i) => (
          <i key={i} className={cls(i <= n && 'on')} />
        ))}
      </span>
      <span className="prio-lbl">{IMPORTANCE_HELP[t.importance].label}</span>
    </button>
  );
}

function Meta({ t, item, project, carried, reason, missed, status }: { t: Task; item: DayItem; project?: Project; carried: number; reason?: string; missed: boolean; status: Status }) {
  const bits: React.ReactNode[] = [];
  if (status === 'doing') bits.push(<span key="d" className="pill doing"><Play size={10} /> doing</span>);
  if (status === 'waiting') bits.push(<span key="w" className="pill waiting"><Hourglass size={10} /> waiting</span>);
  if (missed) bits.push(<span key="m" className="pill warn">missed?</span>);
  if (carried > 0)
    bits.push(
      <span key="c" className={cls('pill', carried >= 3 ? 'stale' : 'carry')} title={`First planned for ${fmtMD(t.firstScheduled!)} — pushed back ${carried} day${carried > 1 ? 's' : ''} since`}>
        pushed {carried}d
      </span>,
    );
  if (reason) bits.push(<span key="r" className="pill urgent"><ArrowUpRight size={10} /> {reason}</span>);
  else if (t.deadline && status !== 'done') bits.push(<span key="dl" className="pill">due {fmtMD(t.deadline)}</span>);
  if (item.kind === 'occ') bits.push(<Repeat key="rp" size={11} className="muted" />);
  if (t.seriesId) bits.push(<CornerDownRight key="sr" size={11} className="muted" />);
  if (t.remindAt && !t.remindFired && status !== 'done') bits.push(<AlarmClock key="al" size={11} className="muted" />);
  if (t.ai)
    bits.push(
      <span key="ai" className={cls('ai-mark', `ai-${t.ai.status}`)} title={t.ai.status === 'queued' ? 'Waiting in the AI queue' : t.ai.status === 'pending' ? 'Asking your local AI…' : t.ai.status === 'error' ? `AI failed: ${t.ai.answer}` : 'AI answer — open the task to read it'}>
        <Sparkles size={11} />
        {t.ai.status === 'pending' && 'thinking…'}
        {t.ai.status === 'queued' && 'in line'}
      </span>,
    );
  if (t.notes) bits.push(<StickyNote key="n" size={11} className="muted" />);
  if (project) bits.push(<span key="p" className="chip" style={{ '--c': project.color } as React.CSSProperties}>{project.title}</span>);
  return bits.length ? <div className="card-meta">{bits}</div> : null;
}

// ---------- right-click menu ----------
export function ContextMenu() {
  const menu = useStore((s) => s.ui.menu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      S().setUI({ menu: undefined });
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && S().setUI({ menu: undefined });
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  if (!menu) return null;
  const { item } = menu;
  const todayIso = todayISO();
  const run = (fn: () => void) => () => {
    S().setUI({ menu: undefined });
    fn();
  };
  const entries: ([string, () => void] | '-')[] = [];

  if (item.kind === 'follow') {
    const set = (outcome: 'yes' | 'no' | 'silent') =>
      trackerUpdate(item.project.id, (es) => es.map((x) => (x.id === item.entry.id ? { ...x, outcome } : x)), `${item.entry.name}: ${outcome}`);
    entries.push(['They said yes', () => set('yes')], ['They said no', () => set('no')], ['No response', () => set('silent')], '-');
    entries.push(['Follow up tomorrow', () => trackerUpdate(item.project.id, (es) => es.map((x) => (x.id === item.entry.id ? { ...x, followUp: addDays(todayIso, 1) } : x)), `Follow-up moved`)]);
    entries.push(['Open project', () => S().setUI({ view: 'projects', projectId: item.project.id })]);
  } else {
    const t = item.task;
    const status = itemStatus(item);
    entries.push([status === 'done' ? 'Mark not done' : 'Done', () => setItemStatus(item, status === 'done' ? 'open' : 'done')]);
    entries.push([status === 'dropped' ? 'Not obsolete' : 'Obsolete (no longer needed)', () => setItemStatus(item, status === 'dropped' ? 'open' : 'dropped')]);
    if (item.kind === 'task') {
      entries.push(['Doing', () => setItemStatus(item, 'doing')], ['Waiting on someone', () => setItemStatus(item, 'waiting')], '-');
      entries.push(['Must', () => updateTask(t.id, { importance: 'must' })], ['Should', () => updateTask(t.id, { importance: 'should' })], ['Could', () => updateTask(t.id, { importance: 'could' })], '-');
      entries.push(['Move to tomorrow', () => schedule(t.id, addDays(t.date && t.date > todayIso ? t.date : todayIso, 1))]);
      entries.push(['Move to next week', () => schedule(t.id, nextMonday(todayIso))]);
      entries.push(['Back to sticky (unschedule)', () => schedule(t.id, null)], '-');
      entries.push(['Duplicate', () => duplicateTask(t.id)], ['Delete', () => requestDelete(t.id)]);
    } else {
      entries.push('-');
      entries.push(['Move this one to tomorrow', () => moveOccurrence(t, item.date, addDays(item.date, 1))]);
      entries.push(['Edit repeating task', () => S().setUI({ selectedId: t.id, occDate: item.date })]);
      entries.push('-', ['Delete…', () => requestDelete(t.id, item.date)]);
    }
  }
  const x = Math.min(menu.x, window.innerWidth - 230);
  const y = Math.min(menu.y, window.innerHeight - entries.length * 30 - 16);
  return (
    <div className="menu" ref={ref} style={{ left: x, top: Math.max(8, y) }}>
      {entries.map((e, i) =>
        e === '-' ? <div key={i} className="menu-sep" /> : <button key={i} onClick={run(e[1])}>{e[0]}</button>,
      )}
    </div>
  );
}

/** Rename in place: Enter saves, Esc cancels, clicking away saves. */
export function InlineRename({ t, onDone }: { t: Task; onDone: () => void }) {
  const [v, setV] = useState(t.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    el.select();
  }, []);
  const save = () => {
    const title = v.trim();
    if (title && title !== t.title) updateTask(t.id, { title }, `Renamed “${t.title}” → “${title}”`);
    onDone();
  };
  return (
    <textarea
      ref={ref}
      className="inline-rename"
      value={v}
      rows={Math.min(4, Math.max(1, Math.ceil(v.length / 26)))}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          save();
        }
        if (e.key === 'Escape') onDone();
      }}
    />
  );
}
