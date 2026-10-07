import { useState } from 'react';
import { Pause, Repeat2 } from 'lucide-react';
import type { ISODate, Task } from '../types';
import { addDays, diffDays, fmtDay } from '../lib/date';
import { nextOccurrence } from '../lib/recurrence';
import { chainSpent, type Chain } from '../lib/repeats';
import { fmtMoney } from '../lib/money';
import { cls } from '../lib/id';
import { cancelScheduled, changePlan, pausePlan } from '../actions';
import { Field, Segmented } from './ui';

/** "$20/mo", "$99/yr", "$10/wk", "$120 every 3 mo" */
export function priceLabel(t: Task): string {
  const r = t.recurrence!;
  const unit = { daily: 'day', weekly: 'wk', monthly: 'mo', yearly: 'yr' }[r.freq];
  const amt = fmtMoney(t.cost?.amount ?? 0);
  return r.interval > 1 ? `${amt} every ${r.interval} ${unit}` : `${amt}/${unit}`;
}

/**
 * A subscription's periods on one line: the running period highlighted, past ones dimmed, a scheduled
 * one dashed, gaps (paused) left empty — with each period's dates and price underneath.
 */
export function PlanHistory({ chain, today }: { chain: Chain; today: ISODate }) {
  const { periods, current } = chain;
  const first = periods[0].date!;
  const lastEnd = periods.reduce((m, p) => {
    const e = p.recurrence!.until ?? today;
    return e > m ? e : m;
  }, today);
  const end = addDays(lastEnd > today ? lastEnd : today, 14);
  const span = Math.max(1, diffDays(first, end));
  const pos = (d: ISODate) => `${(diffDays(first, d) / span) * 100}%`;
  const kind = (p: Task) => (p === current ? 'now' : p.date! > today ? 'next' : 'past');
  const year = `${today.slice(0, 4)}-01-01`;
  const spentYear = chainSpent(periods, year, today);
  const spentAll = chainSpent(periods, first, today);

  return (
    <div className="plan-hist" onClick={(e) => e.stopPropagation()}>
      <div className="ph-track" title="Each bar is a period; gaps are when it was paused">
        {periods.map((p) => {
          const to = p.recurrence!.until ?? end;
          return <i key={p.id} className={cls('ph-seg', kind(p))} style={{ left: pos(p.date!), width: `calc(${pos(addDays(to, 1))} - ${pos(p.date!)})` }} />;
        })}
        <b className="ph-today" style={{ left: pos(today) }} title="Today" />
      </div>
      <ul className="ph-list">
        {periods.map((p, i) => {
          const prev = periods[i - 1];
          const gap = prev?.recurrence!.until ? diffDays(prev.recurrence!.until, p.date!) - 1 : 0;
          const k = kind(p);
          return (
            <li key={p.id} className="ph-item-wrap">
              {gap > 0 && <div className="ph-gap">paused {gap} day{gap > 1 ? 's' : ''}</div>}
              <div className={cls('ph-item', k)}>
                <span className="ph-dates">
                  {k === 'next' ? `from ${fmtDay(p.date!, today)}` : `${fmtDay(p.date!, today)} – ${p.recurrence!.until ? fmtDay(p.recurrence!.until, today) : 'now'}`}
                </span>
                <span className="ph-price">
                  {p.plan && <em>{p.plan} · </em>}
                  {priceLabel(p)}
                </span>
                {k === 'now' && <span className="ph-tag">now</span>}
                {k === 'next' && (
                  <span className="ph-tag next">
                    scheduled ·{' '}
                    <button className="link-btn" onClick={() => cancelScheduled(p, prev)}>
                      cancel
                    </button>
                  </span>
                )}
              </div>
              {p.cost?.charged &&
                Object.entries(p.cost.charged).map(([d, a]) => (
                  <div key={d} className={cls('ph-oneoff', k)}>
                    one-off {fmtMoney(a)} on {fmtDay(d, today)}
                  </div>
                ))}
            </li>
          );
        })}
      </ul>
      {spentAll > 0 && (
        <div className="ph-spent">
          Spent <b>{fmtMoney(spentYear)}</b> this year · <b>{fmtMoney(spentAll)}</b> since {fmtDay(first, today)}
        </div>
      )}
    </div>
  );
}

type When = 'today' | 'renewal' | 'pick';

