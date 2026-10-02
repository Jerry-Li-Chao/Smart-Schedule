import { useMemo, useState } from 'react';
import { Check, GitBranch, Plus, Trash2, Users, CornerDownRight } from 'lucide-react';
import type { ISODate, Outcome, Project, Status, Task, TrackerEntry } from '../types';
import { S, useStore } from '../store';
import { addDays, fmtDay, fmtMD, relDay } from '../lib/date';
import { cls, uid } from '../lib/id';
import { isClosed } from '../lib/priority';
import { addProject, addStep, deleteEntity, PROJECT_COLORS, schedule, trackerUpdate, updateProject, updateTask } from '../actions';
import { BlurInput, DateButton, Empty, isSubmitKey } from './ui';

export function ProjectsView({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const selected = useStore((s) => s.ui.projectId);
  const list = useMemo(
    () => Object.values(entities).filter((e): e is Project => e.type === 'project' && !e.deleted).sort((a, b) => a.order - b.order),
    [entities],
  );
  const steps = useMemo(() => Object.values(entities).filter((e): e is Task => e.type === 'task' && !e.deleted && !!e.projectId), [entities]);
  const current = list.find((p) => p.id === selected) ?? list[0];
  const [name, setName] = useState('');

  return (
    <div className="projects">
      <nav className="proj-list">
        <div className="proj-new">
          <input
            value={name}
            placeholder="New project / goal…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (isSubmitKey(e) && name.trim()) {
                const p = addProject(name.trim(), ['First step']);
                S().setUI({ projectId: p.id });
                setName('');
              }
            }}
          />
        </div>
        {list.map((p) => {
          const mine = steps.filter((s) => s.projectId === p.id);
          const doneN = mine.filter((s) => s.status === 'done').length;
          const ready = mine.filter((s) => isReady(s, steps) && !s.date).length;
          return (
            <button key={p.id} className={cls('proj-item', current?.id === p.id && 'on', p.status !== 'active' && 'dim')} onClick={() => S().setUI({ projectId: p.id })}>
              <span className="dot" style={{ background: p.color }} />
              <span className="proj-name">{p.title}</span>
              {ready > 0 && <span className="pill warn" title="Steps that are ready but have no day">{ready}</span>}
              <span className="tiny muted">{doneN}/{mine.length}</span>
            </button>
          );
        })}
        {!list.length && <Empty>Long-horizon things live here: applications, visa steps, job hunts, anything with milestones.</Empty>}
      </nav>
      {current ? <ProjectDetail key={current.id} p={current} steps={steps.filter((s) => s.projectId === current.id)} today={today} /> : <div className="proj-detail" />}
    </div>
  );
}

/** A step is ready when everything before it is finished. */
function isReady(s: Task, all: Task[]) {
  if (isClosed(s)) return false;
  if (!s.parentId) return true;
  const parent = all.find((x) => x.id === s.parentId);
  return !parent || parent.status === 'done';
}

function ProjectDetail({ p, steps, today }: { p: Project; steps: Task[]; today: ISODate }) {
  const [title, setTitle] = useState(p.title);
  const [notes, setNotes] = useState(p.notes ?? '');
  const total = steps.length;
  const doneN = steps.filter((s) => s.status === 'done').length;
  return (
    <div className="proj-detail">
      <div className="proj-head">
        <input className="proj-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== p.title && updateProject(p.id, { title: title.trim() })} />
        <div className="swatches">
          {PROJECT_COLORS.map((c) => (
            <button key={c} className={cls('swatch', c === p.color && 'on')} style={{ background: c }} onClick={() => updateProject(p.id, { color: c })} />
          ))}
        </div>
        <select value={p.status} onChange={(e) => updateProject(p.id, { status: e.target.value as Project['status'] })}>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="done">Finished</option>
        </select>
        <button className="icon-btn" title="Delete project" onClick={() => deleteEntity(p.id)}>
          <Trash2 size={15} />
        </button>
      </div>
      <div className="progress">
        <div style={{ width: `${total ? (doneN / total) * 100 : 0}%`, background: p.color }} />
      </div>
      <textarea className="proj-notes" placeholder="Why this matters, links, context…" value={notes} rows={2} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (p.notes ?? '') && updateProject(p.id, { notes })} />

      <div className="section-title">
        <GitBranch size={14} /> Milestones
        <span className="muted small">— each step unlocks the next. Give the ready ones a day so they actually happen.</span>
      </div>
      <FlowCanvas p={p} steps={steps} today={today} />

      <Tracker p={p} today={today} />
    </div>
  );
}

// ---------- flowchart ----------
const NW = 224;
const NH = 74;
const GX = 64;
const GY = 18;

