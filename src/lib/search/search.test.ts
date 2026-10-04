import { describe, expect, it } from 'vitest';
import type { Entity, Task } from '../../types';
import { buildDocs } from './docs';
import { parseQuery } from './query';
import { buildTextIndex, editDistance, highlightRanges, searchText, stem, tokenize } from './text';

const today = '2026-10-02';
const T = (p: Partial<Task> & { id: string; title: string }): Task => ({ type: 'task', date: null, importance: 'should', status: 'open', order: 0, createdAt: 0, updatedAt: 0, ...p });
const db = (...ts: Entity[]) => Object.fromEntries(ts.map((t) => [t.id, t]));

const data = db(
  T({ id: 'a', title: 'Renew passport', date: '2026-09-15', notes: 'bring two photos' }),
  T({ id: 'b', title: 'Call the dentist about the cleaning', date: '2026-10-05', importance: 'must' }),
  T({ id: 'c', title: 'Buy groceries', date: '2026-10-02', status: 'done' }),
  T({ id: 'd', title: '看牙医', date: '2026-08-20' }),
  T({ id: 'e', title: 'Streaming service', date: '2026-01-12', recurrence: { freq: 'monthly', interval: 1 }, cost: { amount: 15.49 } }),
  T({ id: 'f', title: 'Old gym plan', date: '2025-01-01', recurrence: { freq: 'monthly', interval: 1, until: '2025-06-01' } }),
  T({ id: 'g', title: 'Deleted thing', date: '2026-10-01', deleted: true }),
  { id: 'p', type: 'project', title: 'Kitchen renovation', color: '#000', status: 'active', order: 0, createdAt: 0, updatedAt: 0 },
  T({ id: 'h', title: 'Order cabinets', date: '2026-10-08', projectId: 'p' }),
);
const idx = buildTextIndex(buildDocs(data, today));
const find = (q: string) => {
  const pq = parseQuery(q, today);
  return searchText(idx, pq.text, pq.filters, today).map((h) => h.doc.id);
};

describe('text search building blocks', () => {
  it('tokenizes words, stems endings and splits Chinese into characters and pairs', () => {
    expect(stem('renewals')).toBe('renew');
    expect(stem('groceries')).toBe('grocery');
    expect(tokenize('看牙医 visit').map((x) => x.t)).toEqual(['看', '牙', '看牙', '医', '牙医', 'visit']);
  });
  it('measures typos, including swapped letters', () => {
    expect(editDistance('pasport', 'passport', 1)).toBe(1);
    expect(editDistance('dnetist', 'dentist', 2)).toBe(1);
    expect(editDistance('cat', 'dog', 1)).toBe(2);
  });
});

describe('search', () => {
  it('finds by word, word start, typo and ending', () => {
    expect(find('passport')[0]).toBe('a');
    expect(find('pass')[0]).toBe('a');
    expect(find('pasport')[0]).toBe('a');
    expect(find('renewing')[0]).toBe('a');
  });
  it('searches notes and project names too', () => {
    expect(find('photos')).toEqual(['a']);
    expect(find('kitchen')).toEqual(expect.arrayContaining(['p', 'h']));
  });
  it('handles Chinese', () => {
    expect(find('牙医')).toEqual(['d']);
  });
  it('turns dates, status and bills into filters', () => {
    expect(parseQuery('dentist next week', today)).toMatchObject({ text: 'dentist', filters: { from: '2026-10-05', to: '2026-10-11' } });
    expect(parseQuery('may need to call', today).text).toBe('may need to call');
    expect(parseQuery('in may', today).filters.from).toBe('2026-05-01');
    expect(find('done')).toEqual(['c']);
    expect(find('bills')).toEqual(['e']);
    expect(parseQuery('what bills are coming up?', today).filters).toMatchObject({ bills: true, from: today, to: '2026-11-01' });
    expect(find('in august')).toEqual(['d', 'e']); // the monthly bill was running in August too
  });
  it('leaves out deleted things and repeats that have ended', () => {
    expect(find('deleted')).toEqual([]);
    expect(find('gym')).toEqual([]);
  });
  it('ignores question filler words and question-style "should"', () => {
    expect(find('when did I last renew my passport')).toEqual(['a']);
    expect(parseQuery('what should I do today', today).filters.importance).toBeUndefined();
    expect(parseQuery('must call', today).filters.importance).toBe('must');
  });
  it('needs every word of a short query', () => {
    expect(find('call dentist')).toEqual(['b']);
    expect(find('call passport')).toEqual([]);
  });
  it('highlights whole matched words', () => {
    expect(highlightRanges('Renew passport', ['pass'])).toEqual([[6, 14]]);
    expect(highlightRanges('看牙医', ['牙', '医'])).toEqual([[1, 3]]);
  });
});

describe('fusing text and meaning results', () => {
  it('ranks by position in each list, marks meaning-only finds, and applies filters', async () => {
    const { fuse } = await import('./hybrid');
    const docs = buildDocs(data, today);
    const byId = (id: string) => docs.find((d) => d.id === id)!;
    const text = [{ doc: byId('b'), score: 9, coverage: 1, terms: ['dentist'] }];
    const vec = [
      { doc: byId('d'), sim: 0.76 }, // 看牙医 — no shared words with "teeth"
      { doc: byId('b'), sim: 0.7 },
      { doc: byId('c'), sim: 0.6 },
    ];
    const out = fuse(text, vec, {});
    expect(out.map((h) => [h.doc.id, h.related])).toEqual([['b', false], ['d', true], ['c', true]]); // in both lists → first
    expect(fuse(text, vec, { status: 'done' }).map((h) => h.doc.id)).toEqual(['b', 'c']); // text hits were filtered already
  });
});

describe('ask', () => {
  it('spots questions', async () => {
    const { isQuestion } = await import('./ask');
    expect(['when did I last go to the dentist', 'bills this month?', '这个月有什么账单', 'any trips planned'].map(isQuestion)).toEqual([true, true, true, true]);
    expect(['dentist', 'passport renewal', 'kitchen'].map(isQuestion)).toEqual([false, false, false]);
  });
  it('reads a streamed answer out of server-sent events', async () => {
    const { parseSSE } = await import('./ask');
    const chunk = 'data: {"choices":[{"delta":{"content":"Your next"}}]}\n\ndata: {"choices":[{"delta":{"content":" visit is"}}]}\ndata: {"choi';
    expect(parseSSE(chunk)).toEqual({ deltas: ['Your next', ' visit is'], rest: 'data: {"choi' });
  });
  it('lays out retrieved items by time, with the date maths done', async () => {
    const { buildContext } = await import('./ask');
    const docs = buildDocs(data, today);
    const pick = ['b', 'a', 'c', 'e'].map((id) => docs.find((d) => d.id === id)!);
    const ctx = buildContext(pick, data, today);
    // soonest first: overdue, then today, then later
    expect(ctx.text).toContain(
      'Today and later (soonest first):\n[1] Renew passport — Tue Sep 15 2026 (17 days overdue) — open, should — notes: bring two photos\n[2] Buy groceries — Fri Oct 2 2026 (today) — done\n[3] Call the dentist about the cleaning — Mon Oct 5 2026 (in 3 days)',
    );
    expect(ctx.text).toMatch(/Streaming service — every month on the 12th — \$15.49 — next Mon Oct 12 2026 \(in 10 days\)/);
    expect(ctx.refs.length).toBe(4);
  });
});
