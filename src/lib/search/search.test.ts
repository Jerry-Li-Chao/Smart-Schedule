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
    expect(find('in august')).toEqual(['d', 'e']); // the monthly bill was running in August too
  });
  it('leaves out deleted things and repeats that have ended', () => {
    expect(find('deleted')).toEqual([]);
    expect(find('gym')).toEqual([]);
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
