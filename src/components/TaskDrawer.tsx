import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleDot, Copy, FolderTree, History, NotebookPen, RefreshCw, Repeat, Sparkles, Trash2, X } from 'lucide-react';
import type { ISODate, Importance, Recurrence, Status, Task } from '../types';
import { S, useStore } from '../store';
import { addDays, addMonths, fmtDay, fmtTime, localDateTime, nextMonday, parseLocalDateTime, relDay } from '../lib/date';
import { describeRecurrence, numberedTitle } from '../lib/recurrence';
import { effectiveLevel, IMPORTANCE_HELP } from '../lib/priority';
import { cls } from '../lib/id';
import { requestDelete, duplicateTask, getTask, projects, restoreVersion, setItemStatus, tasks, updateTask } from '../actions';
import { Field, Segmented } from './ui';
import { cancelAsk, enqueueAsk, hasQuestion, llmReady } from '../lib/llm';

export function TaskDrawer({ today }: { today: ISODate }) {
  const selectedId = useStore((s) => s.ui.selectedId);
  const occDate = useStore((s) => s.ui.occDate);
  const t = useStore((s) => (selectedId ? s.entities[selectedId] : undefined));
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) S().setUI({ selectedId: undefined });
    };
    // clicking anywhere that isn't the panel, a card, or a popup closes it
    const away = (e: MouseEvent) => {
      if (!S().ui.selectedId || !(e.target instanceof Element)) return;
      if (e.target.closest('.drawer, [data-card], .sticky-item, .node, .menu, .modal-bg, .toast, .sel-bar')) return;
      S().setUI({ selectedId: undefined, occDate: undefined });
    };
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', away);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', away);
    };
  }, []);
  if (!t || t.type !== 'task' || t.deleted) return null;
  return <DrawerBody key={t.id} t={t} occDate={occDate} today={today} />;
}

