import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarCheck, ChevronLeft, ChevronRight, Flame, FolderKanban, Moon, Pause, Play, RotateCcw, Sparkles, Sun, Sunrise, Sunset, Target, Trophy, Undo2,
} from 'lucide-react';
import type { Importance, ISODate, Task } from '../types';
import { S, useStore } from '../store';
import { diffDays, fmtDay, fromISO, startOfWeekMon, addDays, MONTHS } from '../lib/date';
import { computeStats, LEVELS, PERIOD_LABEL, type Period, type Stats, type Win } from '../lib/achievements';
import { effectiveLevel } from '../lib/priority';
import { cls } from '../lib/id';
import { Segmented } from './ui';

const SLIDE_MS = 6500;
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LEVEL_NAME: Record<Importance, string> = { must: 'Must', should: 'Should', could: 'Could' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Spotify-Wrapped-style recap of what got done, plus what's still waiting. */
export function Achievements({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [period, setPeriod] = useState<Period>('week');
  const stats = useMemo(() => computeStats(entities, period, today), [entities, period, today]);

  return (
    <div className="wins">
      <div className="wins-top">
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
            { value: 'year', label: `This year` },
          ]}
        />
        <span className="muted small">
          {fmtDay(stats.from, today)} – {fmtDay(stats.to, today)}
        </span>
      </div>
      <div className="wins-grid">
        <Story key={period} stats={stats} today={today} />
        <Dashboard stats={stats} today={today} />
      </div>
    </div>
  );
}

// ---------- the story ----------

interface Slide {
  id: string;
  theme: string;
  body: React.ReactNode;
}

function Story({ stats, today }: { stats: Stats; today: ISODate }) {
  const slides = useMemo(() => buildSlides(stats, today), [stats, today]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0); // bumps to replay
  const hold = useRef<{ t: number; timer?: number } | null>(null);
  const at = Math.min(i, slides.length - 1);
  const last = at === slides.length - 1;

  const go = (n: number) => setI(Math.max(0, Math.min(slides.length - 1, n)));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowRight') go(at + 1);
      else if (e.key === 'ArrowLeft') go(at - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else return;
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const slide = slides[at];
  return (
    <div
      className={cls('story', slide.theme, paused && 'paused')}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        hold.current = { t: Date.now(), timer: window.setTimeout(() => setPaused(true), 220) };
      }}
      onPointerUp={(e) => {
        const h = hold.current;
        hold.current = null;
        if (!h) return;
        clearTimeout(h.timer);
        if (Date.now() - h.t > 220) return setPaused(false); // that was a hold — just resume
        const r = e.currentTarget.getBoundingClientRect();
        go(e.clientX - r.left < r.width / 3 ? at - 1 : at + 1);
      }}
      onPointerLeave={() => hold.current && (clearTimeout(hold.current.timer), (hold.current = null), setPaused(false))}
    >
      <div className="story-bars">
        {slides.map((s, n) => (
          <span key={s.id} className={cls('sbar', n < at && 'past')}>
            {n === at && (
              <i
                key={`${run}-${at}`}
                className={cls(last && 'full')}
                style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                onAnimationEnd={() => !last && go(at + 1)}
              />
            )}
          </span>
        ))}
      </div>
      <div className="story-ctl">
        <span className="story-count">
          {at + 1} / {slides.length}
        </span>
        <span className="spacer" />
        <button className="story-btn" title={paused ? 'Play (Space)' : 'Pause (Space) — or press and hold'} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
      <div className="story-slide" key={`${run}-${slide.id}`}>
        {slide.body}
      </div>
      {last && slides.length > 1 && (
        <button
          className="story-replay"
          onClick={() => {
            setRun((r) => r + 1);
            setI(0);
            setPaused(false);
          }}
        >
          <RotateCcw size={14} /> Replay
        </button>
      )}
      <div className="story-nav">
        <button className="story-btn" disabled={at === 0} onClick={() => go(at - 1)} title="Previous (←)">
          <ChevronLeft size={16} />
        </button>
        <button className="story-btn" disabled={last} onClick={() => go(at + 1)} title="Next (→)">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

/** Staggered entrance: <R d={2}> appears a beat after <R d={1}>. */
function R({ d = 0, className, children }: { d?: number; className?: string; children: React.ReactNode }) {
  return (
    <div className={cls('rise', className)} style={{ '--d': `${200 + d * 260}ms` } as React.CSSProperties}>
      {children}
    </div>
  );
}

function CountUp({ to, delay = 300, ms = 1100 }: { to: number; delay?: number; ms?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setN(to);
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - start) / ms));
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, delay, ms]);
  return <>{n.toLocaleString()}</>;
}

