import type { Entity, ISODate, Task } from '../../types';
import { diffDays, fromISO, MONTHS, WD } from '../date';
import { describeRecurrence, nextOccurrence } from '../recurrence';
import type { SearchDoc } from './docs';

/**
 * Layer 3 — Ask: retrieval-augmented generation (RAG).
 *
 * The LLM never sees the whole planner. Layers 1 + 2 *retrieve* the dozen most relevant items;
 * we turn them into a short, numbered, pre-digested list (dates already worked out: "20 days
 * ago", grouped past / upcoming / repeating), and the LLM only has to *read* it and reply,
 * citing items as [3]. Small local models are good readers but poor date calculators — so the
 * code does the arithmetic and the model does the wording.
 */

const QUESTION_START =
  /^(who|what|what's|whats|when|where|which|why|how|did|do|does|is|are|was|were|have|has|had|can|could|should|will|would|any|anything|list|show me|tell me|remind me)\b/i;
const QUESTION_CN = /(什么|哪|几|吗|呢|多少|怎么|为什么|是否|有没有|谁|何时|啥)/;

/** Does this read like a question (so we answer it without being asked)? */
export function isQuestion(q: string): boolean {
  const t = q.trim();
  if (t.length < 4) return false;
  return /[?？]\s*$/.test(t) || QUESTION_START.test(t) || QUESTION_CN.test(t);
}

const MAX_ITEMS = 12;
const day = (d: ISODate) => {
  const x = fromISO(d);
  return `${WD[x.getDay()]} ${MONTHS[x.getMonth()]} ${x.getDate()} ${x.getFullYear()}`;
};
function rel(d: ISODate, today: ISODate): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export interface AskContext {
  /** the numbered list the model reads */
  text: string;
  /** item number (1-based) → document id */
  refs: string[];
}

const ASKS_LAST = /\b(last|latest|most recent|recently|previous|when did)\b|上次|上一次|最近|上回/i;
const ASKS_NEXT = /\b(next|upcoming|coming up|soonest|when is|when's|when will)\b|下次|下一次|接下来|即将/i;
/** How many of the most relevant results the "best matches" lines may come from. */
const FACT_POOL = 5;

/**
 * The retrieved items as a short numbered list, grouped by time.
 * For "last …" / "next …" questions the code also picks the answer candidates itself — the most
 * recent past match and the soonest upcoming one among the top results — and states them first.
 * Measured with qwen3.5:4b: a single unrelated item at the top of the list made it name the wrong
 * "last" visit 8 times out of 8; with these lines it was right every time.
 */
export function buildContext(docs: SearchDoc[], entities: Record<string, Entity>, today: ISODate, question = ''): AskContext {
  const pick = docs.slice(0, MAX_ITEMS);
  const past: SearchDoc[] = [];
  const ahead: SearchDoc[] = [];
  const repeating: SearchDoc[] = [];
  const undated: SearchDoc[] = [];
  for (const d of pick) {
    if (d.kind === 'repeat') repeating.push(d);
    else if (!d.date) undated.push(d);
    else if (d.date < today && d.status !== 'open') past.push(d);
    else ahead.push(d);
  }
  past.sort((a, b) => b.date!.localeCompare(a.date!)); // newest first
  ahead.sort((a, b) => a.date!.localeCompare(b.date!)); // soonest first

  const refs: string[] = [];
  const lines: string[] = [];
  const add = (d: SearchDoc, desc: string) => {
    refs.push(d.id);
    const extra = [d.projectTitle && `project ${d.projectTitle}`, d.notes && `notes: ${d.notes.replace(/\s+/g, ' ').slice(0, 160)}`].filter(Boolean);
    lines.push(`[${refs.length}] ${d.title} — ${desc}${extra.length ? ` — ${extra.join(' — ')}` : ''}`);
  };
  const status = (d: SearchDoc) => (d.status === 'done' ? 'done' : d.status === 'dropped' ? 'dropped' : `open, ${d.importance}`);

  if (past.length) {
    lines.push('Past (newest first):');
    for (const d of past) add(d, `${day(d.date!)} (${rel(d.date!, today)}) — ${status(d)}`);
  }
  if (ahead.length) {
    lines.push('Today and later (soonest first):');
    for (const d of ahead) {
      const late = d.date! < today ? `${-diffDays(today, d.date!)} days overdue` : rel(d.date!, today);
      add(d, `${day(d.date!)} (${late}) — ${d.kind === 'event' ? 'all-day event' : status(d)}`);
    }
  }
  if (repeating.length) {
    lines.push('Repeating:');
    for (const d of repeating) {
      const t = entities[d.id] as Task;
      const next = t?.recurrence && t.date ? nextOccurrence(t.recurrence, t.date, today) : null;
      const lastDone = Object.entries(t?.completions ?? {})
        .filter(([dd, s]) => s === 'done' && dd <= today)
        .map(([dd]) => dd)
        .sort()
        .pop();
      const cost = t?.cost?.amount ? `$${t.cost.amount}${t.cost.autopay ? ' autopay' : ''}` : '';
      add(
        d,
        [
          t?.recurrence && t.date ? describeRecurrence(t.recurrence, t.date).toLowerCase() : 'repeats',
          cost,
          next && `next ${day(next)} (${rel(next, today)})`,
          lastDone && `last done ${day(lastDone)} (${rel(lastDone, today)})`,
        ]
          .filter(Boolean)
          .join(' — '),
      );
    }
  }
  if (undated.length) {
    lines.push('No date (sticky notes, projects):');
    for (const d of undated) add(d, d.kind === 'project' ? 'project' : 'sticky note, not scheduled');
  }
  // the answer candidates, worked out in code from the most relevant few
  const facts: string[] = [];
  const top = pick.slice(0, FACT_POOL).filter((d) => d.date && d.kind !== 'repeat');
  const num = (d: SearchDoc) => refs.indexOf(d.id) + 1;
  const wantsLast = ASKS_LAST.test(question);
  const wantsNext = ASKS_NEXT.test(question);
  if (wantsLast) {
    const last = top.filter((d) => d.date! <= today && d.status === 'done').sort((a, b) => b.date!.localeCompare(a.date!))[0];
    if (last) facts.push(`- Most recent past: [${num(last)}] ${last.title} — ${day(last.date!)} (${rel(last.date!, today)})`);
  }
  if (wantsNext) {
    const next = top.filter((d) => d.date! >= today && d.status === 'open').sort((a, b) => a.date!.localeCompare(b.date!))[0];
    if (next) facts.push(`- Next upcoming: [${num(next)}] ${next.title} — ${day(next.date!)} (${rel(next.date!, today)})`);
  }
  const head = facts.length ? `Best matches for the question (worked out from the list below):\n${facts.join('\n')}\n\nItems:\n` : '';
  return { text: head + lines.join('\n'), refs };
}

/** Pull the text pieces out of a stream of server-sent events ("data: {…}" lines). */
export function parseSSE(buffer: string): { deltas: string[]; rest: string } {
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  const deltas: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data: ') || line.trim() === 'data: [DONE]') continue;
    try {
      const d = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
      if (d) deltas.push(d);
    } catch {
      /* a partial line — ignore */
    }
  }
  return { deltas, rest };
}

export const dayLabel = day;
