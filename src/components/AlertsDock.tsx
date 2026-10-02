import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { DayItem, ISODate } from '../types';
import { S, useStore } from '../store';
import { addDays, fmtTime, parseLocalDateTime } from '../lib/date';
import { itemsFor } from '../lib/dayIndex';
import { useDayIndex } from '../lib/hooks';
import { numberedTitle } from '../lib/recurrence';
import { cls } from '../lib/id';
import { setItemStatus } from '../actions';

export const DEFAULT_ALERT_LEVELS = [
  { minutes: 120, on: true },
  { minutes: 60, on: true },
  { minutes: 30, on: true },
  { minutes: 1, on: true },
];
const NOW_GRACE_MIN = 10; // keep showing "now" for a few minutes after it starts

interface Upcoming {
  key: string;
  item: DayItem;
  title: string;
  at: number;
  minsLeft: number;
  intensity: number; // 0 calm … 3 urgent, 4 = happening now
}

function useNow(fast: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), fast ? 1000 : 15000);
    return () => clearInterval(iv);
  }, [fast]);
  return now;
}

function countdown(ms: number) {
  if (ms <= 0) return 'now';
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60 ? `${m % 60}m` : ''}`.trim();
}

/**
 * Bottom-left heads-up for anything with a time: appears at the earliest level (2 h by default)
 * and gets louder at each later one (1 h, 30 min, 1 min). Can be minimised, never dismissed.
 */
export function AlertsDock({ today }: { today: ISODate }) {
  const idx = useDayIndex();
  const levels = useStore((s) => s.settings.alertLevels ?? DEFAULT_ALERT_LEVELS);
  const collapsed = useStore((s) => !!s.settings.alertsCollapsed);
  const ref = useRef<HTMLDivElement>(null);
  const active = useMemo(() => levels.filter((l) => l.on && l.minutes > 0).map((l) => l.minutes).sort((a, b) => b - a), [levels]);
  const [fast, setFast] = useState(false);
  const now = useNow(fast);

  const list: Upcoming[] = useMemo(() => {
    if (!active.length) return [];
    const out: Upcoming[] = [];
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      for (const item of itemsFor(idx, date)) {
        if (item.kind === 'follow' || !item.task.time) continue;
        const status = item.kind === 'occ' ? item.state ?? 'open' : item.task.status;
        if (status === 'done' || status === 'dropped') continue;
        const at = parseLocalDateTime(`${date}T${item.task.time}`).getTime();
        const minsLeft = (at - now) / 60000;
        if (minsLeft > active[0] || minsLeft < -NOW_GRACE_MIN) continue;
        // which level are we in? the smallest one that still covers the time left
        let stage = 0;
        active.forEach((m, i) => minsLeft <= m && (stage = i));
        const intensity = minsLeft <= 0 ? 4 : active.length === 1 ? 3 : Math.round((stage / (active.length - 1)) * 3);
        out.push({
          key: item.key,
          item,
          title: item.kind === 'occ' ? numberedTitle(item.task, date) : item.task.title,
          at,
          minsLeft,
          intensity,
        });
      }
    }
    return out.sort((a, b) => a.at - b.at);
  }, [idx, today, now, active]);

  useEffect(() => setFast(list.some((u) => u.minsLeft < 3)), [list]);

  // let the sticky above make room
  useEffect(() => {
    const el = ref.current;
    const set = () => document.documentElement.style.setProperty('--alerts-h', `${el ? el.offsetHeight + 12 : 0}px`);
    set();
    if (!el) return;
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--alerts-h', '0px');
    };
  }, [list.length > 0, collapsed]);

  if (!list.length) return null;
  const top = list[0];
  const toggle = () => S().setSettings({ alertsCollapsed: !collapsed });
  const open = (u: Upcoming) => S().setUI({ selectedId: u.item.kind !== 'follow' ? u.item.task.id : undefined, occDate: u.item.kind === 'occ' ? u.item.date : undefined, view: 'timeline' });

  return (
    <div ref={ref} className={cls('alerts', `i${top.intensity}`, collapsed && 'collapsed')}>
      <button className="alerts-head" onClick={toggle} title={collapsed ? 'Show what’s coming up' : 'Minimise (it stays until the time passes)'}>
        <BellRing size={14} className="bell" />
        {collapsed ? (
          <span className="alerts-mini">
            <b>{top.title}</b> · {countdown(top.at - now)}
            {list.length > 1 && <span className="more">+{list.length - 1}</span>}
          </span>
        ) : (
          <span>Coming up</span>
        )}
        <span className="spacer" />
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {!collapsed && (
        <div className="alerts-list">
          {list.map((u) => (
            <div key={u.key} className={cls('alert', `i${u.intensity}`)} onClick={() => open(u)}>
              <div className="alert-main">
                <div className="alert-title">{u.title}</div>
                <div className="alert-when">
                  {fmtTime(u.item.kind !== 'follow' ? u.item.task.time : undefined)} · <b>{countdown(u.at - now)}</b>
                </div>
              </div>
              <button
                className="icon-btn"
                title="Done"
                onClick={(e) => {
                  e.stopPropagation();
                  setItemStatus(u.item, 'done');
                }}
              >
                <Check size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
