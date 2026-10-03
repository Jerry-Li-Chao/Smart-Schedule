import type { DayItem, Entity, ISODate, Project, Status, Task, TrackerEntry } from './types';
import { S, useStore } from './store';
import { uid } from './lib/id';
import { addDays, diffDays, fmtDay, localDateTime, parseLocalDateTime, todayISO } from './lib/date';
import { parseQuick, splitCapture, type Parsed } from './lib/parse';
import { IMPORTANCE_HELP, isClosed } from './lib/priority';
import { numberedTitle } from './lib/recurrence';
import { askIfQuestion } from './lib/llm';

export const PROJECT_COLORS = ['#6e56cf', '#0b8fd6', '#12a594', '#e5484d', '#f76b15', '#d6409f', '#8e8c99', '#3e9b4f'];

// ---------- lookups ----------
export function tasks(): Task[] {
  return Object.values(S().entities).filter((e): e is Task => e.type === 'task' && !e.deleted);
}
export function projects(): Project[] {
  return Object.values(S().entities)
    .filter((e): e is Project => e.type === 'project' && !e.deleted)
    .sort((a, b) => a.order - b.order);
}
export function getTask(id?: string): Task | undefined {
  const e = id ? S().entities[id] : undefined;
  return e?.type === 'task' && !e.deleted ? e : undefined;
}
export function getProject(id?: string): Project | undefined {
  const e = id ? S().entities[id] : undefined;
  return e?.type === 'project' && !e.deleted ? e : undefined;
}
export const isInbox = (t: Task) =>
  !t.deleted && t.date === null && !t.someday && !t.projectId && !t.recurrence && !isClosed(t);

