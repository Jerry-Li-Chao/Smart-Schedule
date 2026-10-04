import { S } from '../../store';
import { request } from '../llm';
import type { SearchDoc } from './docs';

/**
 * Layer 2 — search by meaning.
 *
 * An *embedding model* turns a piece of text into a vector (here 1024 numbers) such that texts
 * with similar meaning end up pointing in similar directions. We embed every document once,
 * keep the vectors on this computer, and at search time embed the query and compare it with
 * all of them. Similarity = cosine of the angle between two vectors (1 = same direction).
 */

export const DEFAULT_EMBED_MODEL = 'bge-m3';
const BATCH = 24;

/**
 * What gets embedded for a document: what it's *about* — title, notes, project / repeat rule.
 * Not the date or status: measured on bge-m3, adding "Sat Jul 4 2026 · done" pulled
 * "teeth" ↔ "Call the dentist" from 0.67 down to 0.55. Dates and status are filters instead.
 */
export function embedText(d: SearchDoc): string {
  return [d.title, d.notes, d.context].filter(Boolean).join('\n');
}

/** Small, fast string hash (FNV-1a) — tells us when a document's text changed and needs a new vector. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Scale a vector to length 1, so that cosine similarity becomes a plain dot product. */
export function normalizeVec(v: ArrayLike<number>): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const model = () => S().settings.embedModel || DEFAULT_EMBED_MODEL;

/** Ask the local server (Ollama's OpenAI-compatible /embeddings) for vectors. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const r = (await request('POST', '/embeddings', { model: model(), input: texts })) as { data?: { embedding: number[]; index: number }[] };
  if (!r.data?.length) throw new Error('The model returned no embeddings — is it an embedding model?');
  return [...r.data].sort((a, b) => a.index - b.index).map((x) => normalizeVec(x.embedding));
}

// ---------- storage: one IndexedDB record per document, on this computer only ----------

interface Stored {
  id: string;
  hash: string;
  model: string;
  vec: Float32Array;
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open('planner-search', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('vectors', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('vectors', mode);
    const req = fn(t.objectStore('vectors'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

/** The vectors in memory, by document id (loaded from IndexedDB once). */
let mem: Map<string, Stored> | null = null;
async function loaded(): Promise<Map<string, Stored>> {
  if (mem) return mem;
  const all = ((await tx('readonly', (s) => s.getAll())) ?? []) as Stored[];
  mem = new Map(all.map((x) => [x.id, x]));
  return mem;
}

// ---------- keeping the index current ----------

let running: Promise<void> | null = null;
let rerun: SearchDoc[] | null = null;

/**
 * Make sure every document has an up-to-date vector: embed the new or changed ones in batches,
 * drop the ones that no longer exist. Safe to call often — it only does the missing work.
 */
export function syncIndex(docs: SearchDoc[]): Promise<void> {
  if (running) {
    rerun = docs;
    return running;
  }
  running = (async () => {
    const m = await loaded();
    const want = new Map(docs.map((d) => [d.id, { d, h: hash(embedText(d)) }]));
    const todo = [...want.values()].filter(({ d, h }) => {
      const s = m.get(d.id);
      return !s || s.hash !== h || s.model !== model();
    });
    const gone = [...m.keys()].filter((id) => !want.has(id));
    if (gone.length) {
      await tx('readwrite', (s) => void gone.forEach((id) => s.delete(id)));
      gone.forEach((id) => m.delete(id));
    }
    const total = want.size;
    const progress = (left: number) => S().setUI({ searchIndex: { state: left ? 'indexing' : 'ready', done: total - left, total } });
    progress(todo.length);
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const vecs = await embed(chunk.map(({ d }) => embedText(d)));
      const rows: Stored[] = chunk.map(({ d, h }, j) => ({ id: d.id, hash: h, model: model(), vec: vecs[j] }));
      await tx('readwrite', (s) => void rows.forEach((r) => s.put(r)));
      rows.forEach((r) => m.set(r.id, r));
      progress(todo.length - i - chunk.length);
    }
  })()
    .catch((e) => {
      S().setUI({ searchIndex: { state: 'error', done: 0, total: docs.length, error: e instanceof Error ? e.message : String(e) } });
    })
    .finally(() => {
      running = null;
      if (rerun) {
        const next = rerun;
        rerun = null;
        void syncIndex(next);
      }
    });
  return running;
}

/** Forget every stored vector (e.g. after switching models). */
export async function clearIndex() {
  await tx('readwrite', (s) => s.clear());
  mem = new Map();
}

export interface VecHit {
  doc: SearchDoc;
  sim: number;
}

/**
 * Cut-offs measured on bge-m3 with short task texts: related pairs scored 0.63+, unrelated ones
 * mostly below 0.56 (median 0.44; vague queries like "something about my car" reach ~0.61).
 *
 * (There used to be a second rule — drop anything 0.12 below the best match — but with many
 * similar tasks it threw away good ones: "跟朋友吃饭" scored 0.70 against a 0.90 near-duplicate.)
 */
export const MIN_SIM = 0.6;

/** Embed the query and compare it with every document's vector: brute force is plenty for thousands. */
export async function searchVectors(query: string, docs: SearchDoc[], limit = 30): Promise<VecHit[]> {
  const m = await loaded();
  if (!m.size) return [];
  const [q] = await embed([query]);
  const out: VecHit[] = [];
  for (const d of docs) {
    const s = m.get(d.id);
    if (!s || s.model !== model() || s.vec.length !== q.length) continue;
    const sim = dot(q, s.vec);
    if (sim >= MIN_SIM) out.push({ doc: d, sim });
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, limit);
}
