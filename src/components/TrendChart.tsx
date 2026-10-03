import { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import type { ISODate } from '../types';
import { useStore } from '../store';
import { fromISO, MONTHS } from '../lib/date';
import { computeTrend, type TrendPoint, type TrendRange } from '../lib/achievements';
import { cls } from '../lib/id';
import { Segmented } from './ui';

type SeriesKey = 'must' | 'should' | 'could' | 'left';
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'must', label: 'Must done' },
  { key: 'should', label: 'Should done' },
  { key: 'could', label: 'Could done' },
  { key: 'left', label: 'Left behind' },
];
const H = 220;
const PAD = { l: 30, r: 12, t: 12, b: 26 };

const md = (d: ISODate) => {
  const x = fromISO(d);
  return `${MONTHS[x.getMonth()]} ${x.getDate()}`;
};

/** Smooth line through the points that never overshoots (monotone cubic). */
function smooth(pts: [number, number][]): string {
  const n = pts.length;
  if (!n) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = (i: number) => pts[i + 1][0] - pts[i][0];
  const sl = pts.slice(0, -1).map((p, i) => (pts[i + 1][1] - p[1]) / dx(i));
  const m = pts.map((_, i) => (i === 0 ? sl[0] : i === n - 1 ? sl[n - 2] : sl[i - 1] * sl[i] <= 0 ? 0 : (sl[i - 1] + sl[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (sl[i] === 0) m[i] = m[i + 1] = 0;
    else {
      const a = m[i] / sl[i];
      const b = m[i + 1] / sl[i];
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * sl[i];
        m[i + 1] = t * b * sl[i];
      }
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx(i) / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + m[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - m[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

export function TrendChart({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [range, setRange] = useState<TrendRange>('3m');
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(600);
  const box = useRef<HTMLDivElement>(null);
  const { unit, points } = useMemo(() => computeTrend(entities, range, today), [entities, range, today]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = SERIES.filter((s) => !hidden.has(s.key));
  const max = Math.max(1, ...points.flatMap((p) => shown.map((s) => p[s.key])));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const iw = w - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length < 2 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / nice) * ih;
  const ticks = nice <= 4 ? Array.from({ length: nice + 1 }, (_, i) => i) : [0, 1, 2, 3, 4].map((i) => (i * nice) / 4);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))));
  const label = (p: TrendPoint) => (unit === 'month' ? `${MONTHS[fromISO(p.from).getMonth()]} ’${p.from.slice(2, 4)}` : md(p.from));

  const totals = points.reduce((a, p) => ({ done: a.done + p.must + p.should + p.could, left: a.left + p.left }), { done: 0, left: 0 });
  const rate = totals.done + totals.left ? Math.round((totals.done / (totals.done + totals.left)) * 100) : null;
  const toggle = (k: SeriesKey) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const hp = hover !== null ? points[hover] : null;
  return (
    <section className="dash-card trend">
      <div className="dash-head">
        <TrendingUp size={15} /> <b>Done vs. left behind</b>
        {rate !== null && (
          <span className="trend-rate" title="Of everything planned in this range, how much got done">
            {rate}% follow-through
          </span>
        )}
        <span className="spacer" />
        <Segmented
          className="tiny-seg"
          value={range}
          onChange={(r) => (setRange(r), setHover(null))}
          options={[
            { value: '2w', label: '2W' },
            { value: '1m', label: '1M' },
            { value: '3m', label: '3M' },
            { value: '6m', label: '6M' },
            { value: '1y', label: '1Y' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <div className="trend-legend">
        {SERIES.map((s) => (
          <button key={s.key} className={cls('tl-key', `k-${s.key}`, hidden.has(s.key) && 'off')} onClick={() => toggle(s.key)} title={hidden.has(s.key) ? 'Show' : 'Hide'}>
            <i />
            {s.label}
            <b>{points.reduce((a, p) => a + p[s.key], 0)}</b>
          </button>
        ))}
        <span className="muted tiny">per {unit}</span>
      </div>
      <div className="trend-box" ref={box} onMouseLeave={() => setHover(null)}>
        <svg
          width={w}
          height={H}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left - PAD.l) / iw) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}
        >
          <defs>
            <linearGradient id="tr-left" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#ec4899" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id="tr-reveal">
              <rect key={`${range}-${points.length}`} className="tr-reveal" x={0} y={0} width={w} height={H} />
            </clipPath>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line className="tr-grid" x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} />
              <text className="tr-axis" x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.from} className="tr-axis" x={x(i)} y={H - 8} textAnchor="middle">
                {label(p)}
              </text>
            ) : null,
          )}
          <g clipPath="url(#tr-reveal)">
            {!hidden.has('left') && (
              <>
                <path className="tr-area" d={`${smooth(points.map((p, i) => [x(i), y(p.left)]))} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} />
                <path className="tr-line k-left" d={smooth(points.map((p, i) => [x(i), y(p.left)]))} />
              </>
            )}
            {(['could', 'should', 'must'] as const)
              .filter((k) => !hidden.has(k))
              .map((k) => (
                <path key={k} className={cls('tr-line', `k-${k}`)} d={smooth(points.map((p, i) => [x(i), y(p[k])]))} />
              ))}
          </g>
          {hp && (
            <g>
              <line className="tr-cross" x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} />
              {shown.map((s) => (
                <circle key={s.key} className={cls('tr-dot', `k-${s.key}`)} cx={x(hover!)} cy={y(hp[s.key])} r={4} />
              ))}
            </g>
          )}
        </svg>
        {hp && (
          <div className={cls('tr-tip', x(hover!) > w * 0.62 && 'flip')} style={x(hover!) > w * 0.62 ? { right: w - x(hover!) + 14 } : { left: x(hover!) + 14 }}>
            <div className="tt-date">{unit === 'day' ? md(hp.from) : hp.from === hp.to ? md(hp.from) : `${md(hp.from)} – ${md(hp.to)}`}</div>
            {shown.map((s) => (
              <div key={s.key} className={cls('tt-row', `k-${s.key}`)}>
                <i />
                {s.label}
                <b>{hp[s.key]}</b>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