/** Things waiting for a decision: unscheduled sticky notes. */
export function planQueue(): Task[] {
  return tasks()
    .filter(isInbox)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---------- creation ----------
export function newTask(p: Partial<Task> & { title: string }): Task {
  const now = Date.now();
  return {
    type: 'task',
    id: uid('t'),
    createdAt: now,
    updatedAt: now,
    date: null,
    importance: S().settings.defaultImportance ?? 'must',
    status: 'open',
    order: now,
    ...p,
    firstScheduled: p.firstScheduled ?? p.date ?? undefined,
  };
}

/** Sensible default reminders: 10 min before appointments, two weeks before far-off things. */
export function defaultReminder(date: ISODate | null | undefined, time: string | undefined, today: ISODate) {
  if (!date) return undefined;
  if (time) {
    const d = parseLocalDateTime(`${date}T${time}`);
    d.setMinutes(d.getMinutes() - 10);
    return localDateTime(d);
  }
  if (date >= addDays(today, 21)) return `${addDays(date, -14)}T09:00`;
  return undefined;
}

const TITLE_MAX = 100;

/** Long brain-dumps: keep a short title on the calendar, the full text goes into notes. */
export function shortenTitle(text: string): { title: string; notes?: string } {
  if (text.length <= TITLE_MAX) return { title: text };
  const cut = text.slice(0, 80);
  const sentence = /^(.{25,80}?[.!?。！？])\s/.exec(text);
  const space = cut.lastIndexOf(' ');
  const head = sentence ? sentence[1] : space > 40 ? cut.slice(0, space) : cut;
  return { title: head.replace(/[\s,.;:，。；：]+$/, '') + '…', notes: text };
}

export function taskFromParsed(p: Parsed, extra: Partial<Task> = {}): Task {
  const today = todayISO();
  const date = extra.date !== undefined ? extra.date : p.date ?? null;
  const short = shortenTitle(p.title);
  if (short.notes) extra = { ...extra, notes: extra.notes ? `${short.notes}\n${extra.notes}` : short.notes };
  // repeating + "#" (optionally "#42") → numbered: each day shows its own number
  const num = p.recurrence ? /#(\d+)?/.exec(short.title) : null;
  if (num) extra = { ...extra, numbering: { start: num[1] ? Number(num[1]) : 1 } };
  return newTask({
    title: num ? short.title.replace(/#\d+/, '#') : short.title,
    date,
    time: p.time,
    importance: p.importance ?? S().settings.defaultImportance ?? 'must',
    recurrence: p.recurrence,
    deadline: p.deadline,
    someday: p.someday,
    remindAt: defaultReminder(date, p.time, today),
    ...extra,
  });
}

/**
 * Sticky-note capture. Items with a recognisable date go straight onto the calendar;
 * everything else stays on the sticky until it's planned.
 */
export function capture(text: string, opts: { date?: ISODate } = {}): Task[] {
  const today = todayISO();
  const created = splitCapture(text).map(({ line, notes }) =>
    taskFromParsed(parseQuick(line, today), { ...(opts.date ? { date: opts.date, firstScheduled: opts.date } : {}), ...(notes ? { notes } : {}) }),
  );
  if (!created.length) return [];
  S().commit(created.length === 1 ? `Added “${created[0].title}”` : `Added ${created.length} notes`, created);
  // typed by the user → questions go to the AI queue (imports and sync never do)
  for (const t of created) askIfQuestion(t);
  const scheduled = created.filter((t) => t.date);
  if (!opts.date && scheduled.length) {
    const first = scheduled[0];
    S().toast(
      scheduled.length === 1
        ? `Scheduled “${first.title}” → ${fmtDay(first.date!)}${first.recurrence ? ' (repeats)' : ''}`
        : `${scheduled.length} items scheduled from dates in the text`,
      [
        { label: 'Show', run: () => jumpTo(first.date!) },
        { label: 'Undo', run: () => S().undo() },
      ],
    );
  }
  return created;
}

// ---------- updates ----------
export function updateTask(id: string, patch: Partial<Task>, label?: string) {
  const t = getTask(id);
  if (!t) return;
  const next: Task = { ...t, ...patch };
  if (patch.title !== undefined) {
    const short = shortenTitle(patch.title);
    if (short.notes) Object.assign(next, { title: short.title, notes: t.notes ? `${short.notes}\n\n${t.notes}` : short.notes });
  }
  if ('date' in patch) {
    next.stay = undefined; // rescheduled by hand: normal carry-over again
    if (!patch.date) next.firstScheduled = undefined;
    else if (!t.firstScheduled || !t.date) next.firstScheduled = patch.date;
    if (patch.date && t.someday) next.someday = false;
  }
  if (('date' in patch || 'time' in patch) && !('remindAt' in patch) && t.remindAt && t.remindAt === defaultReminder(t.date, t.time, todayISO())) {
    next.remindAt = defaultReminder(next.date, next.time, todayISO());
    next.remindFired = false;
  }
  if ('remindAt' in patch) next.remindFired = false;
  if (patch.status && patch.status !== t.status) next.doneAt = patch.status === 'done' ? Date.now() : undefined;
  S().commit(label ?? `Edited “${t.title}”`, [next]);
  if (patch.title !== undefined && next.title !== t.title) askIfQuestion(getTask(id) ?? next);
  if (patch.status === 'done' && t.status !== 'done') promptNextSteps(next);
}

export function schedule(id: string, date: ISODate | null, order?: number) {
  const t = getTask(id);
  if (!t) return;
  updateTask(id, { date, ...(order !== undefined ? { order } : {}) }, date ? `Moved “${t.title}” → ${fmtDay(date)}` : `Unscheduled “${t.title}”`);
}

export function setItemStatus(item: DayItem, status: Status) {
  if (item.kind === 'task') return updateTask(item.task.id, { status }, `${statusVerb(status)} “${item.task.title}”`);
  if (item.kind === 'occ') {
    const completions = { ...(item.task.completions ?? {}) };
    if (status === 'done' || status === 'dropped') completions[item.date] = status;
    else delete completions[item.date];
    S().commit(`${statusVerb(status)} “${item.task.title}” on ${fmtDay(item.date)}`, [{ ...item.task, completions }]);
  }
}
const statusVerb = (s: Status) =>
  ({ open: 'Reopened', doing: 'Started', waiting: 'Waiting on', done: 'Completed', dropped: 'Marked obsolete' })[s];

/** Moving one occurrence of a repeating task: skip it there, create a one-off copy on the new day. */
export function moveOccurrence(series: Task, from: ISODate, to: ISODate) {
  const completions = { ...(series.completions ?? {}), [from]: 'moved' as const };
  const copy = newTask({
    title: numberedTitle(series, from),
    notes: series.notes,
    importance: series.importance,
    time: series.time,
    date: to,
    seriesId: series.id,
    projectId: series.projectId,
  });
  S().commit(`Moved one “${series.title}” → ${fmtDay(to)}`, [{ ...series, completions }, copy]);
}

/**
 * Move a whole selection to one day in a single undoable step. One-off tasks go to the end of
 * that day in their current order; days of a repeating task move as one-off copies.
 */
export function moveMany(keys: string[], to: ISODate) {
  const changed = new Map<string, Task>();
  const created: Task[] = [];
  let order = Date.now();
  let n = 0;
  for (const k of keys) {
    const [id, date] = k.split('@');
    const t = changed.get(id) ?? getTask(id);
    if (!t) continue;
    if (date) {
      if (date === to) continue;
      changed.set(id, { ...t, completions: { ...(t.completions ?? {}), [date]: 'moved' } });
      created.push(newTask({ title: numberedTitle(t, date), notes: t.notes, importance: t.importance, time: t.time, date: to, seriesId: t.id, projectId: t.projectId }));
      n++;
    } else if (!t.recurrence && t.date !== to) {
      changed.set(id, { ...t, date: to, order: order++, stay: undefined });
      n++;
    }
  }
  if (!n) return;
  S().commit(`Moved ${n} task${n > 1 ? 's' : ''} → ${fmtDay(to)}`, [...changed.values(), ...created]);
  S().toast(`Moved ${n} task${n > 1 ? 's' : ''} to ${fmtDay(to)}`, [{ label: 'Undo', run: () => S().undo() }]);
}

export function deleteEntity(id: string) {
  const e = S().entities[id];
  if (!e) return;
  const title = e.title;
  const extra: Entity[] = [];
  if (e.type === 'project') for (const t of tasks()) if (t.projectId === id) extra.push({ ...t, deleted: true });
  S().commit(`Deleted “${title}”`, [{ ...e, deleted: true }, ...extra]);
  if (S().ui.selectedId === id) S().setUI({ selectedId: undefined });
  S().toast(`Deleted “${title}”`, [{ label: 'Undo', run: () => S().undo() }]);
}

const NEXT_IMPORTANCE = { could: 'should', should: 'must', must: 'could' } as const;

/** Click the priority strip on a card: could → should → must → could. */
export function cycleImportance(t: Task) {
  const importance = NEXT_IMPORTANCE[t.importance];
  S().commit(`“${t.title}” → ${IMPORTANCE_HELP[importance].label}`, [{ ...t, importance }]);
}

/** Repeating tasks ask what to delete; everything else is deleted (and undoable) right away. */
export function requestDelete(id: string, occDate?: ISODate) {
  const t = getTask(id);
  if (t?.recurrence) S().setUI({ deleteAsk: { id, date: occDate }, menu: undefined });
  else deleteEntity(id);
}

export function deleteRepeating(series: Task, date: ISODate | undefined, scope: 'one' | 'future' | 'all') {
  if (scope === 'all' || !date || (scope === 'future' && date <= series.date!)) return deleteEntity(series.id);
  if (scope === 'one') {
    S().commit(`Deleted “${series.title}” on ${fmtDay(date)}`, [{ ...series, completions: { ...(series.completions ?? {}), [date]: 'deleted' } }]);
    S().toast(`Deleted “${series.title}” on ${fmtDay(date)} only`, [{ label: 'Undo', run: () => S().undo() }]);
  } else {
    S().commit(`Stopped “${series.title}” from ${fmtDay(date)} on`, [{ ...series, recurrence: { ...series.recurrence!, until: addDays(date, -1) } }]);
    S().toast(`“${series.title}” no longer repeats from ${fmtDay(date)}`, [{ label: 'Undo', run: () => S().undo() }]);
  }
  if (S().ui.selectedId === series.id) S().setUI({ selectedId: undefined });
}

// ---------- multi-select ----------
export const itemKey = (item: DayItem) => (item.kind === 'occ' ? `${item.task.id}@${item.date}` : item.kind === 'task' ? item.task.id : '');

/** ⌘/Ctrl/Shift-click: add or remove a card from the selection (the open card joins too). */
export function toggleMulti(key: string) {
  const { multi = [], selectedId, occDate } = S().ui;
  let next = multi.length ? [...multi] : selectedId ? [occDate ? `${selectedId}@${occDate}` : selectedId] : [];
  next = next.includes(key) ? next.filter((k) => k !== key) : [...next, key];
  S().setUI({ multi: next, selectedId: undefined, occDate: undefined });
}

export function describeKeys(keys: string[]) {
  return keys
    .map((k) => {
      const [id, date] = k.split('@');
      const t = getTask(id);
      return t ? { key: k, title: t.title, date } : null;
    })
    .filter((x): x is { key: string; title: string; date: string } => !!x);
}

/** One undoable step. Repeating tasks only lose the selected day, never the whole series. */
export function deleteMany(keys: string[]) {
  const changed = new Map<string, Task>();
  for (const k of keys) {
    const [id, date] = k.split('@');
    const t = changed.get(id) ?? getTask(id);
    if (!t) continue;
    if (date) changed.set(id, { ...t, completions: { ...(t.completions ?? {}), [date]: 'deleted' } });
    else changed.set(id, { ...t, deleted: true });
  }
  if (!changed.size) return;
  S().commit(`Deleted ${keys.length} item${keys.length > 1 ? 's' : ''}`, [...changed.values()]);
  S().setUI({ multi: undefined, selectedId: undefined, batchAsk: false });
  S().toast(`Deleted ${keys.length} item${keys.length > 1 ? 's' : ''}`, [{ label: 'Undo', run: () => S().undo() }]);
}

/**
 * Selected tasks become steps of a project, chained in time order (date, then time):
 * the earliest comes first, each step unlocks the next. Repeating days are skipped.
 */
export function addManyToProject(keys: string[], target: { projectId: string } | { newTitle: string }) {
  const picked = keys
    .filter((k) => !k.includes('@'))
    .map((k) => getTask(k))
    .filter((t): t is Task => !!t && !t.recurrence);
  const skipped = keys.length - picked.length;
  if (!picked.length) return S().toast('Repeating tasks can’t be project steps — pick one-off tasks.');
  picked.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || (a.time ?? '99').localeCompare(b.time ?? '99') || a.order - b.order);

  const out: Entity[] = [];
  let project: Project;
  if ('newTitle' in target) {
    [project] = buildProject(target.newTitle, []);
    out.push(project);
  } else {
    const p = getProject(target.projectId);
    if (!p) return;
    project = p;
  }
  // continue after the project's latest existing step
  const ids = new Set(picked.map((t) => t.id));
  const existing = tasks()
    .filter((t) => t.projectId === project.id && !ids.has(t.id))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.order - b.order);
  let prev: string | null = existing.at(-1)?.id ?? null;
  for (const t of picked) {
    out.push({ ...t, projectId: project.id, parentId: prev });
    prev = t.id;
  }
  S().commit(`Added ${picked.length} task${picked.length > 1 ? 's' : ''} to “${project.title}”`, out);
  S().setUI({ multi: undefined });
  S().toast(
    `Added ${picked.length} to “${project.title}” in time order${skipped ? ` (${skipped} repeating skipped)` : ''}`,
    [
      { label: 'Open project', run: () => S().setUI({ view: 'projects', projectId: project.id }) },
      { label: 'Undo', run: () => S().undo() },
    ],
    7000,
  );
}

