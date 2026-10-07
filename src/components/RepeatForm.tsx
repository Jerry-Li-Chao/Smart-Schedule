import { useMemo, useState } from 'react';
import { Plus, X, Zap } from 'lucide-react';
import type { Importance, ISODate, Recurrence, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, diffDays, weekday, WD } from '../lib/date';
import { describeRecurrence } from '../lib/recurrence';
import { monthlyCost } from '../lib/repeats';
import { fmtMoney } from '../lib/money';
import { cls } from '../lib/id';
import { createTask } from '../actions';
import { Field, Segmented } from './ui';

const UNITS: { freq: Recurrence['freq']; one: string; many: string }[] = [
  { freq: 'daily', one: 'day', many: 'days' },
  { freq: 'weekly', one: 'week', many: 'weeks' },
  { freq: 'monthly', one: 'month', many: 'months' },
  { freq: 'yearly', one: 'year', many: 'years' },
];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Create a repeat right on the Repeats page: name, how often, from when, and what it costs. */
export function RepeatForm({ today, onDone, from }: { today: ISODate; onDone: () => void; from?: { task: Task; start: ISODate } }) {
  const defImp = useStore((s) => s.settings.defaultImportance ?? 'must');
  // "Add again" from history: same details, starting on `from.start`, running for the same stretch
  const r0 = from?.task.recurrence;
  const s0 = from?.start ?? today;
  const span = r0?.until && from ? diffDays(from.task.date!, r0.until) : null;
  const [title, setTitle] = useState(from?.task.title ?? '');
  const [freq, setFreq] = useState<Recurrence['freq']>(r0?.freq ?? 'monthly');
  const [interval, setInterval] = useState(r0?.interval ?? 1);
  const [start, setStart] = useState<ISODate>(s0);
  const [days, setDays] = useState<number[]>(r0?.byWeekday?.length ? r0.byWeekday : [weekday(s0)]);
  const [until, setUntil] = useState(span !== null && span !== undefined ? addDays(s0, span) : '');
  const [amount, setAmount] = useState(from?.task.cost?.amount ? String(from.task.cost.amount) : '');
  const [autopay, setAutopay] = useState(!!from?.task.cost?.autopay);
  const [importance, setImportance] = useState<Importance>(from?.task.importance ?? defImp);

  const recurrence: Recurrence = useMemo(
    () => ({ freq, interval: Math.max(1, interval || 1), ...(freq === 'weekly' && days.length ? { byWeekday: [...days].sort() } : {}), ...(until ? { until } : {}) }),
    [freq, interval, days, until],
  );
  const cost = Number(amount) > 0 ? Number(amount) : 0;
  const perMonth = cost ? monthlyCost({ recurrence, cost: { amount: cost } } as never) : 0;
  const ok = title.trim() && start && (freq !== 'weekly' || days.length);

  const save = () => {
    if (!ok) return;
    createTask({
      title: title.trim(),
      date: start,
      recurrence,
      importance,
      ...(from?.task.notes ? { notes: from.task.notes } : {}),
      ...(cost || autopay ? { cost: { amount: cost, ...(autopay ? { autopay: true } : {}) } } : {}),
    });
    S().toast(`Added “${title.trim()}” — ${describeRecurrence(recurrence, start).replace(/^E/, 'e')}`);
    onDone();
  };

  return (
    <div className="rp-form" onKeyDown={(e) => (e.key === 'Escape' ? onDone() : e.key === 'Enter' && (e.metaKey || e.ctrlKey) && save())}>
      <div className="rf-head">
        <b>{from ? `Add “${from.task.title}” again` : 'New repeat'}</b>
        <span className="spacer" />
        <button className="icon-btn" title="Close (Esc)" onClick={onDone}>
          <X size={15} />
        </button>
      </div>

      <Field label="What">
        <input autoFocus value={title} placeholder="e.g. Streaming service, Rent, Protein shake" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
      </Field>

      <div className="rf-row">
        <Field label="Every">
          <div className="rf-every">
            <input type="number" min={1} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
            <select value={freq} onChange={(e) => setFreq(e.target.value as Recurrence['freq'])}>
              {UNITS.map((u) => (
                <option key={u.freq} value={u.freq}>
                  {interval > 1 ? u.many : u.one}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label={freq === 'daily' ? 'Starting' : 'First date'} hint={describeRecurrence(recurrence, start)}>
          <input type="date" value={start} onChange={(e) => {
              if (!e.target.value) return;
              setStart(e.target.value);
              // a single picked weekday follows the start date
              if (days.length <= 1) setDays([weekday(e.target.value)]);
            }} />
        </Field>
      </div>

      {freq === 'weekly' && (
        <div className="rf-days">
          {WEEK_ORDER.map((d) => (
            <button key={d} className={cls('chip-btn', days.includes(d) && 'on')} onClick={() => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]))}>
              {WD[d]}
            </button>
          ))}
        </div>
      )}

      <div className="rf-row">
        <Field label="Cost each time" hint={perMonth && (freq !== 'monthly' || interval > 1) ? `≈ ${fmtMoney(perMonth)} a month` : 'Leave empty if it’s not a bill'}>
          <input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Ends" hint="Optional — warns you before it runs out">
          <input type="date" value={until} min={start} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      </div>

      <div className="rf-row rf-bottom">
        <label className="check-row small">
          <input type="checkbox" checked={autopay} onChange={(e) => setAutopay(e.target.checked)} />
          <Zap size={12} /> Auto-pay (pays itself, never “missed”)
        </label>
        <Segmented
          className="tiny-seg"
          value={importance}
          onChange={setImportance}
          options={[
            { value: 'must', label: 'Must', className: 'imp-must' },
            { value: 'should', label: 'Should', className: 'imp-should' },
            { value: 'could', label: 'Could' },
          ]}
        />
      </div>

      <div className="rf-foot">
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" disabled={!ok} onClick={save}>
          <Plus size={14} /> Add repeat
        </button>
      </div>
    </div>
  );
}