/** Change plan (from a day on) or pause — shown inside a subscription's card. */
export function PlanActions({ t, chain, today }: { t: Task; chain: Chain; today: ISODate }) {
  const [mode, setMode] = useState<null | 'change' | 'pause'>(null);
  const renewal = nextOccurrence(t.recurrence!, t.date!, addDays(today, 1));
  const [amount, setAmount] = useState(String(t.cost?.amount ?? ''));
  const [plan, setPlan] = useState(t.plan ?? '');
  const [when, setWhen] = useState<When>('today');
  const [pick, setPick] = useState<ISODate>(today);
  const [oneOff, setOneOff] = useState('');
  const [lastDay, setLastDay] = useState<ISODate>(renewal ? addDays(renewal, -1) : today);
  const from = when === 'today' ? today : when === 'renewal' && renewal ? renewal : pick;
  const scheduled = chain.upcoming && chain.upcoming !== t;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (!mode)
    return (
      <div className="plan-actions" onClick={stop}>
        <button className="btn tiny" disabled={!!scheduled} title={scheduled ? 'A plan change is already scheduled — cancel it first' : 'New price or plan from a day on; earlier charges keep their price'} onClick={() => setMode('change')}>
          <Repeat2 size={12} /> Change plan
        </button>
        <button className="btn tiny" disabled={!!scheduled} title="Cancel or pause; resubscribe later from Past repeats" onClick={() => setMode('pause')}>
          <Pause size={12} /> Pause
        </button>
      </div>
    );

  if (mode === 'pause')
    return (
      <div className="plan-form" onClick={stop} onKeyDown={(e) => e.key === 'Escape' && setMode(null)}>
        <Field label="Last day you’re paying for" hint="Nothing is charged after this day. Resubscribe any time from Past repeats.">
          <input type="date" value={lastDay} min={t.date!} onChange={(e) => e.target.value && setLastDay(e.target.value)} />
        </Field>
        <div className="pf-foot">
          <button className="btn tiny" onClick={() => setMode(null)}>
            Cancel
          </button>
          <button
            className="btn tiny primary"
            onClick={() => {
              pausePlan(t, lastDay);
              setMode(null);
            }}
          >
            <Pause size={12} /> Pause after {fmtDay(lastDay, today)}
          </button>
        </div>
      </div>
    );

  const price = Number(amount);
  const extra = oneOff.trim() === '' ? undefined : Number(oneOff);
  const ok = price >= 0 && amount.trim() !== '' && from && (extra === undefined || extra >= 0);
  return (
    <div className="plan-form" onClick={stop} onKeyDown={(e) => e.key === 'Escape' && setMode(null)}>
      <div className="rf-row">
        <Field label="New price each time">
          <input autoFocus type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Plan name" hint="Optional, e.g. Pro">
          <input value={plan} placeholder="—" onChange={(e) => setPlan(e.target.value)} />
        </Field>
      </div>
      <Field label="Starting">
        <Segmented<When>
          className="tiny-seg"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'today', label: 'Today' },
            ...(renewal ? [{ value: 'renewal' as When, label: `Next renewal · ${fmtDay(renewal, today)}` }] : []),
            { value: 'pick', label: 'Pick a day' },
          ]}
        />
      </Field>
      {when === 'pick' && <input type="date" value={pick} min={addDays(t.date!, 1)} onChange={(e) => e.target.value && setPick(e.target.value)} />}
      <Field label={`One-off charge on ${fmtDay(from, today)}`} hint="Optional — what was actually billed that day, e.g. a prorated upgrade. Leave empty to charge the new price.">
        <input type="number" min="0" step="0.01" inputMode="decimal" placeholder={amount || '0.00'} value={oneOff} onChange={(e) => setOneOff(e.target.value)} />
      </Field>
      <div className="field-hint">
        {from <= t.date!
          ? 'This period starts that day, so its price is simply updated.'
          : `The current plan ends ${fmtDay(addDays(from, -1), today)}; billing then follows ${fmtDay(from, today)}. Earlier charges keep their price.`}
      </div>
      <div className="pf-foot">
        <button className="btn tiny" onClick={() => setMode(null)}>
          Cancel
        </button>
        <button
          className="btn tiny primary"
          disabled={!ok}
          onClick={() => {
            changePlan(t, { from, amount: price, plan, oneOff: extra });
            setMode(null);
          }}
        >
          <Repeat2 size={12} /> Change plan
        </button>
      </div>
    </div>
  );
}