function delta(stats: Stats) {
  const total = stats.wins.length;
  const prev = stats.prevTotal;
  const label = PERIOD_LABEL[stats.period].prev;
  if (!prev) return total ? `Up from zero ${label}` : null;
  const pct = Math.round(((total - prev) / prev) * 100);
  if (pct === 0) return `Same as ${label}`;
  return `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}% vs ${label}`;
}

function buildSlides(s: Stats, today: ISODate): Slide[] {
  const total = s.wins.length;
  const now = PERIOD_LABEL[s.period].now;
  const slides: Slide[] = [];

  if (!total) {
    slides.push({
      id: 'empty',
      theme: 'g-intro',
      body: (
        <>
          <R className="s-kicker">{now}</R>
          <R d={1} className="s-huge">0</R>
          <R d={2} className="s-big">things ticked off — yet.</R>
          <R d={3} className="s-sub">The first one is the hardest. Pick a Must and knock it out.</R>
        </>
      ),
    });
    slides.push(plateSlide(s, today));
    return slides;
  }

  const d = delta(s);
  slides.push({
    id: 'intro',
    theme: 'g-intro',
    body: (
      <>
        <R className="s-kicker">{now}, you got</R>
        <R d={1} className="s-huge">
          <CountUp to={total} delay={500} />
        </R>
        <R d={2} className="s-big">{total === 1 ? 'thing done.' : 'things done.'}</R>
        {d && (
          <R d={4}>
            <span className={cls('s-pill', d.startsWith('↓') && 'down')}>{d}</span>
          </R>
        )}
        <R d={5} className="s-sub">
          Across {plural(s.activeDays, 'day')}. Let’s look closer.
        </R>
      </>
    ),
  });

  const max = Math.max(...LEVELS.map((l) => s.byLevel[l]), 1);
  const mustShare = s.byLevel.must / total;
  slides.push({
    id: 'levels',
    theme: 'g-must',
    body: (
      <>
        <R className="s-kicker">What mattered</R>
        <R d={1} className="s-big">
          {s.byLevel.must ? (
            <>
              <b className="hl">{s.byLevel.must}</b> of them {s.byLevel.must === 1 ? 'was a' : 'were'} <i>Must{s.byLevel.must === 1 ? '' : 's'}</i>.
            </>
          ) : (
            <>No Musts this time — all bonus points.</>
          )}
        </R>
        <div className="s-levels">
          {LEVELS.map((l, n) => (
            <R key={l} d={2 + n * 0.6} className="s-level">
              <span className="sl-name">{LEVEL_NAME[l]}</span>
              <span className="sl-track">
                <span className={cls('sl-fill', `lvl-${l}`)} style={{ '--w': `${(s.byLevel[l] / max) * 100}%`, '--d': `${700 + n * 160}ms` } as React.CSSProperties} />
              </span>
              <span className="sl-n">
                <CountUp to={s.byLevel[l]} delay={700 + n * 160} ms={900} />
              </span>
            </R>
          ))}
        </div>
        <R d={4.5} className="s-sub">
          {mustShare >= 0.5
            ? 'You spent your energy where it counted.'
            : s.byLevel.could > s.byLevel.must + s.byLevel.should
              ? 'Plenty of nice-to-haves. Make sure the Musts get their turn too.'
              : 'A healthy mix of the important and the useful.'}
        </R>
      </>
    ),
  });

  if (s.busiest && total >= 3) {
    const wdMax = Math.max(...s.byWeekday, 1);
    const bestWd = s.byWeekday.indexOf(Math.max(...s.byWeekday));
    const ChronoIcon = { morning: Sunrise, afternoon: Sun, evening: Sunset, night: Moon }[s.chronotype?.kind ?? 'afternoon'];
    const chrono = s.chronotype && {
      morning: ['Early bird', 'before noon'],
      afternoon: ['Afternoon closer', 'between noon and 5'],
      evening: ['Evening finisher', 'between 5 and 10pm'],
      night: ['Night owl', 'after 10pm'],
    }[s.chronotype.kind];
    slides.push({
      id: 'rhythm',
      theme: 'g-rhythm',
      body: (
        <>
          <R className="s-kicker">Your rhythm</R>
          {s.period === 'week' ? (
            <R d={1} className="s-big">
              Your biggest day was <b className="hl">{DAY_NAMES[(fromISO(s.busiest.date).getDay() + 6) % 7]}</b> — {plural(s.busiest.count, 'thing')} done.
            </R>
          ) : (
            <R d={1} className="s-big">
              <b className="hl">{DAY_NAMES[bestWd]}s</b> are your power days.
            </R>
          )}
          <R d={2} className="s-week">
            {s.byWeekday.map((n, k) => (
              <span key={k} className={cls('sw-col', k === bestWd && 'best')}>
                <span className="sw-bar" style={{ '--h': `${Math.max(4, (n / wdMax) * 100)}%`, '--d': `${700 + k * 70}ms` } as React.CSSProperties} />
                <span className="sw-n">{n || ''}</span>
                <span className="sw-day">{DAY_NAMES[k].slice(0, 1)}</span>
              </span>
            ))}
          </R>
          {chrono && (
            <R d={3.5} className="s-chrono">
              <ChronoIcon size={22} />
              <span>
                <b>{chrono[0]}.</b> {Math.round(s.chronotype!.share * 100)}% of your wins landed {chrono[1]}.
              </span>
            </R>
          )}
          {s.period !== 'week' && (
            <R d={4.5} className="s-sub">
              Best single day: {fmtDay(s.busiest.date, today)}, with {plural(s.busiest.count, 'win')}.
            </R>
          )}
        </>
      ),
    });
  }

  if (s.longestStreak >= 2) {
    slides.push({
      id: 'streak',
      theme: 'g-streak',
      body: (
        <>
          <R className="s-kicker">
            <Flame size={14} /> On a roll
          </R>
          <R d={1} className="s-huge">
            <CountUp to={s.longestStreak} delay={500} ms={800} />
          </R>
          <R d={2} className="s-big">days in a row with something done.</R>
          <R d={3}>
            <Heatmap stats={s} today={today} />
          </R>
          <R d={4} className="s-sub">
            {s.currentStreak >= 2
              ? `You’re on day ${s.currentStreak} of a streak right now. Keep it alive.`
              : s.perDay[today]
                ? 'Today’s already on the board.'
                : 'One thing today starts a new streak.'}
          </R>
        </>
      ),
    });
  }

  if (s.habits.length) {
    const top = s.habits[0];
    slides.push({
      id: 'habits',
      theme: 'g-habit',
      body: (
        <>
          <R className="s-kicker">Showing up</R>
          <R d={1} className="s-big">
            You showed up for <b className="hl">{top.title}</b> {top.done === 1 ? 'once' : `${top.done} times`}.
          </R>
          <div className="s-habits">
            {s.habits.slice(0, 3).map((h, n) => (
              <R key={h.id} d={2 + n * 0.6} className="s-habit">
                <Ring pct={h.scheduled ? h.done / h.scheduled : 0} delay={800 + n * 200} />
                <span className="sh-name">{h.title}</span>
                <span className="sh-n">
                  {h.done}/{h.scheduled}
                </span>
              </R>
            ))}
          </div>
          <R d={4.5} className="s-sub">
            {top.done >= top.scheduled ? 'A perfect record. That’s how habits stick.' : 'Every repeat counts — the missed days don’t erase the ones you did.'}
          </R>
        </>
      ),
    });
  }

  if (s.comeback) {
    slides.push({
      id: 'comeback',
      theme: 'g-comeback',
      body: (
        <>
          <R className="s-kicker">
            <Undo2 size={14} /> The comeback
          </R>
          <R d={1} className="s-big">
            <b className="hl">“{s.comeback.title}”</b>
          </R>
          <R d={2} className="s-mid">
            Pushed for <CountUp to={s.comeback.carried} delay={900} ms={900} /> days.
          </R>
          <R d={3} className="s-mid">And then you just… did it.</R>
          <R d={4} className="s-sub">Done {fmtDay(s.comeback.date, today)}. The things we put off are usually the ones that feel best to finish.</R>
        </>
      ),
    });
  }

  if (s.projects.length) {
    const steps = s.projects.reduce((a, p) => a + p.steps, 0);
    slides.push({
      id: 'projects',
      theme: 'g-proj',
      body: (
        <>
          <R className="s-kicker">
            <FolderKanban size={14} /> Bigger things
          </R>
          <R d={1} className="s-big">
            You moved <b className="hl">{plural(s.projects.length, 'project')}</b> forward, {plural(steps, 'step')} in all.
          </R>
          <div className="s-projects">
            {s.projects.slice(0, 4).map((p, n) => (
              <R key={p.project.id} d={2 + n * 0.5} className="s-proj">
                <span className="dot" style={{ background: p.project.color }} />
                <span className="sp-name">{p.project.title}</span>
                {p.finished && <span className="sp-done">Finished</span>}
                <span className="sp-n">{plural(p.steps, 'step')}</span>
              </R>
            ))}
          </div>
        </>
      ),
    });
  }

  slides.push(plateSlide(s, today));

  const topHabit = s.habits[0];
  slides.push({
    id: 'outro',
    theme: 'g-outro',
    body: (
      <>
        <R className="s-kicker">
          <Trophy size={14} /> {now}, in short
        </R>
        <div className="s-card">
          <R d={1} className="sc-tile big">
            <b>{total}</b>
            <span>things done</span>
          </R>
          <R d={1.5} className="sc-tile must">
            <b>{s.byLevel.must}</b>
            <span>Musts</span>
          </R>
          <R d={2} className="sc-tile">
            <b>{s.longestStreak}</b>
            <span>day best streak</span>
          </R>
          <R d={2.5} className="sc-tile">
            <b>
              {s.activeDays}
              <small>/{s.days.length}</small>
            </b>
            <span>active days</span>
          </R>
          {topHabit && (
            <R d={3} className="sc-tile wide">
              <span>Top habit</span>
              <b className="sc-text">{topHabit.title}</b>
            </R>
          )}
          {s.busiest && (
            <R d={3.3} className="sc-tile wide">
              <span>Biggest day</span>
              <b className="sc-text">
                {fmtDay(s.busiest.date, today)} · {s.busiest.count}
              </b>
            </R>
          )}
        </div>
      </>
    ),
  });
  return slides;
}

