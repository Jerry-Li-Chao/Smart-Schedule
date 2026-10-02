import { useEffect, useMemo, useState } from 'react';
import { GitBranch, Lightbulb, Trash2, X, Clock, Sparkles } from 'lucide-react';
import type { Importance, ISODate, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, fmtDay, fmtMD, nextMonday, weekendOf } from '../lib/date';
import { IMPORTANCE_HELP } from '../lib/priority';
import { deleteEntity, isInbox, planQueue, promoteToProject, updateTask } from '../actions';
import { DateButton, Segmented } from './ui';

/**
 * One decision at a time: every sticky note gets a day (or is consciously parked).
 */
export function PlanModal({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [later, setLater] = useState<Set<string>>(new Set());
  const [handled, setHandled] = useState(0);
  const queue = useMemo(() => planQueue().filter((t) => !later.has(t.id)), [entities, later, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = queue[0];
  const close = () => S().setUI({ planOpen: false });

  const done = (fn: () => void) => {
    fn();
    setHandled((n) => n + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') return close();
      if (!t) return;
      const inbox = isInbox(t);
      const map: Record<string, () => void> = {
        '1': () => sched(t, today),
        '2': () => sched(t, addDays(today, 1)),
        '3': () => sched(t, inbox ? weekendOf(today) : nextMonday(today)),
        '4': () => sched(t, nextMonday(today)),
        l: () => setLater((s) => new Set(s).add(t.id)),
      };
      if (map[e.key]) {
        e.preventDefault();
        done(map[e.key]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal plan">
        <div className="plan-head">
          <Sparkles size={16} />
          <b>Plan</b>
          <span className="muted small">{t ? `${queue.length} left` : ''}</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={close}>
            <X size={16} />
          </button>
        </div>
        {!t ? (
          <div className="plan-done">
            <div className="big">✓</div>
            <p>{handled ? `${handled} decided. ` : ''}Everything on the sticky has a day.</p>
            <button className="btn primary" onClick={close}>Back to the calendar</button>
          </div>
        ) : (
          <InboxDecision key={t.id} t={t} today={today} done={done} later={() => setLater((s) => new Set(s).add(t.id))} />
        )}
      </div>
    </div>
  );
}

function sched(t: Task, date: ISODate) {
  // a conscious re-plan resets the "carried" counter
  updateTask(t.id, { date, firstScheduled: date }, `Planned “${t.title}” → ${fmtDay(date)}`);
}

function ImportancePick({ t }: { t: Task }) {
  return (
    <div className="plan-imp">
      <span className="small muted">If it slips a week:</span>
      <Segmented<Importance>
        value={t.importance}
        onChange={(importance) => updateTask(t.id, { importance })}
        options={(['could', 'should', 'must'] as Importance[]).map((k) => ({ value: k, label: IMPORTANCE_HELP[k].label, title: IMPORTANCE_HELP[k].hint, className: `imp-${k}` }))}
      />
    </div>
  );
}

function InboxDecision({ t, today, done, later }: { t: Task; today: ISODate; done: (f: () => void) => void; later: () => void }) {
  const days = Math.floor((Date.now() - t.createdAt) / 86400000);
  return (
    <div className="plan-body">
      <div className="plan-title">{t.title}</div>
      {t.notes && <pre className="plan-notes">{t.notes}</pre>}
      <div className="small muted">{days > 0 ? `On the sticky for ${days} day${days > 1 ? 's' : ''}` : 'Captured today'}{t.deadline ? ` · due ${fmtMD(t.deadline)}` : ''}</div>
      <ImportancePick t={t} />
      <div className="plan-q">When will you do it?</div>
      <div className="plan-grid">
        <button className="btn big" onClick={() => done(() => sched(t, today))}><kbd>1</kbd> Today</button>
        <button className="btn big" onClick={() => done(() => sched(t, addDays(today, 1)))}><kbd>2</kbd> Tomorrow</button>
        <button className="btn big" onClick={() => done(() => sched(t, weekendOf(today)))}><kbd>3</kbd> Weekend</button>
        <button className="btn big" onClick={() => done(() => sched(t, nextMonday(today)))}><kbd>4</kbd> Next week</button>
        <DateButton className="btn big as-btn" onPick={(d) => done(() => sched(t, d))}>Pick a day…</DateButton>
      </div>
      <div className="plan-alt">
        <button className="btn ghost" onClick={() => done(() => updateTask(t.id, { someday: true }, `Parked “${t.title}” as an idea`))}>
          <Lightbulb size={14} /> Just an idea → someday
        </button>
        <button className="btn ghost" onClick={() => done(() => promoteToProject(t.id))}>
          <GitBranch size={14} /> Bigger — make a project
        </button>
        <button className="btn ghost" onClick={() => done(() => deleteEntity(t.id))}>
          <Trash2 size={14} /> Not needed
        </button>
        <button className="btn ghost" onClick={later}>
          <Clock size={14} /> Decide later <kbd>L</kbd>
        </button>
      </div>
    </div>
  );
}
