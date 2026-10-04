import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Check, CreditCard, History, Hourglass, Plus, RotateCcw, RotateCw, Zap } from 'lucide-react';
import type { Importance, ISODate, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, addMonths, diffDays, fmtDay, relDay } from '../lib/date';
import { describeRecurrence, occurrenceNumber } from '../lib/recurrence';
import { activeBills, chargesBetween, monthlyCost, pastRepeats, repeatInfos, type Cadence, type PastRepeat, type RepeatInfo } from '../lib/repeats';
import { fmtMoney } from '../lib/money';
import { cls } from '../lib/id';
import { setItemStatus, updateTask } from '../actions';
import { Segmented } from './ui';
import { RepeatForm } from './RepeatForm';

const GROUPS: { cadence: Cadence; label: string }[] = [
  { cadence: 'daily', label: 'Daily' },
  { cadence: 'weekly', label: 'Weekly' },
  { cadence: 'monthly', label: 'Monthly' },
  { cadence: 'yearly', label: 'Yearly & longer' },
];
const RANK: Record<Importance, number> = { must: 0, should: 1, could: 2 };
type Filter = 'all' | 'today' | 'week' | 'missed' | 'ending';

/** Everything that repeats, in one place: what's next, how it's been going, what needs renewing. */
export function Repeats({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  useStore((s) => s.settings.currency); // re-render amounts when the currency changes
  const [filter, setFilter] = useState<Filter>('all');
  const [form, setForm] = useState<false | true | { task: Task; start: ISODate }>(false);
  const all = useMemo(() => repeatInfos(entities, today), [entities, today]);
  const live = all.filter((r) => !r.ended);
  const past = useMemo(() => pastRepeats(entities, today), [entities, today]);
  const nudges = past.filter((p) => p.soonIn !== undefined);
  const again = (p: PastRepeat) => {
    setForm({ task: p.task, start: p.again < today ? today : p.again });
    document.querySelector('.repeats')?.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const weekEnd = useMemo(() => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + 6);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const counts = {
    today: live.filter((r) => r.today === 'open').length,
    week: live.filter((r) => r.next && r.next <= weekEnd).length,
    missed: live.filter((r) => r.missed.length).length,
    ending: live.filter((r) => r.endsIn !== undefined).length,
  };
  const pass = (r: RepeatInfo) =>
    filter === 'all' ||
    (filter === 'today' && r.today === 'open') ||
    (filter === 'week' && !!r.next && r.next <= weekEnd) ||
    (filter === 'missed' && r.missed.length > 0) ||
    (filter === 'ending' && r.endsIn !== undefined);
  const sorted = (list: RepeatInfo[]) =>
    [...list].sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || RANK[a.task.importance] - RANK[b.task.importance]);

  return (
    <div className="repeats">
      <div className="rp-head">
        <span className="muted small">Bills, habits, renewals — everything that comes back.</span>
        <span className="spacer" />
        {!form && (
          <button className="btn primary" onClick={() => setForm(true)}>
            <Plus size={14} /> New repeat
          </button>
        )}
      </div>
      {form && <RepeatForm key={form === true ? 'new' : form.task.id} today={today} from={form === true ? undefined : form} onDone={() => setForm(false)} />}
      {!form &&
        nudges.map((p) => (
          <div key={p.task.id} className="rp-nudge">
            <RotateCcw size={14} />
            <span>
              Last time, <b>{p.task.title.replace(/\s+#\s*$/, '')}</b> started on {fmtDay(p.from, today)}. That comes round again{' '}
              {p.soonIn === 0 ? 'today' : `in ${p.soonIn} day${p.soonIn === 1 ? '' : 's'}`} — add it again?
            </span>
            <button className="btn tiny primary" onClick={() => again(p)}>
              Add again
            </button>
          </div>
        ))}

      <MoneyPanel today={today} />

      <div className="rp-sum">
        {(
          [
            ['today', 'Due today', counts.today, ''],
            ['week', 'Next 7 days', counts.week, ''],
            ['missed', 'Missed lately', counts.missed, counts.missed ? 'warn' : ''],
            ['ending', 'Ending soon', counts.ending, counts.ending ? 'warn' : ''],
          ] as const
        ).map(([k, label, n, tone]) => (
          <button key={k} className={cls('rp-tile', tone, filter === k && 'on')} onClick={() => setFilter(filter === k ? 'all' : k)}>
            <b>{n}</b>
            <span>{label}</span>
          </button>
        ))}
      </div>
      {filter !== 'all' && (
        <div className="rp-filter">
          Showing: {{ today: 'due today', week: 'happening in the next 7 days', missed: 'missed lately', ending: 'ending soon' }[filter]} ·{' '}
          <button className="link-btn" onClick={() => setFilter('all')}>
            show all
          </button>
        </div>
      )}

      {!all.length && (
        <div className="rp-empty">
          Nothing repeats yet. Use New repeat to add rent, subscriptions, daily habits or renewals — they all land here, with the next date up front.
        </div>
      )}

      {GROUPS.map(({ cadence, label }) => {
        const list = sorted(live.filter((r) => r.cadence === cadence && pass(r)));
        if (!list.length) return null;
        return (
          <section key={cadence} className="rp-group">
            <h3>
              {label} <span className="muted">{list.length}</span>
            </h3>
            <div className="rp-grid">
              {list.map((r) => (
                <RepeatCard key={r.task.id} r={r} today={today} />
              ))}
            </div>
          </section>
        );
      })}

      {past.length > 0 && filter === 'all' && (
        <section className="rp-group rp-past">
          <h3>
            <History size={13} /> Past repeats <span className="muted">{past.length}</span>
          </h3>
          <div className="rp-past-list">
            {past.map((p) => (
              <div key={p.task.id} className="rp-past-row">
                <div className="pr-main">
                  <b>{p.task.title.replace(/\s+#\s*$/, '')}</b>
                  <span className="muted small">
                    {describeRecurrence({ ...p.task.recurrence!, until: undefined }, p.from)}
                    {p.task.cost?.amount ? ` · ${fmtMoney(p.task.cost.amount)}` : ''}
                  </span>
                </div>
                <span className="pr-ran small muted">
                  {fmtDay(p.from, today)} – {fmtDay(p.to, today)} · {p.how}
                </span>
                <button className="btn tiny" onClick={() => again(p)}>
                  <RotateCcw size={12} /> Add again
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RepeatCard({ r, today }: { r: RepeatInfo; today: ISODate }) {
  const t = r.task;
  const until = t.recurrence!.until;
  const open = () => S().setUI({ selectedId: t.id, occDate: r.next ?? undefined });
  const occ = (date: ISODate) => ({ kind: 'occ' as const, key: `${t.id}@${date}`, task: t, date });
  const extend = (months: number) =>
    updateTask(t.id, { recurrence: { ...t.recurrence!, until: addMonths(until ?? today, months) } }, `Extended “${t.title}”`);
  const soon = r.next ? diffDays(today, r.next) : null;

  return (
    <div className={cls('rp-card', !t.allDay && `lvl-${t.importance}`, t.allDay && 'is-event', r.ended && 'ended')} onClick={open}>
      <div className="rp-top">
        <div className="rp-title">{t.title.replace(/\s+#\s*$/, '')}</div>
        {t.cost?.autopay ? (
          <span className="rp-auto" title="Pays itself — nothing to tick off">
            <Zap size={11} /> Auto-pay
          </span>
        ) : r.today === 'open' && !t.allDay && (
          <button
            className="btn tiny rp-done"
            title="Done for today"
            onClick={(e) => {
              e.stopPropagation();
              setItemStatus(occ(today), 'done');
            }}
          >
            <Check size={13} /> Done
          </button>
        )}
        {r.today === 'done' && !t.cost?.autopay && (
          <span className="rp-ok">
            <Check size={12} /> today
          </span>
        )}
      </div>
      <div className="rp-freq">
        <RotateCw size={11} /> {describeRecurrence(t.recurrence!, t.date!)}
        {t.time && ` · ${t.time}`}
      </div>
      {!!t.cost?.amount && (
        <div className="rp-cost">
          <b>{fmtMoney(t.cost.amount)}</b> each time
          {t.recurrence!.freq !== 'monthly' || t.recurrence!.interval > 1 ? <span className="muted"> · ≈ {fmtMoney(monthlyCost(t))}/mo</span> : null}
        </div>
      )}

      <div className="rp-next">
        {r.next ? (
          <>
            <span className={cls('rp-when', soon === 0 && 'now', soon !== null && soon > 0 && soon <= 3 && 'soon')}>{soon === 0 ? 'Today' : relDay(r.next, today)}</span>
            <span className="rp-date">
              {fmtDay(r.next, today)}
              {t.numbering && ` · #${occurrenceNumber(t, r.next)}`}
            </span>
          </>
        ) : (
          <span className="muted">Ended {until ? fmtDay(until, today) : ''}</span>
        )}
      </div>
      {r.upcoming.length > 0 && <div className="rp-then">then {r.upcoming.map((d) => fmtDay(d, today)).join(' · ')}</div>}

      {!t.allDay && r.recent.length > 0 && (
        <div className="rp-hist" title="Most recent on the right">
          {[...r.recent].reverse().map((x) => (
            <i key={x.date} className={cls('rp-dot', x.state)} title={`${fmtDay(x.date, today)}: ${x.state === 'dropped' ? 'skipped' : x.state}`} />
          ))}
          {r.rate !== null && <span className="rp-rate">{Math.round(r.rate * 100)}% done</span>}
        </div>
      )}

      {r.missed.length > 0 && !r.ended && (
        <div className="rp-alert warn" onClick={(e) => e.stopPropagation()}>
          <AlertTriangle size={12} />
          <span>Missed {fmtDay(r.missed[0], today)}{r.missed.length > 1 ? ` +${r.missed.length - 1} more` : ''}</span>
          <button className="link-btn" onClick={() => setItemStatus(occ(r.missed[0]), 'done')}>
            I did it
          </button>
          <button className="link-btn" onClick={() => setItemStatus(occ(r.missed[0]), 'dropped')}>
            Skip
          </button>
        </div>
      )}

      {r.endsIn !== undefined && (
        <div className="rp-alert renew" onClick={(e) => e.stopPropagation()}>
          <Hourglass size={12} />
          <span>Ends {r.endsIn === 0 ? 'today' : `in ${r.endsIn} day${r.endsIn > 1 ? 's' : ''}`} — renew?</span>
          <button className="link-btn" onClick={() => extend(6)}>+6 mo</button>
          <button className="link-btn" onClick={() => extend(12)}>+1 yr</button>
        </div>
      )}
      {until && r.endsIn === undefined && !r.ended && (
        <div className="rp-until">
          <CalendarClock size={11} /> until {fmtDay(until, today)}
        </div>
      )}
    </div>
  );
}

type Span = '7' | '30' | '90' | '365';

/** Bills and subscriptions: an amortized monthly total, what's actually charged soon, and where it goes. */
function MoneyPanel({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const currency = useStore((s) => s.settings.currency || 'USD');
  const [span, setSpan] = useState<Span>('30');
  const bills = useMemo(() => activeBills(entities, today), [entities, today]);
  const charges = useMemo(() => chargesBetween(entities, today, addDays(today, Number(span) - 1)), [entities, today, span]);
  if (!bills.length)
    return (
      <div className="money-hint">
        <CreditCard size={14} /> Track bills and subscriptions: give a repeat a cost (in its panel, or type “$15.49”) and see your monthly total here.
      </div>
    );

  const monthly = bills.reduce((a, t) => a + monthlyCost(t), 0);
  const ranked = [...bills].sort((a, b) => monthlyCost(b) - monthlyCost(a));
  const auto = bills.filter((t) => t.cost?.autopay).length;
  const soonTotal = charges.reduce((a, c) => a + c.amount, 0);
  const open = (id: string) => S().setUI({ selectedId: id, occDate: undefined });

  return (
    <section className="money">
      <div className="money-total">
        <div className="mt-label">
          <CreditCard size={14} /> Bills & subscriptions
          <select className="mt-cur" value={currency} onChange={(e) => S().setSettings({ currency: e.target.value })} title="Currency">
            {['USD', 'EUR', 'GBP', 'CNY', 'JPY', 'CAD', 'AUD', 'INR', 'HKD', 'SGD'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="mt-big">{fmtMoney(monthly)}</div>
        <div className="mt-sub">a month, on average</div>
        <div className="mt-row">
          <span>
            <b>{fmtMoney(monthly * 12, { cents: false })}</b> a year
          </span>
          <span>
            <b>{bills.length}</b> bill{bills.length > 1 ? 's' : ''}
          </span>
          <span>
            <b>{auto}</b> on auto-pay
          </span>
        </div>
        <div className="mt-note">Yearly and weekly charges are spread evenly over the months.</div>
      </div>

      <div className="money-soon">
        <div className="ms-head">
          <b>Coming up</b>
          <span className="ms-sum">{fmtMoney(soonTotal)}</span>
          <span className="spacer" />
          <Segmented
            className="tiny-seg"
            value={span}
            onChange={setSpan}
            options={[
              { value: '7', label: '7D' },
              { value: '30', label: '30D' },
              { value: '90', label: '90D' },
              { value: '365', label: '1Y' },
            ]}
          />
        </div>
        {charges.length ? (
          <ul className="ms-list">
            {charges.map((c) => (
              <li key={`${c.task.id}${c.date}`} onClick={() => open(c.task.id)}>
                <span className="ms-date">{c.date === today ? 'Today' : fmtDay(c.date, today)}</span>
                <span className="ms-name">{c.task.title.replace(/\s+#\s*$/, '')}</span>
                {c.task.cost?.autopay && <Zap size={11} className="ms-auto" />}
                <span className="ms-amt">{fmtMoney(c.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="muted small">Nothing charged in this stretch.</div>
        )}
      </div>

      <Donut items={ranked.map((t) => ({ id: t.id, name: t.title.replace(/\s+#\s*$/, ''), value: monthlyCost(t) }))} total={monthly} onPick={open} />
    </section>
  );
}

const PALETTE = ['#0f766e', '#22c55e', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#f97316', '#eab308', '#64748b'];

/** Where the monthly total goes: one slice per bill (small ones grouped as "Other"). */
function Donut({ items, total, onPick }: { items: { id: string; name: string; value: number }[]; total: number; onPick: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const MAX = 7;
  const slices = items.length > MAX ? [...items.slice(0, MAX - 1), { id: '_other', name: `Other (${items.length - MAX + 1})`, value: items.slice(MAX - 1).reduce((a, x) => a + x.value, 0) }] : items;
  const R = 52;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const h = slices.find((x) => x.id === hover);
  return (
    <div className="money-split">
      <b>Per month</b>
      <div className="donut-wrap">
        <svg className="donut" viewBox="0 0 140 140" width="140" height="140">
          <circle cx="70" cy="70" r={R} className="donut-bg" />
          {slices.map((x, i) => {
            const len = (x.value / total) * C;
            const seg = (
              <circle
                key={x.id}
                cx="70"
                cy="70"
                r={R}
                className={cls('donut-seg', hover === x.id && 'on', hover && hover !== x.id && 'dim')}
                stroke={PALETTE[i % PALETTE.length]}
                strokeDasharray={`${Math.max(0, len - 1.5)} ${C}`}
                strokeDashoffset={-acc}
                onMouseEnter={() => setHover(x.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => x.id !== '_other' && onPick(x.id)}
              >
                <title>{`${x.name}: ${fmtMoney(x.value)} (${Math.round((x.value / total) * 100)}%)`}</title>
              </circle>
            );
            acc += len;
            return seg;
          })}
          <text x="70" y="66" className="donut-amt" textAnchor="middle">
            {fmtMoney(h ? h.value : total, { cents: false })}
          </text>
          <text x="70" y="84" className="donut-sub" textAnchor="middle">
            {h ? `${Math.round((h.value / total) * 100)}%` : 'a month'}
          </text>
        </svg>
        <ul className="donut-legend">
          {slices.map((x, i) => (
            <li
              key={x.id}
              className={cls(hover === x.id && 'on')}
              onMouseEnter={() => setHover(x.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => x.id !== '_other' && onPick(x.id)}
            >
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="dl-name">{x.name}</span>
              <span className="dl-amt">{fmtMoney(x.value)}</span>
              <span className="dl-pct">{Math.round((x.value / total) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
