import type { ISODate } from '../../types';
import { diffDays } from '../date';
import { dateWords, type SearchDoc } from './docs';
import type { Filters } from './query';

/**
 * Layer 1 — fast, forgiving text search.
 *
 * 1. Every document is broken into terms (words; Chinese/Japanese/Korean into single characters
 *    and pairs) and an *inverted index* maps each term to the documents containing it.
 * 2. Each query word is matched exactly, as a word start ("pass" → "passport") or with a typo
 *    ("pasport" → "passport"), each a little less valuable than the last.
 * 3. A match is worth more in the title than in notes, and rare terms are worth more than common
 *    ones (IDF — "inverse document frequency").
 * 4. Results that match more of the query come first; ties go to the higher score, nudged
 *    towards things near today.
 */

// ---------- turning text into terms ----------

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // é → e
    .normalize('NFKC') // full-width → normal
    .toLowerCase();
}

/** Very light stemming: "renewals" / "renewing" / "renewed" → "renew". Good enough for search. */
export function stem(w: string): string {
  // up to two passes, so "renewals" → "renewal" → "renew"
  for (let pass = 0; pass < 2; pass++) {
    if (w.length <= 4 || /\d/.test(w)) return w;
    const suf = ['ings', 'ing', 'ies', 'ed', 'es', 's', 'al'].find((x) => w.endsWith(x) && w.length - x.length >= 3);
    if (!suf) return w;
    w = suf === 'ies' ? w.slice(0, -3) + 'y' : w.slice(0, -suf.length);
  }
  return w;
}

export interface Term {
  t: string;
  /** a CJK pair — adds score but doesn't count as a separate query word */
  bonus?: boolean;
}

export function tokenize(s: string): Term[] {
  const out: Term[] = [];
  for (const run of normalize(s).match(/[\p{L}\p{N}]+/gu) ?? []) {
    let latin = '';
    let prev = '';
    const flush = () => {
      if (latin) out.push({ t: stem(latin) });
      latin = '';
    };
    for (const ch of run) {
      if (CJK.test(ch)) {
        flush();
        out.push({ t: ch });
        if (prev) out.push({ t: prev + ch, bonus: true });
        prev = ch;
      } else {
        latin += ch;
        prev = '';
      }
    }
    flush();
  }
  return out;
}

// ---------- the index ----------

const FIELDS: { key: 'title' | 'context' | 'notes' | 'when'; weight: number }[] = [
  { key: 'title', weight: 3 },
  { key: 'context', weight: 1.5 },
  { key: 'notes', weight: 1 },
  { key: 'when', weight: 0.5 },
];

export interface TextIndex {
  docs: SearchDoc[];
  /** term → (doc number → best field weight it appears in) */
  postings: Map<string, Map<number, number>>;
  /** every distinct term, for word-start and typo matching */
  vocab: string[];
}

export function buildTextIndex(docs: SearchDoc[]): TextIndex {
  const postings = new Map<string, Map<number, number>>();
  docs.forEach((d, i) => {
    const fields = { title: d.title, context: d.context, notes: d.notes, when: dateWords(d.date) };
    for (const f of FIELDS)
      for (const { t } of tokenize(fields[f.key])) {
        let p = postings.get(t);
        if (!p) postings.set(t, (p = new Map()));
        p.set(i, Math.max(p.get(i) ?? 0, f.weight));
      }
  });
  return { docs, postings, vocab: [...postings.keys()] };
}

// ---------- matching ----------

/** Edit distance (insert/delete/replace/swap), giving up early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1); // swapped letters
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Index terms a query term can stand for, with how much each is worth (exact 1, word start .75, typo .6). */
function expand(q: string, vocab: string[], postings: TextIndex['postings']): [string, number][] {
  const out: [string, number][] = [];
  if (postings.has(q)) out.push([q, 1]);
  if (CJK.test(q)) return out; // characters match exactly
  if (q.length >= 2) {
    let n = 0;
    for (const v of vocab) if (v !== q && v.startsWith(q) && n++ < 60) out.push([v, 0.75]);
  }
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1;
    for (const v of vocab) if (v !== q && !v.startsWith(q) && editDistance(q, v, max) <= max) out.push([v, 0.6]);
  }
  return out;
}