function plateSlide(s: Stats, today: ISODate): Slide {
  const left = s.left;
  const openTotal = LEVELS.reduce((a, l) => a + left.byLevel[l], 0);
  return {
    id: 'plate',
    theme: 'g-plate',
    body: (
      <>
        <R className="s-kicker">
          <Target size={14} /> Still on your plate
        </R>
        {openTotal ? (
          <R d={1} className="s-big">
            <b className="hl">{openTotal}</b> {openTotal === 1 ? 'thing is' : 'things are'} waiting on you.
          </R>
        ) : (
          <R d={1} className="s-big">Nothing overdue. Your plate is clear.</R>
        )}
        {openTotal > 0 && (
          <R d={2} className="s-plate">
            {LEVELS.map((l) => (
              <span key={l} className={cls('sp-lvl', `lvl-${l}`)}>
                <b>{left.byLevel[l]}</b>
                {LEVEL_NAME[l]}
              </span>
            ))}
          </R>
        )}
        {left.overdue.slice(0, 3).map((t, n) => (
          <R key={t.id} d={3 + n * 0.4} className="s-left">
            <span className={cls('si-dot', `lvl-${effectiveLevel(t, today).level}`)} />
            <span className="sl-title">{t.title}</span>
            <span className="sl-age">{age(t, today)}</span>
          </R>
        ))}
        <R d={4.5} className="s-sub">
          {left.inbox ? `Plus ${plural(left.inbox, 'note')} on the sticky. ` : ''}
          {left.nextMusts.length ? `${plural(left.nextMusts.length, 'Must')} coming up this week.` : ''}
        </R>
        {(openTotal > 0 || left.inbox > 0) && (
          <R d={5}>
            <button className="story-cta" onClick={() => S().setUI({ planOpen: true })}>
              <Sparkles size={14} /> Plan them now
            </button>
          </R>
        )}
      </>
    ),
  };
}