function layout(steps: Task[]) {
  const ids = new Set(steps.map((s) => s.id));
  const kids = new Map<string | null, Task[]>();
  for (const s of steps) {
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), s]);
  }
  for (const l of kids.values()) l.sort((a, b) => a.order - b.order);
  const pos = new Map<string, { x: number; y: number }>();
  const seen = new Set<string>();
  let row = 0;
  let maxDepth = 0;
  const place = (n: Task, depth: number): number => {
    if (seen.has(n.id)) return pos.get(n.id)?.y ?? row;
    seen.add(n.id);
    maxDepth = Math.max(maxDepth, depth);
    const ch = kids.get(n.id) ?? [];
    let y: number;
    if (!ch.length) y = row++;
    else {
      const ys = ch.map((c) => place(c, depth + 1));
      y = (ys[0] + ys[ys.length - 1]) / 2;
    }
    pos.set(n.id, { x: depth, y });
    return y;
  };
  for (const r of kids.get(null) ?? []) place(r, 0);
  return { pos, rows: Math.max(row, 1), cols: maxDepth + 1 };
}

const STATE_LABEL: Record<Status, string> = { open: 'To do', doing: 'Doing', waiting: 'Waiting', done: 'Done', dropped: 'Dropped' };

function FlowCanvas({ p, steps, today }: { p: Project; steps: Task[]; today: ISODate }) {
  const [editing, setEditing] = useState<string | null>(null);
  const selectedId = useStore((s) => s.ui.selectedId);
  const { pos, rows, cols } = useMemo(() => layout(steps), [steps]);
  const W = cols * (NW + GX) + 40;
  const H = rows * (NH + GY) + 20;
  const at = (id: string) => {
    const q = pos.get(id)!;
    return { x: 10 + q.x * (NW + GX), y: 10 + q.y * (NH + GY) };
  };
  const add = (parentId: string | null) => setEditing(addStep(p.id, parentId).id);

  return (
    <div className="flow-wrap">
      <div className="flow" style={{ width: W, height: H }}>
        <svg width={W} height={H} className="flow-edges">
          {steps.map((s) => {
            if (!s.parentId || !pos.has(s.parentId) || !pos.has(s.id)) return null;
            const a = at(s.parentId);
            const b = at(s.id);
            const x1 = a.x + NW;
            const y1 = a.y + NH / 2;
            const x2 = b.x;
            const y2 = b.y + NH / 2;
            const mx = (x1 + x2) / 2;
            const parentDone = steps.find((x) => x.id === s.parentId)?.status === 'done';
            return <path key={s.id} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={cls('edge', parentDone && 'lit')} style={parentDone ? { stroke: p.color } : undefined} />;
          })}
        </svg>
        {steps.map((s) => {
          if (!pos.has(s.id)) return null;
          const { x, y } = at(s.id);
          const ready = isReady(s, steps);
          const needsDay = ready && !s.date && !isClosed(s);
          return (
            <div
              key={s.id}
              className={cls('node', `st-${s.status}`, ready && 'ready', needsDay && 'needs-day', selectedId === s.id && 'selected')}
              style={{ left: x, top: y, width: NW, height: NH, '--c': p.color } as React.CSSProperties}
              onClick={() => editing !== s.id && S().setUI({ selectedId: s.id, occDate: undefined })}
            >
              <div className="node-top">
                <button
                  className="check"
                  title={s.status === 'done' ? 'Reopen' : 'Done'}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateTask(s.id, { status: s.status === 'done' ? 'open' : 'done' });
                  }}
                >
                  {s.status === 'done' && <Check size={11} strokeWidth={3} />}
                </button>
                {editing === s.id ? (
                  <NodeTitleInput s={s} onDone={() => setEditing(null)} />
                ) : (
                  <span className="node-title" onDoubleClick={(e) => (e.stopPropagation(), setEditing(s.id))}>{s.title || <em className="muted">Untitled</em>}</span>
                )}
              </div>
              <div className="node-bottom" onClick={(e) => e.stopPropagation()}>
                {s.date ? (
                  <span className={cls('tiny', s.date < today && !isClosed(s) ? 'stale-text' : 'muted')}>{fmtDay(s.date, today)} · {relDay(s.date, today)}</span>
                ) : needsDay ? (
                  <span className="node-sched">
                    <span className="tiny warn-text" title="Everything before this is done — give it a day so it actually happens">Needs a day</span>
                    <button className="btn tiny" onClick={() => schedule(s.id, today)}>Today</button>
                    <button className="btn tiny" onClick={() => schedule(s.id, addDays(today, 1))}>Tmr</button>
                    <DateButton onPick={(d) => schedule(s.id, d)} />
                  </span>
                ) : (
                  <span className="tiny muted">{s.status === 'open' ? (ready ? 'Not scheduled' : 'Locked until previous is done') : STATE_LABEL[s.status]}</span>
                )}
                <span className="node-tools">
                  <button className="icon-btn" title="Add next step after this" onClick={() => add(s.id)}>
                    <Plus size={13} />
                  </button>
                  <button className="icon-btn" title="Add a parallel branch (same predecessor)" onClick={() => add(s.parentId ?? null)}>
                    <CornerDownRight size={13} />
                  </button>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn tiny ghost add-root" onClick={() => add(null)}>
        <Plus size={13} /> Add a starting step
      </button>
    </div>
  );
}

function NodeTitleInput({ s, onDone }: { s: Task; onDone: () => void }) {
  const [v, setV] = useState(s.title);
  const finish = () => {
    if (v.trim()) {
      if (v.trim() !== s.title) updateTask(s.id, { title: v.trim() }, `Named step “${v.trim()}”`);
    } else if (!s.title) deleteEntity(s.id);
    onDone();
  };
  return (
    <input
      className="node-input"
      autoFocus
      value={v}
      placeholder="Step name"
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (isSubmitKey(e)) finish();
        if (e.key === 'Escape') onDone();
      }}
    />
  );
}

