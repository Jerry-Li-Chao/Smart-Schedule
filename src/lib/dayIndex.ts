import type { DayItem, DaySort, Entity, ISODate, Project, Task, TrackerEntry } from '../types';
import { effectiveLevel } from './priority';
import { occursOn } from './recurrence';

export interface DayIndex {
  byDate: Map<ISODate, Task[]>;
  series: Task[];
  follows: Map<ISODate, { project: Project; entry: TrackerEntry }[]>;
  projects: Record<string, Project>;
}

export function buildDayIndex(entities: Record<string, Entity>): DayIndex {
  const byDate = new Map<ISODate, Task[]>();
  const follows = new Map<ISODate, { project: Project; entry: TrackerEntry }[]>();
  const series: Task[] = [];
  const projects: Record<string, Project> = {};
  for (const e of Object.values(entities)) {
    if (e.deleted) continue;
    if (e.type === 'project') {
      projects[e.id] = e;
      for (const entry of e.tracker?.entries ?? []) {
        if (entry.outcome !== 'pending' || !entry.followUp) continue;
        const list = follows.get(entry.followUp) ?? [];
        list.push({ project: e, entry });
        follows.set(entry.followUp, list);
      }
    } else if (e.recurrence && e.date) series.push(e);
    else if (e.date) {
      const list = byDate.get(e.date) ?? [];
      list.push(e);
      byDate.set(e.date, list);
    }
  }
  return { byDate, series, follows, projects };
}

const timeKey = (t: Task) => t.time ?? '99:99';
const RANK = { must: 0, should: 1, could: 2 } as const;

type TaskItem = Extract<DayItem, { kind: 'task' } | { kind: 'occ' }>;
const statusOf = (i: TaskItem) => (i.kind === 'occ' ? i.state ?? 'open' : i.task.status);
const closed = (i: TaskItem) => (statusOf(i) === 'done' || statusOf(i) === 'dropped' ? 1 : 0);

/**
 * manual: your drag order · time: timed things first by clock, then your order ·
 * importance: must → should → could (deadline escalation counts), finished at the bottom ·
 * importance-time: importance first, then by clock within each level.
 */
export function compareFor(mode: DaySort, today: ISODate) {
  const level = (i: TaskItem) => RANK[effectiveLevel(i.kind === 'occ' ? { ...i.task, status: statusOf(i) } : i.task, today).level];
  return (x: DayItem, y: DayItem) => {
    const a = x as TaskItem;
    const b = y as TaskItem;
    const byOrder = a.task.order - b.task.order;
    const byTime = timeKey(a.task).localeCompare(timeKey(b.task));
    switch (mode) {
      case 'manual':
        return byOrder;
      case 'time':
        return byTime || byOrder;
      case 'importance':
        return closed(a) - closed(b) || level(a) - level(b) || byOrder;
      case 'importance-time':
        return closed(a) - closed(b) || level(a) - level(b) || byTime || byOrder;
    }
  };
}

export function itemsFor(idx: DayIndex, date: ISODate, mode: DaySort = 'time', today: ISODate = date): DayItem[] {
  const items: DayItem[] = [];
  for (const t of idx.byDate.get(date) ?? []) items.push({ kind: 'task', key: t.id, task: t });
  for (const s of idx.series) {
    const state = s.completions?.[date];
    if (state !== 'deleted' && state !== 'moved' && occursOn(s.recurrence!, s.date!, date))
      items.push({ kind: 'occ', key: `${s.id}@${date}`, task: s, date, state });
  }
  items.sort(compareFor(mode, today));
  for (const f of idx.follows.get(date) ?? [])
    items.push({ kind: 'follow', key: `${f.project.id}:${f.entry.id}`, project: f.project, entry: f.entry });
  return items;
}
