import type { Entity, Importance, ISODate, Project, Task } from '../../types';
import { fromISO, MONTHS, WD } from '../date';
import { describeRecurrence } from '../recurrence';

/**
 * A "document" is one searchable thing, flattened into plain text fields.
 * Every search layer works on these, never on raw tasks.
 */
export type DocKind = 'task' | 'repeat' | 'sticky' | 'event' | 'project';

export interface SearchDoc {
  id: string;
  kind: DocKind;
  title: string;
  notes: string;
  /** project name, repeat rule, cost… — context that helps matching but isn't the task itself */
  context: string;
  /** the day it's on (repeats: their start), for date filters and recency */
  date: ISODate | null;
  status: 'open' | 'done' | 'dropped';
  importance: Importance;
  projectTitle?: string;
  hasCost: boolean;
}

const ENDED = (t: Task, today: ISODate) => !!t.recurrence?.until && t.recurrence.until < today;

/** All current tasks and projects (not deleted, not ended repeats). */
export function buildDocs(entities: Record<string, Entity>, today: ISODate): SearchDoc[] {
  const projects: Record<string, Project> = {};
  for (const e of Object.values(entities)) if (e.type === 'project' && !e.deleted) projects[e.id] = e;

  const docs: SearchDoc[] = [];
  for (const e of Object.values(entities)) {
    if (e.deleted) continue;
    if (e.type === 'project') {
      docs.push({
        id: e.id,
        kind: 'project',
        title: e.title,
        notes: e.notes ?? '',
        context: 'project',
        date: null,
        status: e.status === 'done' ? 'done' : 'open',
        importance: 'should',
        hasCost: false,
      });
      continue;
    }
    if (ENDED(e, today)) continue;
    const project = e.projectId ? projects[e.projectId] : undefined;
    const ctx: string[] = [];
    if (project) ctx.push(project.title);
    if (e.recurrence && e.date) ctx.push(describeRecurrence(e.recurrence, e.date));
    if (e.cost?.amount) ctx.push(`${e.cost.amount}${e.cost.autopay ? ' autopay' : ''} bill subscription`);
    if (e.allDay) ctx.push(e.endDate ? 'all-day trip event' : 'all-day event');
    docs.push({
      id: e.id,
      kind: e.allDay ? 'event' : e.recurrence ? 'repeat' : e.date ? 'task' : 'sticky',
      title: e.title.replace(/\s+#\s*$/, ''),
      notes: e.notes ?? '',
      context: ctx.join(' · '),
      date: e.date,
      status: e.status === 'done' ? 'done' : e.status === 'dropped' ? 'dropped' : 'open',
      importance: e.importance,
      projectTitle: project?.title,
      hasCost: !!e.cost?.amount,
    });
  }
  return docs;
}

/** "Tue Oct 6, 2026" — words a person might use for that day. */
export function dateWords(d: ISODate | null): string {
  if (!d) return '';
  const x = fromISO(d);
  return `${WD[x.getDay()]} ${MONTHS[x.getMonth()]} ${x.getDate()} ${x.getFullYear()}`;
}
