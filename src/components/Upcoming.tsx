import { useMemo, useState } from 'react';
import { AlarmClock, CalendarRange, Hourglass, Repeat } from 'lucide-react';
import type { ISODate, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, diffDays, fmtDay, fromISO, MONTHS, relDay } from '../lib/date';
import { describeRecurrence, nextOccurrence } from '../lib/recurrence';
import { isClosed } from '../lib/priority';
import { cls } from '../lib/id';
import { capture, jumpTo } from '../actions';
import { Empty, isSubmitKey } from './ui';

/** The part a day-column sheet can't do: things months away, repeating things, things you're waiting on. */
export function Upcoming({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [v, setV] = useState('');
  const d = useMemo(() => {
    const all = Object.values(entities).filter((e): e is Task => e.type === 'task' && !e.deleted);
    const open = all.filter((t) => !isClosed(t));
    const far = open.filter((t) => t.date && !t.recurrence && t.date > addDays(today, 7)).sort((a, b) => a.date!.localeCompare(b.date!));
    const byMonth = new Map<string, Task[]>();
    for (const t of far) {
      const k = t.date!.slice(0, 7);
      byMonth.set(k, [...(byMonth.get(k) ?? []), t]);
    }
    return {
      byMonth,
      reminders: open.filter((t) => t.remindAt && !t.remindFired).sort((a, b) => a.remindAt!.localeCompare(b.remindAt!)).slice(0, 12),
      deadlines: open.filter((t) => t.deadline && t.deadline >= today).sort((a, b) => a.deadline!.localeCompare(b.deadline!)).slice(0, 12),
      series: all.filter((t) => t.recurrence && t.date).map((t) => ({ t, next: nextOccurrence(t.recurrence!, t.date!, today) })).filter((x) => x.next).sort((a, b) => a.next!.localeCompare(b.next!)),
      waiting: open.filter((t) => t.status === 'waiting'),
    };
  }, [entities, today]);

  const open = (t: Task) => S().setUI({ selectedId: t.id, occDate: undefined });

  return (
    <div className="upcoming">
      <div className="up-add">
        <CalendarRange size={16} />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Plan something far ahead — “passport renewal in 6 months”, “pay rent every month on the 25th”"
          onKeyDown={(e) => {
            if (isSubmitKey(e) && v.trim()) {
              capture(v);
              setV('');
            }
          }}
        />
      </div>
      <div className="up-grid">
        <section className="up-col wide">
          <h3><CalendarRange size={15} /> Coming up (beyond this week)</h3>
          {!d.byMonth.size && <Empty>Nothing scheduled more than a week out. Try “renew passport in 5 months”.</Empty>}
          {[...d.byMonth].map(([k, list]) => {
            const [y, m] = k.split('-').map(Number);
            return (
              <div key={k} className="up-month">
                <div className="up-month-label">{MONTHS[m - 1]} {y !== fromISO(today).getFullYear() ? y : ''}</div>
                {list.map((t) => (
                  <div key={t.id} className={cls('up-row', `lvl-${t.importance}`)} onClick={() => open(t)}>
                    <span className="up-date">{fmtDay(t.date!, today)}</span>
                    <span className="up-title">{t.title}</span>
                    <span className="tiny muted">{relDay(t.date!, today)}</span>
                    {t.remindAt && !t.remindFired && <span title={`Reminder ${t.remindAt.replace('T', ' ')}`}><AlarmClock size={12} className="muted" /></span>}
                    <button className="btn tiny ghost" onClick={(e) => (e.stopPropagation(), jumpTo(t.date!))}>Show</button>
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        <section className="up-col">
          <h3><AlarmClock size={15} /> Reminders</h3>
          {!d.reminders.length && <Empty>No reminders set.</Empty>}
          {d.reminders.map((t) => (
            <div key={t.id} className="up-row" onClick={() => open(t)}>
              <span className="up-date">{fmtDay(t.remindAt!.slice(0, 10), today)} {t.remindAt!.slice(11)}</span>
              <span className="up-title">{t.title}</span>
            </div>
          ))}

          <h3>Deadlines</h3>
          {!d.deadlines.length && <Empty>No deadlines.</Empty>}
          {d.deadlines.map((t) => {
            const left = diffDays(today, t.deadline!);
            return (
              <div key={t.id} className="up-row" onClick={() => open(t)}>
                <span className={cls('up-date', left <= 3 && 'urgent-text')}>{left === 0 ? 'today' : `${left}d left`}</span>
                <span className="up-title">{t.title}</span>
              </div>
            );
          })}

          <h3><Hourglass size={15} /> Waiting on others</h3>
          {!d.waiting.length && <Empty>Nobody owes you anything.</Empty>}
          {d.waiting.map((t) => (
            <div key={t.id} className="up-row" onClick={() => open(t)}>
              <span className="up-title">{t.title}</span>
              {t.date && <span className="tiny muted">since {fmtDay(t.date, today)}</span>}
            </div>
          ))}
        </section>

        <section className="up-col">
          <h3><Repeat size={15} /> Repeating</h3>
          {!d.series.length && <Empty>Bills, meds, classes, gym — “every month on the 25th”.</Empty>}
          {d.series.map(({ t, next }) => (
            <div key={t.id} className="up-row" onClick={() => open(t)}>
              <span className="up-title">{t.title}</span>
              <span className="tiny muted">{describeRecurrence(t.recurrence!, t.date!)} · next {relDay(next!, today)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
