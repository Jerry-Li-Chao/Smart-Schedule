import { useMemo, useRef, useState } from 'react';
import { ChevronsLeft, GitBranch, Sparkles, StickyNote, X } from 'lucide-react';
import type { ISODate, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, nextMonday, weekendOf } from '../lib/date';
import { cls } from '../lib/id';
import { capture, deleteEntity, getTask, isInbox, promoteToProject, schedule, updateTask, toggleMulti, unscheduleMany } from '../actions';
import { DRAG_MIME, InlineRename, startDrag } from './ItemCard';
import { useBoxSelect } from '../lib/boxSelect';
import { DateButton, isSubmitKey } from './ui';

function age(ms: number) {
  const h = (Date.now() - ms) / 3600000;
  if (h < 1) return 'now';
  if (h < 24) return `${Math.floor(h)}h`;
  return `${Math.floor(h / 24)}d`;
}

/** `collapsible`: the Days view can fold it into a thin strip on the left. */
export function StickyInbox({ today, collapsible }: { today: ISODate; collapsible?: boolean }) {
  const collapsed = useStore((s) => !!collapsible && !!s.settings.stickyCollapsed);
  const entities = useStore((s) => s.entities);
  const inbox = useMemo(
    () =>
      Object.values(entities)
        .filter((e): e is Task => e.type === 'task' && isInbox(e))
        .sort((a, b) => a.createdAt - b.createdAt),
    [entities],
  );
  const [v, setV] = useState('');
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useBoxSelect(ref);

  const submit = () => {
    if (!v.trim()) return;
    capture(v);
    setV('');
  };

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const p = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '{}');
      if (p.kind !== 'task') {
        if (p.kind === 'many') unscheduleMany(p.keys);
        else if (p.kind) S().toast(p.kind === 'occ' ? 'One day of a repeating task can’t go back on the sticky — delete or move it instead.' : 'Follow-ups live in their project.');
        return;
      }
      const t = getTask(p.id);
      if (!t || t.date === null) return;
      if (t.recurrence) return S().toast('Repeating tasks stay on the calendar.');
      updateTask(t.id, { date: null }, `Put “${t.title}” back on the sticky`);
      S().toast(t.projectId ? `Unscheduled “${t.title}” — it’s waiting in its project` : `“${t.title}” is back on the sticky`, [{ label: 'Undo', run: () => S().undo() }]);
    },
  };
  const setCollapsed = (c: boolean) => S().setSettings({ stickyCollapsed: c });

  if (collapsed)
    return (
      <aside className={cls('sticky-rail', over && 'drop-over')} {...drop} onClick={() => setCollapsed(false)} title="Show the sticky">
        <StickyNote size={15} />
        {inbox.length > 0 && <span className="count">{inbox.length}</span>}
        <span className="sr-label">Sticky</span>
      </aside>
    );

  return (
    <aside ref={ref} className={cls('sticky', over && 'drop-over')} {...drop}>
      {over && <div className="drop-hint">Drop to unschedule — back on the sticky</div>}
      <div className="sticky-head">
        <StickyNote size={15} />
        <span>Sticky</span>
        {inbox.length > 0 && <span className="count">{inbox.length}</span>}
        <span className="spacer" />
        {inbox.length > 0 && (
          <button className="btn tiny plan-btn" onClick={() => S().setUI({ planOpen: true })}>
            <Sparkles size={12} /> Plan them
          </button>
        )}
        {collapsible && (
          <button className="icon-btn" title="Fold the sticky away (you can still drop tasks on it)" onClick={() => setCollapsed(true)}>
            <ChevronsLeft size={15} />
          </button>
        )}
      </div>
      <textarea
        className="sticky-input"
        rows={2}
        value={v}
        placeholder={'Jot anything…\nEnter saves · Shift+Enter new line'}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e)) {
            e.preventDefault();
            submit();
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text');
          if (text.includes('\n') && !v.trim()) {
            e.preventDefault();
            capture(text);
          }
        }}
      />
      <div className="sticky-hint">
        Dates like <b>tmr 9am</b>, <b>fri</b>, <b>in 6 months</b>, <b>every month</b>, <b>明天</b> schedule it right away. Put a <b>?</b> in it to get an AI suggestion.
        Anything else stays here until you plan it.
      </div>
      <ul className="sticky-list">
        {inbox.map((t) => (
          <StickyItem key={t.id} t={t} today={today} />
        ))}
        {!inbox.length && <li className="sticky-empty">All planned. Nice.</li>}
      </ul>
    </aside>
  );
}

function StickyItem({ t, today }: { t: Task; today: ISODate }) {
  const selected = useStore((s) => s.ui.selectedId === t.id);
  const inMulti = useStore((s) => !!s.ui.multi?.includes(t.id));
  const [editing, setEditing] = useState(false);
  const old = Date.now() - t.createdAt > 86400000;
  const go = (d: ISODate) => schedule(t.id, d);
  return (
    <li
      className={cls('sticky-item', selected && 'selected', inMulti && 'multi', old && 'aging')}
      data-card
      data-key={t.id}
      draggable={!editing}
      onDragStart={(e) => startDrag(e, { kind: 'task', id: t.id })}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return toggleMulti(t.id);
        S().setUI({ selectedId: t.id, occDate: undefined, multi: undefined });
      }}
    >
      <div className="si-text">
        <span className={cls('si-dot', `lvl-${t.importance}`)} />
        {editing ? (
          <InlineRename t={t} onDone={() => setEditing(false)} />
        ) : (
          <span className="si-title" title="Double-click to rename" onDoubleClick={(e) => (e.stopPropagation(), setEditing(true))}>
            {t.title}
          </span>
        )}
        {t.notes && <span className="si-notes">+{t.notes.split('\n').length}</span>}
        <span className="si-age" title="Time on the sticky">{age(t.createdAt)}</span>
      </div>
      <div className="si-actions" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => go(today)}>Today</button>
        <button onClick={() => go(addDays(today, 1))}>Tmr</button>
        <button onClick={() => go(weekendOf(today))}>Wknd</button>
        <button onClick={() => go(nextMonday(today))}>Next wk</button>
        <DateButton onPick={go} />
        <span className="spacer" />
        <button className="icon-btn" title="Bigger than a task — make it a project with steps" onClick={() => promoteToProject(t.id)}>
          <GitBranch size={13} />
        </button>
        <button className="icon-btn" title="Delete" onClick={() => deleteEntity(t.id)}>
          <X size={13} />
        </button>
      </div>
    </li>
  );
}