export function batchStatus(keys: string[], status: Status) {
  const changed = new Map<string, Task>();
  for (const k of keys) {
    const [id, date] = k.split('@');
    const t = changed.get(id) ?? getTask(id);
    if (!t) continue;
    if (date) changed.set(id, { ...t, completions: { ...(t.completions ?? {}), [date]: status as 'done' } });
    else changed.set(id, { ...t, status, doneAt: status === 'done' ? Date.now() : undefined });
  }
  S().commit(`Marked ${keys.length} ${status}`, [...changed.values()]);
  S().setUI({ multi: undefined });
}

/** Delete key: several selected → confirm (unless turned off); one open task → delete right away (undoable). */
export function deleteSelection() {
  const { multi, selectedId, occDate } = S().ui;
  if (multi?.length) {
    if (S().settings.confirmBatchDelete !== false) S().setUI({ batchAsk: true });
    else deleteMany(multi);
    return;
  }
  if (!selectedId) return;
  const t = getTask(selectedId);
  if (t?.recurrence && occDate) return deleteRepeating(t, occDate, 'one');
  requestDelete(selectedId, occDate);
}

export function restoreVersion(e: Entity, why = 'Restored an earlier version') {
  S().commit(`${why}: “${e.title}”`, [{ ...e, deleted: false } as Entity]);
  S().toast(`Restored “${e.title}”`, [{ label: 'Undo', run: () => S().undo() }]);
}