export interface TextHit {
  doc: SearchDoc;
  score: number;
  /** share of query words found, 0–1 */
  coverage: number;
  /** document terms that matched — for highlighting */
  terms: string[];
}

function passes(d: SearchDoc, f: Filters): boolean {
  if (f.status === 'done' && d.status !== 'done') return false;
  if (f.status === 'open' && d.status !== 'open') return false;
  if (f.importance && d.importance !== f.importance) return false;
  if (f.bills && !d.hasCost) return false;
  if (f.from || f.to) {
    if (!d.date) return false;
    // a repeat counts if it was running at some point in the range
    if (d.kind === 'repeat') return !f.to || d.date <= f.to;
    if (f.from && d.date < f.from) return false;
    if (f.to && d.date > f.to) return false;
  }
  return true;
}

const recency = (d: SearchDoc, today: ISODate) => (d.date ? 1 + 0.2 * Math.exp(-Math.abs(diffDays(today, d.date)) / 45) : 1);

export function searchText(idx: TextIndex, text: string, filters: Filters, today: ISODate, limit = 40): TextHit[] {
  const N = idx.docs.length || 1;
  const qTerms = tokenize(text);
  const words = qTerms.filter((x) => !x.bonus);

  // nothing typed but filters: everything that fits, newest first
  if (!qTerms.length) {
    return idx.docs
      .filter((d) => passes(d, filters))
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, limit)
      .map((doc) => ({ doc, score: 0, coverage: 1, terms: [] }));
  }

  const score = new Map<number, number>();
  const hits = new Map<number, number>(); // how many query words each doc matched
  const matched = new Map<number, Set<string>>();
  for (const q of qTerms) {
    const best = new Map<number, [number, string]>();
    for (const [term, factor] of expand(q.t, idx.vocab, idx.postings)) {
      const p = idx.postings.get(term)!;
      const idf = Math.log(1 + N / p.size);
      for (const [i, w] of p) {
        const v = factor * idf * w;
        if (v > (best.get(i)?.[0] ?? 0)) best.set(i, [v, term]);
      }
    }
    for (const [i, [v, term]] of best) {
      score.set(i, (score.get(i) ?? 0) + v * (q.bonus ? 0.5 : 1));
      if (!q.bonus) hits.set(i, (hits.get(i) ?? 0) + 1);
      if (!matched.has(i)) matched.set(i, new Set());
      matched.get(i)!.add(term);
    }
  }

  // short queries must match every word; longer ones most of them
  const need = words.length <= 2 ? words.length : Math.ceil(words.length * 0.6);
  const out: TextHit[] = [];
  for (const [i, s] of score) {
    const d = idx.docs[i];
    const h = hits.get(i) ?? 0;
    if (h < need || !passes(d, filters)) continue;
    out.push({ doc: d, score: s * recency(d, today), coverage: words.length ? h / words.length : 1, terms: [...matched.get(i)!] });
  }
  return out.sort((a, b) => b.coverage - a.coverage || b.score - a.score).slice(0, limit);
}

/** [start, end) ranges of `text` to highlight for the matched terms. */
export function highlightRanges(text: string, terms: string[]): [number, number][] {
  const low = normalize(text);
  if (low.length !== text.length) return []; // normalisation changed lengths — skip rather than mis-highlight
  const ranges: [number, number][] = [];
  for (const t of terms) {
    if (!t) continue;
    for (let i = low.indexOf(t); i >= 0; i = low.indexOf(t, i + t.length)) {
      // latin terms: only from the start of a word
      if (!CJK.test(t) && i > 0 && /[\p{L}\p{N}]/u.test(low[i - 1])) continue;
      let end = i + t.length;
      if (!CJK.test(t)) while (end < low.length && /[\p{L}\p{N}]/u.test(low[end])) end++; // the whole word
      ranges.push([i, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  return merged;
}