function age(t: Task, today: ISODate) {
  const since = t.firstScheduled ?? t.date!;
  const n = diffDays(since, today);
  return n <= 0 ? 'today' : `${n}d`;
}

function Ring({ pct, delay }: { pct: number; delay: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="38" height="38" viewBox="0 0 38 38">
      <circle cx="19" cy="19" r={r} className="ring-bg" />
      <circle
        cx="19"
        cy="19"
        r={r}
        className="ring-fg"
        style={{ strokeDasharray: c, '--off': c * (1 - pct), '--c': c, animationDelay: `${delay}ms` } as React.CSSProperties}
      />
      <text x="19" y="23" textAnchor="middle">
        {Math.round(pct * 100)}
      </text>
    </svg>
  );
}

/** Week/month: a little calendar. Year: a GitHub-style strip of weeks. */
function Heatmap({ stats, today }: { stats: Stats; today: ISODate }) {
  const max = Math.max(...Object.values(stats.perDay), 1);
  const first = startOfWeekMon(stats.from);
  const cells: { d: ISODate; n: number; out: boolean }[] = [];
  for (let d = first; d <= stats.to || diffDays(first, d) % 7 !== 0; d = addDays(d, 1))
    cells.push({ d, n: stats.perDay[d] ?? 0, out: d < stats.from || d > stats.to });
  const lvl = (n: number) => (n ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
  const year = stats.period === 'year';
  return (
    <div className={cls('heat', year ? 'heat-year' : 'heat-cal')}>
      {cells.map((c) => (
        <span key={c.d} className={cls('hc', `h${lvl(c.n)}`, c.out && 'out', c.d === today && 'today')} title={c.out ? undefined : `${fmtDay(c.d, today)}: ${c.n}`} />
      ))}
    </div>
  );
}

// ---------- the dashboard beside it ----------

function Dashboard({ stats, today }: { stats: Stats; today: ISODate }) {
  const [filter, setFilter] = useState<Importance | 'all'>('all');
  const open = (id: string) => S().setUI({ selectedId: id, occDate: undefined });
  const total = stats.wins.length;
  const d = delta(stats);
  const wins = [...stats.wins].reverse().filter((w) => filter === 'all' || w.importance === filter);
  const left = stats.left;

  return (
    <div className="dash">
      <div className="dash-tiles">
        <Tile label="Done" value={total} sub={d ?? undefined} icon={<CalendarCheck size={15} />} />
        <Tile label="Musts done" value={stats.byLevel.must} sub={total ? `${Math.round((stats.byLevel.must / total) * 100)}% of everything` : undefined} tone="must" />
        <Tile label="Best streak" value={stats.longestStreak} sub={stats.currentStreak ? `${stats.currentStreak} right now` : 'days in a row'} icon={<Flame size={15} />} />
        <Tile label="Active days" value={stats.activeDays} sub={`of ${stats.days.length}`} />
      </div>

      <section className="dash-card">
        <div className="dash-head">
          <Target size={15} /> <b>Still on your plate</b>
          <span className="spacer" />
          {LEVELS.map((l) => (
            <span key={l} className={cls('mini-lvl', `lvl-${l}`)} title={`${LEVEL_NAME[l]}s waiting`}>
              {left.byLevel[l]}
            </span>
          ))}
        </div>
        {left.overdue.length ? (
          <ul className="dash-list">
            {left.overdue.slice(0, 8).map((t) => (
              <li key={t.id} onClick={() => open(t.id)}>
                <span className={cls('si-dot', `lvl-${effectiveLevel(t, today).level}`)} />
                <span className="dl-title">{t.title}</span>
                <span className="dl-meta">{t.date === today && !t.firstScheduled ? 'today' : `waiting ${age(t, today)}`}</span>
              </li>
            ))}
            {left.overdue.length > 8 && <li className="dl-more">…and {left.overdue.length - 8} more</li>}
          </ul>
        ) : (
          <div className="dash-empty">Nothing overdue — nice.</div>
        )}
        <div className="dash-foot">
          {left.inbox > 0 && <span>{plural(left.inbox, 'note')} on the sticky</span>}
          {left.nextMusts.length > 0 && (
            <span>
              Next Must: <a onClick={() => open(left.nextMusts[0].id)}>{left.nextMusts[0].title}</a> · {fmtDay(left.nextMusts[0].date!, today)}
            </span>
          )}
          <span className="spacer" />
          {(left.overdue.length > 0 || left.inbox > 0) && (
            <button className="btn tiny" onClick={() => S().setUI({ planOpen: true })}>
              <Sparkles size={12} /> Plan them
            </button>
          )}
        </div>
      </section>

      <section className="dash-card">
        <div className="dash-head">
          <Trophy size={15} /> <b>Wall of wins</b>
          <span className="spacer" />
          <Segmented
            className="tiny-seg"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${total}` },
              ...LEVELS.map((l) => ({ value: l, label: `${LEVEL_NAME[l]} ${stats.byLevel[l]}`, className: `imp-${l}` })),
            ]}
          />
        </div>
        {wins.length ? (
          <ul className="dash-list wins-list">
            {groupByDay(wins.slice(0, 120)).map(([day, ws]) => (
              <li key={day} className="wl-day">
                <span className="wl-date">{dayLabel(day, today)}</span>
                <span className="wl-items">
                  {ws.map((w) => (
                    <span key={w.key} className={cls('wl-chip', `lvl-${w.importance}`)} onClick={() => open(w.key.split('|')[0])} title={w.carried >= 3 ? `Pushed ${w.carried} days first` : undefined}>
                      {w.title}
                      {w.carried >= 3 && <i>↺{w.carried}d</i>}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dash-empty">{total ? 'None at this level.' : 'Tick something off and it shows up here.'}</div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, sub, icon, tone }: { label: string; value: number; sub?: string; icon?: React.ReactNode; tone?: string }) {
  return (
    <div className={cls('tile', tone && `tone-${tone}`)}>
      <div className="tile-label">
        {icon} {label}
      </div>
      <div className="tile-value">
        <CountUp to={value} delay={0} ms={700} />
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

function groupByDay(ws: Win[]): [ISODate, Win[]][] {
  const m = new Map<ISODate, Win[]>();
  for (const w of ws) m.set(w.date, [...(m.get(w.date) ?? []), w]);
  return [...m];
}

function dayLabel(d: ISODate, today: ISODate) {
  const n = diffDays(d, today);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  const x = fromISO(d);
  return n < 7 ? DAY_NAMES[(x.getDay() + 6) % 7].slice(0, 3) : `${MONTHS[x.getMonth()]} ${x.getDate()}`;
}