export function duplicateTask(id: string) {
  const t = getTask(id);
  if (!t) return;
  const copy = { ...t, id: uid('t'), createdAt: Date.now(), status: 'open' as const, completions: undefined, order: t.order + 0.5 };
  S().commit(`Duplicated “${t.title}”`, [copy]);
}

/** Unfinished, untimed tasks from past days move to today (no more copying them forward by hand). */
export function carryOver(today = todayISO()) {
  const moved = tasks()
    .filter((t) => t.date && t.date < today && !t.time && !t.recurrence && !t.stay && !isClosed(t))
    .map((t) => ({ ...t, date: today, firstScheduled: t.firstScheduled ?? t.date! }));
  if (moved.length) S().commit(`Carried ${moved.length} unfinished task${moved.length > 1 ? 's' : ''} to today`, moved, { undoable: false });
}

const RANGE_STEPS = [7, 30, 90, 182, 365, 730, 1095, 1825, 3650];

export function jumpTo(date: ISODate) {
  const today = todayISO();
  const back = S().settings.rangeBackDays ?? 365;
  const fwd = S().settings.rangeFwdDays ?? 730;
  const off = diffDays(today, date);
  if (off < -back || off > fwd) {
    const need = Math.abs(off);
    const step = RANGE_STEPS.find((d) => d >= need) ?? need;
    S().toast(`${fmtDay(date)} is outside the days you’ve chosen to show (Settings → Timeline range).`, [
      {
        label: 'Show it',
        run: () => {
          S().setSettings(off < 0 ? { rangeBackDays: step } : { rangeFwdDays: step });
          setTimeout(() => jumpTo(date), 50);
        },
      },
    ], 9000);
    return;
  }
  const n = (S().ui.jump?.n ?? 0) + 1;
  S().setUI({ view: 'timeline', jump: { date, n } });
}