function DrawerBody({ t, occDate, today }: { t: Task; occDate?: ISODate; today: ISODate }) {
  const [title, setTitle] = useState(t.title);
  const [notes, setNotes] = useState(t.notes ?? '');
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => setTitle(t.title), [t.title]);
  useEffect(() => setNotes(t.notes ?? ''), [t.notes]);
  const up = (patch: Partial<Task>, label?: string) => updateTask(t.id, patch, label);
  const close = () => S().setUI({ selectedId: undefined, occDate: undefined });
  const eff = effectiveLevel(t, today);
  const rawOcc = occDate ? t.completions?.[occDate] : undefined;
  const occState = rawOcc === 'deleted' || rawOcc === 'moved' ? undefined : rawOcc;

  const where = t.recurrence ? 'Repeating' : t.projectId ? 'Project step' : t.date ? relDay(t.date, today) : 'On the sticky';

  return (
    <aside className="drawer">
      <div className="dw-scroll">
        <div className="dw-top">
          <span className={cls('dw-where', `lvl-${eff.level}`)}>
            <span className={cls('lvl-dot', `lvl-${eff.level}`)} />
            {where}
            {t.date && !t.recurrence && <span className="muted"> · {fmtDay(t.date, today)}</span>}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Close (Esc)" onClick={close}>
            <X size={16} />
          </button>
        </div>

        <textarea
          className="drawer-title"
          value={title}
          rows={Math.max(1, Math.ceil(title.length / 30))}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() !== t.title && up({ title: title.trim() }, `Renamed “${t.title}”`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          placeholder="What needs doing?"
        />

        <AiBox t={t} />

        {occDate && t.recurrence && (
          <Section icon={<Repeat size={14} />} title={`This day · ${fmtDay(occDate, today)}`}>
            <Segmented<'open' | 'done' | 'dropped'>
              className="full"
              value={occState ?? 'open'}
              onChange={(v) => setItemStatus({ kind: 'occ', key: '', task: t, date: occDate, state: occState }, v)}
              options={[
                { value: 'open', label: 'To do' },
                { value: 'done', label: 'Done', className: 'g' },
                { value: 'dropped', label: 'Skip', className: 'x' },
              ]}
            />
          </Section>
        )}

        <Section icon={<CircleDot size={14} />} title="Status & priority">
          {!t.recurrence && (
            <Segmented<Status>
              className="full"
              value={t.status}
              onChange={(status) => up({ status }, `Status of “${t.title}” → ${status}`)}
              options={[
                { value: 'open', label: 'To do' },
                { value: 'doing', label: 'Doing' },
                { value: 'waiting', label: 'Waiting', title: 'Ball is in someone else’s court' },
                { value: 'done', label: 'Done', className: 'g' },
                { value: 'dropped', label: 'Obsolete', className: 'x' },
              ]}
            />
          )}
          <div className="sub-label">If this slips a week…</div>
          <div className="imp-pick">
            {(['could', 'should', 'must'] as Importance[]).map((k, i) => (
              <button key={k} className={cls(`ip-${k}`, t.importance === k && 'on')} onClick={() => up({ importance: k }, `“${t.title}” → ${k}`)} title={IMPORTANCE_HELP[k].hint}>
                <span className="bars">
                  {[0, 1, 2].map((j) => (
                    <i key={j} className={cls(j <= i && 'on')} />
                  ))}
                </span>
                {IMPORTANCE_HELP[k].label}
              </button>
            ))}
          </div>
          <div className="field-hint">
            {eff.reason ? <span className="urgent-text">Showing as {eff.level} because it’s {eff.reason}.</span> : IMPORTANCE_HELP[t.importance].hint}
          </div>
        </Section>

        <Section
          icon={<CalendarDays size={14} />}
          title="When"
          action={
            t.date && !t.recurrence ? (
              <button className="link-btn" title="Move it back to the sticky" onClick={() => up({ date: null }, `Unscheduled “${t.title}”`)}>
                Unschedule
              </button>
            ) : undefined
          }
        >
          <div className="row2">
            <Field label={t.recurrence ? 'Starts' : 'Day'}>
              <input type="date" value={t.date ?? ''} onChange={(e) => up({ date: e.target.value || null })} />
            </Field>
            <Field label="Time">
              <input type="time" value={t.time ?? ''} onChange={(e) => up({ time: e.target.value || undefined })} />
            </Field>
          </div>
          {!t.recurrence && (
            <div className="chip-row">
              {[
                ['Today', today],
                ['Tomorrow', addDays(today, 1)],
                ['Next week', nextMonday(today)],
                ['+1 month', addMonths(t.date ?? today, 1)],
                ['+6 months', addMonths(t.date ?? today, 6)],
              ].map(([l, d]) => (
                <button key={l} className={cls('chip-btn', t.date === d && 'on')} onClick={() => up({ date: d })}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="divider" />
          <RepeatField t={t} today={today} occDate={occDate} />
          <div className="row2">
            <Field label="Hard deadline" hint={t.deadline ? relDay(t.deadline, today) : 'Escalates colour as it nears'}>
              <div className="input-clear">
                <input type="date" value={t.deadline ?? ''} onChange={(e) => up({ deadline: e.target.value || undefined })} />
                {t.deadline && (
                  <button className="icon-btn" title="Clear deadline" onClick={() => up({ deadline: undefined })}>
                    <X size={12} />
                  </button>
                )}
              </div>
            </Field>
            <ReminderField t={t} />
          </div>
        </Section>

        <Section icon={<FolderTree size={14} />} title="Project">
          <ProjectField t={t} />
        </Section>

        <Section icon={<NotebookPen size={14} />} title="Notes">
          <textarea
            className="notes"
            rows={4}
            placeholder="Details, links, phone numbers…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (t.notes ?? '') && up({ notes: notes || undefined }, `Edited notes of “${t.title}”`)}
          />
        </Section>

        {showHistory && (
          <Section icon={<History size={14} />} title="Versions">
            <ItemHistory id={t.id} />
          </Section>
        )}
      </div>

      <div className="drawer-foot">
        <button className={cls('btn', showHistory && 'on')} onClick={() => setShowHistory((x) => !x)}>
          <History size={14} /> Versions
        </button>
        <button className="btn" onClick={() => duplicateTask(t.id)}>
          <Copy size={14} /> Duplicate
        </button>
        <span className="spacer" />
        <button className="btn danger-outline" onClick={() => requestDelete(t.id, occDate)}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </aside>
  );
}

function Section({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="dsec">
      <div className="dsec-head">
        {icon}
        <span>{title}</span>
        <span className="spacer" />
        {action}
      </div>
      {children}
    </section>
  );
}

function ReminderField({ t }: { t: Task }) {
  const base = t.date ? parseLocalDateTime(`${t.date}T${t.time ?? '09:00'}`) : null;
  const presets: [string, string, () => string | undefined][] = [
    ['none', 'No reminder', () => undefined],
    ...(base && t.time ? ([['10m', '10 min before', () => shift(base, { min: -10 })]] as [string, string, () => string][]) : []),
    ...(base
      ? ([
          ['1d', 'Day before, 9am', () => at9(base, -1)],
          ['1w', 'Week before', () => at9(base, -7)],
          ['2w', '2 weeks before', () => at9(base, -14)],
          ['1mo', 'Month before', () => at9(base, -30)],
        ] as [string, string, () => string][])
      : []),
  ];
  const current = presets.find(([, , f]) => f() === t.remindAt)?.[0] ?? (t.remindAt ? 'custom' : 'none');
  return (
    <Field label="Remind me" hint={t.remindAt ? `${t.remindFired ? 'Sent' : 'Notifies'} ${fmtDay(t.remindAt.slice(0, 10))} ${fmtTime(t.remindAt.slice(11))}` : 'Desktop notification'}>
      <div className="inline">
        <select
          value={current}
          onChange={(e) => {
            const p = presets.find(([k]) => k === e.target.value);
            if (p) updateTask(t.id, { remindAt: p[2]() });
            else updateTask(t.id, { remindAt: t.remindAt ?? localDateTime(new Date(Date.now() + 3600000)) });
          }}
        >
          {presets.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {current === 'custom' && <input type="datetime-local" value={t.remindAt ?? ''} onChange={(e) => updateTask(t.id, { remindAt: e.target.value || undefined })} />}
      </div>
    </Field>
  );
}
function shift(d: Date, { min = 0 }) {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() + min);
  return localDateTime(x);
}
function at9(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  x.setHours(9, 0, 0, 0);
  return localDateTime(x);
}

type RepeatKey = 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom';
function repeatKey(r?: Recurrence): RepeatKey {
  if (!r) return 'none';
  const wd = r.byWeekday ?? [];
  if (r.until) return 'custom';
  if (r.freq === 'daily' && r.interval === 1) return 'daily';
  if (r.freq === 'weekly' && r.interval === 1 && wd.length === 5 && [1, 2, 3, 4, 5].every((x) => wd.includes(x))) return 'weekdays';
  if (r.freq === 'weekly' && wd.length <= 1) return r.interval === 1 ? 'weekly' : r.interval === 2 ? 'biweekly' : 'custom';
  if (r.freq === 'monthly' && r.interval === 1) return 'monthly';
  if (r.freq === 'yearly' && r.interval === 1) return 'yearly';
  return 'custom';
}

function RepeatField({ t, today, occDate }: { t: Task; today: ISODate; occDate?: ISODate }) {
  const key = repeatKey(t.recurrence);
  const [custom, setCustom] = useState(key === 'custom');
  const set = (recurrence: Recurrence | undefined) =>
    updateTask(t.id, { recurrence, ...(recurrence && !t.date ? { date: today } : {}) }, recurrence ? `Set “${t.title}” to repeat` : `Stopped repeating “${t.title}”`);
  const r = t.recurrence;
  return (
    <Field label="Repeat" hint={r && t.date ? describeRecurrence(r, t.date) : 'Bills, meds, classes, check-ins…'}>
      <select
        value={custom ? 'custom' : key}
        onChange={(e) => {
          const v = e.target.value as RepeatKey;
          setCustom(v === 'custom');
          const map: Partial<Record<RepeatKey, Recurrence | undefined>> = {
            none: undefined,
            daily: { freq: 'daily', interval: 1 },
            weekdays: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
            weekly: { freq: 'weekly', interval: 1 },
            biweekly: { freq: 'weekly', interval: 2 },
            monthly: { freq: 'monthly', interval: 1 },
            yearly: { freq: 'yearly', interval: 1 },
          };
          if (v !== 'custom') set(map[v]);
          else if (!r) set({ freq: 'weekly', interval: 1 });
        }}
      >
        <option value="none">Doesn’t repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Every weekday</option>
        <option value="weekly">Every week</option>
        <option value="biweekly">Every 2 weeks</option>
        <option value="monthly">Every month</option>
        <option value="yearly">Every year</option>
        <option value="custom">Custom…</option>
      </select>
      {custom && r && (
        <div className="repeat-custom">
          <span>Every</span>
          <input type="number" min={1} max={99} value={r.interval} onChange={(e) => set({ ...r, interval: Math.max(1, Number(e.target.value) || 1) })} />
          <select value={r.freq} onChange={(e) => set({ ...r, freq: e.target.value as Recurrence['freq'] })}>
            <option value="daily">day(s)</option>
            <option value="weekly">week(s)</option>
            <option value="monthly">month(s)</option>
            <option value="yearly">year(s)</option>
          </select>
          {r.freq === 'weekly' && (
            <div className="wd-chips">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((l, i) => {
                const on = (r.byWeekday ?? []).includes(i);
                return (
                  <button key={i} className={cls(on && 'on')} onClick={() => set({ ...r, byWeekday: on ? (r.byWeekday ?? []).filter((x) => x !== i) : [...(r.byWeekday ?? []), i].sort() })}>
                    {l}
                  </button>
                );
              })}
            </div>
          )}
          <span>until</span>
          <input type="date" value={r.until ?? ''} onChange={(e) => set({ ...r, until: e.target.value || undefined })} />
        </div>
      )}
      {r && <NumberingControls t={t} occDate={occDate} />}
    </Field>
  );
}

/** "Spanish L#" → L1, L2, L3… on each repeat; "Vitamin D #" from 42 → Vitamin D 42, 43… */
function NumberingControls({ t, occDate }: { t: Task; occDate?: ISODate }) {
  const on = !!t.numbering;
  const start = t.numbering?.start ?? 1;
  const sample = occDate ?? t.date!;
  return (
    <div className={cls('numbering', on && 'on')}>
      <label className="check-row small">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => updateTask(t.id, { numbering: e.target.checked ? { start: 1 } : undefined }, e.target.checked ? `Numbered “${t.title}”` : `Stopped numbering “${t.title}”`)}
        />
        <span>
          <b>Number each one</b> — lesson 1, 2, 3… or day 42, 43, 44…
        </span>
      </label>
      {on && (
        <>
          <div className="inline">
            <span className="small">First one is #</span>
            <input
              type="number"
              min={0}
              className="num-start"
              value={start}
              onChange={(e) => updateTask(t.id, { numbering: { start: Math.max(0, Number(e.target.value) || 0) } }, `Numbering of “${t.title}” starts at ${e.target.value}`)}
            />
            <span className="small muted">
              {fmtDay(sample)} shows as <b>“{numberedTitle(t, sample)}”</b>
            </span>
          </div>
          <div className="field-hint">
            {t.title.includes('#') ? 'The # in the title is replaced by the number.' : 'Tip: put # in the title where the number goes (e.g. “Spanish L#”) — otherwise it’s added at the end.'}{' '}
            Deleted days don’t use up a number; skipped and moved ones keep theirs.
          </div>
        </>
      )}
    </div>
  );
}

function ProjectField({ t }: { t: Task }) {
  const entities = useStore((s) => s.entities);
  const ps = useMemo(() => projects(), [entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const siblings = useMemo(() => {
    if (!t.projectId) return [];
    const all = tasks().filter((x) => x.projectId === t.projectId && x.id !== t.id);
    // exclude descendants so the tree can't loop
    const desc = new Set<string>([t.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of all) if (x.parentId && desc.has(x.parentId) && !desc.has(x.id)) (desc.add(x.id), (grew = true));
    }
    return all.filter((x) => !desc.has(x.id));
  }, [t.projectId, t.id, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="row2">
      <Field label="Belongs to">
        <select value={t.projectId ?? ''} onChange={(e) => updateTask(t.id, { projectId: e.target.value || undefined, parentId: null })}>
          <option value="">—</option>
          {ps.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </Field>
      {t.projectId && (
        <Field label="Comes after">
          <select value={t.parentId ?? ''} onChange={(e) => updateTask(t.id, { parentId: e.target.value || null })}>
            <option value="">(start)</option>
            {siblings.map((x) => (
              <option key={x.id} value={x.id}>{x.title || 'Untitled'}</option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

function ItemHistory({ id }: { id: string }) {
  const history = useStore((s) => s.history);
  const entries = useMemo(() => history.filter((h) => h.id === id), [history, id]);
  const current = getTask(id);
  return (
    <div className="item-history">
      <p className="small muted">Every change is kept. Restoring a version only touches this item — nothing else is rolled back.</p>
      {entries.map((h, i) => (
        <div key={h.hid} className="ih-row">
          <div>
            <div className="small">{h.label}</div>
            <div className="tiny muted">
              {new Date(h.ts).toLocaleString()} · {h.source === 'remote' ? `from ${h.device ?? 'another device'}` : h.device}
            </div>
          </div>
          {i > 0 || h.after.updatedAt !== current?.updatedAt ? (
            <button className="btn tiny" onClick={() => restoreVersion(h.after)}>Restore this</button>
          ) : (
            <span className="tiny muted">current</span>
          )}
        </div>
      ))}
      {entries.length > 0 && entries[entries.length - 1].before && (
        <div className="ih-row">
          <div className="small muted">Original (before tracked changes)</div>
          <button className="btn tiny" onClick={() => restoreVersion(entries[entries.length - 1].before!)}>Restore</button>
        </div>
      )}
    </div>
  );
}

/** Answer from the local LLM for tasks that ask a question. */
function AiBox({ t }: { t: Task }) {
  useStore((s) => s.settings.llmEnabled && s.settings.llmModel);
  const ready = llmReady();
  if (!t.ai) {
    if (!hasQuestion(t.title + (t.notes ?? ''))) return null;
    return (
      <div className="ai-box idle">
        <Sparkles size={14} />
        {ready ? (
          <button className="btn tiny" onClick={() => enqueueAsk(t.id)}>Ask AI</button>
        ) : (
          <span className="small muted">
            Connect a local AI in <a onClick={() => S().setUI({ view: 'settings', selectedId: undefined })}>Settings</a> to get answers to “?” tasks.
          </span>
        )}
      </div>
    );
  }
  const { status, answer, model } = t.ai;
  return (
    <div className={cls('ai-box', `ai-${status}`)}>
      <div className="ai-head">
        <Sparkles size={13} className={status === 'pending' ? 'spin-slow' : undefined} />
        <span>
          {status === 'queued' ? <QueuePos id={t.id} /> : status === 'pending' ? `Asking ${S().settings.llmModel || 'AI'}…` : status === 'error' ? 'AI couldn’t answer' : model ?? 'AI'}
        </span>
        {status === 'done' && t.ai.confidence && (
          <span className={cls('conf', `conf-${t.ai.confidence}`)} title="How sure the model says it is — small models are often overconfident">
            {t.ai.confidence} confidence
          </span>
        )}
        <span className="spacer" />
        {status === 'queued' && (
          <button className="link-btn" onClick={() => cancelAsk(t.id)}>Cancel</button>
        )}
        {status !== 'pending' && status !== 'queued' && ready && (
          <button className="icon-btn" title="Ask again" onClick={() => enqueueAsk(t.id)}>
            <RefreshCw size={12} />
          </button>
        )}
        {status !== 'pending' && status !== 'queued' && (
          <button className="icon-btn" title="Remove the answer" onClick={() => updateTask(t.id, { ai: undefined }, 'Removed AI answer')}>
            <X size={12} />
          </button>
        )}
      </div>
      {status === 'pending' || status === 'queued' ? (
        <div className={cls('ai-dots', status === 'queued' && 'idle')}><i /><i /><i /></div>
      ) : (
        <div className="ai-answer">
          {(answer ?? '').split('\n').filter((l) => l.trim()).map((l, i) =>
            /^\s*-\s+/.test(l) ? <li key={i}>{l.replace(/^\s*-\s+/, '')}</li> : <p key={i}>{l}</p>,
          )}
        </div>
      )}
      {status === 'done' && <div className="ai-foot">Suggestion from a local model with no internet access — it can be outdated or wrong. Double-check anything that matters.</div>}
    </div>
  );
}

function QueuePos({ id }: { id: string }) {
  const q = useStore((s) => s.ui.aiQueue);
  const pos = (q?.waiting.indexOf(id) ?? -1) + 1;
  return <>Waiting for AI{pos ? ` · #${pos} in line` : ''}</>;
}
