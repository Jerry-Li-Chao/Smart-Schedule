import type { SearchDoc } from './docs';
import type { Filters } from './query';
import { passes, type TextHit } from './text';
import type { VecHit } from './vectors';

/**
 * Merge the text results and the meaning results into one list with Reciprocal Rank Fusion:
 * each list votes 1 / (K + rank) for its items, and the votes are added up.
 * It only looks at positions, never at the raw scores — which is the point: text scores and
 * cosine similarities are on completely different scales and can't be compared directly.
 */
const K = 60;

export interface Hit {
  doc: SearchDoc;
  /** document terms that matched as text (for highlighting) */
  terms: string[];
  /** found only by meaning, not by any word you typed */
  related: boolean;
  sim?: number;
}

export function fuse(text: TextHit[], vec: VecHit[], filters: Filters, limit = 40): Hit[] {
  const score = new Map<string, number>();
  const by = new Map<string, Hit>();
  text.forEach((h, rank) => {
    score.set(h.doc.id, (score.get(h.doc.id) ?? 0) + 1 / (K + rank + 1));
    by.set(h.doc.id, { doc: h.doc, terms: h.terms, related: false });
  });
  vec.forEach((h, rank) => {
    if (!passes(h.doc, filters)) return;
    score.set(h.doc.id, (score.get(h.doc.id) ?? 0) + 1 / (K + rank + 1));
    const had = by.get(h.doc.id);
    by.set(h.doc.id, had ? { ...had, sim: h.sim } : { doc: h.doc, terms: [], related: true, sim: h.sim });
  });
  return [...by.values()].sort((a, b) => score.get(b.doc.id)! - score.get(a.doc.id)!).slice(0, limit);
}