// ---------- projects ----------
function buildProject(title: string, steps: string[]): [Project, Task[]] {
  const now = Date.now();
  const p: Project = {
    type: 'project',
    id: uid('p'),
    title,
    color: PROJECT_COLORS[projects().length % PROJECT_COLORS.length],
    status: 'active',
    order: now,
    createdAt: now,
    updatedAt: now,
  };
  let parentId: string | null = null;
  const nodes = steps.map((s, i) => {
    const n = newTask({ title: s, projectId: p.id, parentId, order: now + i });
    parentId = n.id; // a pasted list becomes a chain: step 1 → step 2 → …
    return n;
  });
  return [p, nodes];
}

export function addProject(title: string, steps: string[] = []): Project {
  const [p, nodes] = buildProject(title, steps);
  S().commit(`New project “${title}”`, [p, ...nodes]);
  return p;
}

export function updateProject(id: string, patch: Partial<Project>, label?: string) {
  const p = getProject(id);
  if (p) S().commit(label ?? `Edited project “${p.title}”`, [{ ...p, ...patch }]);
}

export function addStep(projectId: string, parentId: string | null, title = ''): Task {
  const t = newTask({ title, projectId, parentId, order: Date.now() });
  S().commit(`Added step to “${getProject(projectId)?.title ?? 'project'}”`, [t]);
  return t;
}

/** A sticky note that turns out to be bigger than a task: notes lines become chained steps. */
export function promoteToProject(id: string) {
  const t = getTask(id);
  if (!t) return;
  const steps = (t.notes ?? '').split('\n').map((s) => s.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  const [p, nodes] = buildProject(t.title, steps.length ? steps : ['First step']);
  S().commit(`Turned “${t.title}” into a project`, [p, ...nodes, { ...t, deleted: true }]);
  S().setUI({ view: 'projects', projectId: p.id, planOpen: false });
}

export function trackerUpdate(projectId: string, fn: (entries: TrackerEntry[]) => TrackerEntry[], label: string) {
  const p = getProject(projectId);
  if (!p) return;
  const tracker = p.tracker ?? { label: 'Contacts', entries: [] };
  S().commit(label, [{ ...p, tracker: { ...tracker, entries: fn(tracker.entries) } }]);
}

/** When a step is done, surface the steps it unlocks so they get a date. */
function promptNextSteps(done: Task) {
  if (!done.projectId) return;
  const next = tasks().filter((t) => t.parentId === done.id && !t.date && !isClosed(t));
  if (!next.length) return;
  const n = next[0];
  const today = todayISO();
  useStore.getState().toast(`Next step unlocked: “${n.title || 'untitled'}” — when will you do it?`, [
    { label: 'Today', run: () => schedule(n.id, today) },
    { label: 'Tomorrow', run: () => schedule(n.id, addDays(today, 1)) },
    { label: 'Open', run: () => S().setUI({ selectedId: n.id }) },
  ], 12000);
}