// ---------- outreach tracker ----------
const OUTCOMES: { v: Outcome; label: string }[] = [
  { v: 'pending', label: 'Waiting' },
  { v: 'yes', label: 'Yes' },
  { v: 'no', label: 'No' },
  { v: 'silent', label: 'No reply' },
];

function Tracker({ p, today }: { p: Project; today: ISODate }) {
  const [name, setName] = useState('');
  const tr = p.tracker;
  if (!tr)
    return (
      <button className="btn ghost add-tracker" onClick={() => updateProject(p.id, { tracker: { label: 'Contacts', entries: [] } }, 'Added a tracker')}>
        <Users size={14} /> Add a yes/no tracker (outreach, applications, referrals…)
      </button>
    );
  const count = (o: Outcome) => tr.entries.filter((e) => e.outcome === o).length;
  const upd = (id: string, patch: Partial<TrackerEntry>, label: string) => trackerUpdate(p.id, (es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)), label);
  return (
    <div className="tracker">
      <div className="section-title">
        <Users size={14} />
        <BlurInput className="tracker-label" value={tr.label} onCommit={(label) => updateProject(p.id, { tracker: { ...tr, label } }, 'Renamed tracker')} />
        <span className="tally">
          <span className="t-yes">{count('yes')} yes</span>
          <span className="t-no">{count('no')} no</span>
          <span className="t-pending">{count('pending')} waiting</span>
          <span className="t-silent">{count('silent')} no reply</span>
        </span>
      </div>
      {tr.entries.length > 0 && (
        <div className="tally-bar">
          {(['yes', 'pending', 'silent', 'no'] as Outcome[]).map((o) => (
            <div key={o} className={`tb-${o}`} style={{ flex: count(o) }} />
          ))}
        </div>
      )}
      <table className="tracker-table">
        <tbody>
          {tr.entries.map((e) => (
            <tr key={e.id}>
              <td className="tt-name">{e.name}</td>
              <td>
                <div className="seg small">
                  {OUTCOMES.map((o) => (
                    <button key={o.v} className={cls(e.outcome === o.v && 'on', `o-${o.v}`)} onClick={() => upd(e.id, { outcome: o.v }, `${e.name}: ${o.label}`)}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </td>
              <td className="tt-follow">
                {e.outcome === 'pending' && (
                  <>
                    <span className={cls('tiny', e.followUp && e.followUp <= today ? 'warn-text' : 'muted')}>{e.followUp ? `follow up ${fmtMD(e.followUp)}` : 'no follow-up'}</span>
                    <DateButton value={e.followUp} onPick={(d) => upd(e.id, { followUp: d }, `Follow up with ${e.name} on ${fmtMD(d)}`)} title="Follow-up day (shows on the calendar)" />
                  </>
                )}
              </td>
              <td>
                <BlurInput className="tt-note" value={e.note ?? ''} placeholder="note" onCommit={(note) => upd(e.id, { note }, `Note on ${e.name}`)} />
              </td>
              <td>
                <button className="icon-btn" onClick={() => trackerUpdate(p.id, (es) => es.filter((x) => x.id !== e.id), `Removed ${e.name}`)}>
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <input
        className="tracker-add"
        value={name}
        placeholder="Add a person / company — follow-up defaults to a week from today"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitKey(e) && name.trim()) {
            const entry: TrackerEntry = { id: uid('c'), name: name.trim(), outcome: 'pending', followUp: addDays(today, 7) };
            trackerUpdate(p.id, (es) => [...es, entry], `Reached out to ${entry.name}`);
            setName('');
          }
        }}
      />
    </div>
  );
}
