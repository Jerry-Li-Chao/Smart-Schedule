import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, CircleCheck, FolderKanban, Loader2, Repeat, Search, Sparkles, StickyNote, X } from 'lucide-react';
import type { ISODate } from '../types';
import { S, useStore } from '../store';
import { fmtDay } from '../lib/date';
import { cls } from '../lib/id';
import { jumpTo } from '../actions';
import { buildDocs, type DocKind, type SearchDoc } from '../lib/search/docs';
import { parseQuery } from '../lib/search/query';
import { buildTextIndex, highlightRanges, normalize, searchText } from '../lib/search/text';
import { searchVectors, type VecHit } from '../lib/search/vectors';
import { fuse, type Hit } from '../lib/search/hybrid';
import { buildContext, isQuestion } from '../lib/search/ask';
import { askStream, warmUp } from '../lib/search/askLlm';

const KIND: Record<DocKind, { icon: typeof Search; label: string }> = {
  task: { icon: CalendarDays, label: 'Task' },
  sticky: { icon: StickyNote, label: 'Sticky note' },
  repeat: { icon: Repeat, label: 'Repeat' },
  event: { icon: CalendarDays, label: 'All-day' },
  project: { icon: FolderKanban, label: 'Project' },
};

const EXAMPLES = ['passport', 'dentist next week', 'bills', 'done last month', 'must', '牙医'];

/**
 * The last search survives closing the panel — open a result, look, press ⌘K (or "Back to search")
 * and the query, the answer and the results you already opened are all still there.
 */
const last: { q: string; answer: Answer | null; sel: number; visited: Set<string> } = { q: '', answer: null, sel: 0, visited: new Set() };
/** Forget the last search (the × in the panel, or dismissing the "Back to search" button). */
export function forgetSearch() {
  last.q = '';
  last.answer = null;
  last.sel = 0;
  last.visited = new Set();
  S().setUI({ searchReturn: undefined });
}

/** ⌘K search over everything in the planner. */
export function SearchPanel({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [q, setQ] = useState(last.q);
  const [sel, setSel] = useState(last.sel);
  const [visited, setVisited] = useState(last.visited);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restored = useRef(!!last.q);
  useEffect(() => {
    S().setUI({ searchReturn: undefined });
    // coming back to a search: select the text, so typing starts a new one and ↑↓ continue the old one
    if (restored.current) inputRef.current?.select();
  }, []);
  const close = () => S().setUI({ search: false });

  // the index is rebuilt only when the planner changes, not on every keystroke
  const index = useMemo(() => buildTextIndex(buildDocs(entities, today)), [entities, today]);
  const parsed = useMemo(() => parseQuery(q, today), [q, today]);
  const textHits = useMemo(() => (q.trim() ? searchText(index, parsed.text, parsed.filters, today) : []), [index, parsed, q, today]);

  // layer 2: a moment after typing stops, ask the embedding model and merge what it finds
  const semantic = useStore((s) => s.settings.semanticSearch !== false && s.ui.searchIndex?.state !== 'off');
  const [vec, setVec] = useState<{ q: string; hits: VecHit[] } | null>(null);
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    const text = parsed.text.trim();
    if (!semantic || text.length < 3) return setVec(null);
    let live = true;
    const t = setTimeout(async () => {
      setThinking(true);
      try {
        const hits = await searchVectors(text, index.docs);
        if (live) setVec({ q: text, hits });
      } catch {
        if (live) setVec(null); // model unavailable: text results alone are still fine
      } finally {
        if (live) setThinking(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [parsed.text, semantic, index]);
  const hits: Hit[] = useMemo(
    () => fuse(textHits, vec && vec.q === parsed.text.trim() ? vec.hits : [], parsed.filters),
    [textHits, vec, parsed],
  );

  // layer 3: answer questions from the retrieved items, streamed from the local LLM
  const llmOk = useStore((s) => !!(s.settings.llmEnabled && s.settings.llmUrl && s.settings.llmModel));
  const [answer, setAnswer] = useState<Answer | null>(last.answer);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    if (llmOk) warmUp(); // load the model while the user is still typing
    return () => abort.current?.abort();
  }, [llmOk]);
  const ask = (question: string) => {
    if (!llmOk || !question.trim()) return;
    // nothing matched the words, but there are filters ("bills coming up"): read what fits the filters
    const pool = hits.length ? hits.map((h) => h.doc) : searchText(index, '', parsed.filters, today).map((h) => h.doc);
    const ctx = buildContext(pool, entities, today, question);
    const key = `${question.trim()}|${ctx.refs.join(',')}`;
    if (answer?.key === key) return;
    const hit = answerCache.get(key);
    if (hit) return setAnswer(hit);
    abort.current?.abort();
    const ctl = (abort.current = new AbortController());
    const docs = Object.fromEntries(pool.map((d) => [d.id, d]));
    let text = '';
    const t0 = performance.now();
    setAnswer({ key, q: question, text: '', refs: ctx.refs.map((id) => docs[id]), state: 'thinking' });
    askStream(question, ctx, today, (d) => {
      text += d;
      setAnswer((a) => (a?.key === key ? { ...a, text, state: 'streaming' } : a));
    }, ctl.signal)
      .then(() => {
        if (ctl.signal.aborted) return;
        const done: Answer = { key, q: question, text: text.trim() || 'No answer came back.', refs: ctx.refs.map((id) => docs[id]), state: 'done', ms: performance.now() - t0 };
        answerCache.set(key, done);
        setAnswer((a) => (a?.key === key ? done : a));
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setAnswer((a) => (a?.key === key ? { ...a, state: 'error', text: e instanceof Error ? e.message : String(e) } : a));
      });
  };
  // questions get an answer by themselves: once meaning results are in, or after ~1 s at most —
  // never held up by a slow embedding call. One automatic answer per question.
  const question = isQuestion(q);
  const autoFor = useRef(last.q.trim());
  useEffect(() => {
    if (!question || !llmOk || autoFor.current === q.trim()) return;
    const go = () => {
      autoFor.current = q.trim();
      ask(q);
    };
    const t = setTimeout(go, thinking ? 1100 : 450);
    return () => clearTimeout(t);
  }, [question, llmOk, thinking, q]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (answer && answer.q.trim() !== q.trim()) {
      abort.current?.abort();
      setAnswer(null);
    }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (restored.current) return void (restored.current = false); // keep the restored selection once
    setSel(0);
  }, [q]);
  useEffect(() => {
    last.q = q;
    last.sel = sel;
    last.answer = answer?.state === 'done' ? answer : last.answer?.q === q ? last.answer : null;
  }, [q, sel, answer]);
  const clear = () => {
    forgetSearch();
    setVisited(new Set());
    setQ('');
    inputRef.current?.focus();
  };
  useEffect(() => {
    listRef.current?.querySelector('.sr-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const open = (d: SearchDoc) => {
    last.visited = new Set(visited).add(d.id);
    close();
    S().setUI({ searchReturn: q.trim() || undefined });
    if (d.kind === 'project') return S().setUI({ view: 'projects', projectId: d.id });
    if (d.kind === 'repeat') return S().setUI({ view: 'repeats', selectedId: d.id, occDate: undefined });
    if (d.date) jumpTo(d.date);
    else S().setUI({ view: 'timeline' });
    S().setUI({ selectedId: d.id, occDate: undefined });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((i) => Math.min(hits.length - 1, i + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((i) => Math.max(0, i - 1)));
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.preventDefault(), ask(q));
    else if (e.key === 'Enter' && hits[sel] && !e.nativeEvent.isComposing) open(hits[sel].doc);
  };

  const f = parsed.filters;
  const chips = [f.dateLabel, f.status === 'done' ? 'done' : f.status === 'open' ? 'not done' : '', f.importance, f.bills ? 'bills' : ''].filter(Boolean);

  return (
    <div className="modal-bg search-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="search-panel" onKeyDown={onKey}>
        <div className="sp-input">
          <Search size={17} />
          <input ref={inputRef} autoFocus value={q} placeholder="Search tasks, notes, repeats, projects…" onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="icon-btn" title="Clear and start a new search" onClick={clear}>
              <X size={14} />
            </button>
          )}
          {thinking && <Loader2 size={14} className="spin" aria-label="Searching by meaning" />}
          {llmOk && q.trim() && (
            <button className={cls('btn tiny ask-btn', question && 'auto')} title="Ask your local AI about this (⌘↵)" onClick={() => ask(q)}>
              <Sparkles size={12} /> Ask
            </button>
          )}
          <kbd>esc</kbd>
        </div>
        {chips.length > 0 && (
          <div className="sp-chips">
            <span className="muted small">Filtered to</span>
            {chips.map((c) => (
              <span key={c} className="sp-chip">
                {c}
              </span>
            ))}
          </div>
        )}

        <div className="sp-results" ref={listRef}>
          {answer && <AnswerCard a={answer} onOpen={open} />}
          {!q.trim() && (
            <div className="sp-empty">
              <div className="small muted">Search by words you remember — typos and partial words are fine. Try:</div>
              <div className="sp-examples">
                {EXAMPLES.map((x) => (
                  <button key={x} className="chip-btn" onClick={() => setQ(x)}>
                    {x}
                  </button>
                ))}
              </div>
            </div>
          )}
          {q.trim() && !hits.length && (
            <div className="sp-empty small muted">{thinking ? 'No word matches — looking for things that mean the same…' : `Nothing found for “${q}”.`}</div>
          )}
          {hits.map((h, i) => (
            <Row key={h.doc.id} h={h} on={i === sel} seen={visited.has(h.doc.id)} today={today} onPick={() => open(h.doc)} onHover={() => setSel(i)} />
          ))}
        </div>
        {hits.length > 0 && (
          <div className="sp-foot small muted">
            {hits.length} result{hits.length > 1 ? 's' : ''} · <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>↵</kbd> to open · this search stays here until you clear it
          </div>
        )}
      </div>
    </div>
  );
}

function Mark({ text, terms }: { text: string; terms: string[] }) {
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) out.push(text.slice(at, a));
    out.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** The line of the notes where a term appears, if the title didn't match. */
function noteSnippet(notes: string, terms: string[]): string | null {
  if (!notes) return null;
  const lines = notes.split('\n');
  const hit = lines.find((l) => terms.some((t) => normalize(l).includes(t)));
  return hit ? hit.trim().slice(0, 120) : null;
}

function Row({ h, on, seen, today, onPick, onHover }: { h: Hit; on: boolean; seen: boolean; today: ISODate; onPick: () => void; onHover: () => void }) {
  const d = h.doc;
  const K = KIND[d.kind];
  const snippet = noteSnippet(d.notes, h.terms);
  return (
    <div className={cls('sr-row', on && 'on', d.status !== 'open' && 'closed')} onClick={onPick} onMouseMove={onHover}>
      <K.icon size={15} className="sr-icon" />
      <div className="sr-main">
        <div className="sr-title">
          {d.status === 'done' && <CircleCheck size={13} className="sr-done" />}
          <Mark text={d.title} terms={h.terms} />
        </div>
        {snippet && (
          <div className="sr-snip">
            <Mark text={snippet} terms={h.terms} />
          </div>
        )}
      </div>
      <div className="sr-meta">
        {seen && <span className="sr-seen" title="You opened this from this search">opened</span>}
        {h.related && (
          <span className="sr-related" title="No word matched — found because it means something similar">
            <Sparkles size={10} /> related
          </span>
        )}
        {d.projectTitle && <span className="sr-proj">{d.projectTitle}</span>}
        <span>{d.kind === 'repeat' ? K.label : d.date ? fmtDay(d.date, today) : K.label}</span>
      </div>
    </div>
  );
}

interface Answer {
  key: string;
  q: string;
  text: string;
  /** item [n] → document */
  refs: SearchDoc[];
  state: 'thinking' | 'streaming' | 'done' | 'error';
  ms?: number;
}
/** Same question over the same items → same answer; no need to ask twice. */
const answerCache = new Map<string, Answer>();

/** The answer, with [n] citations turned into links to the items. */
function AnswerCard({ a, onOpen }: { a: Answer; onOpen: (d: SearchDoc) => void }) {
  const parts = a.text.split(/(\[\d+\])/g);
  return (
    <div className={cls('answer', a.state === 'error' && 'err')}>
      <div className="ans-head">
        <Sparkles size={13} /> <b>Answer</b>
        <span className="spacer" />
        {a.state === 'thinking' && (
          <span className="muted small">
            <Loader2 size={12} className="spin" /> reading {a.refs.length} item{a.refs.length === 1 ? '' : 's'}…
          </span>
        )}
        {a.state === 'done' && a.ms !== undefined && <span className="muted small">{(a.ms / 1000).toFixed(1)} s</span>}
      </div>
      <div className="ans-text">
        {a.state === 'error'
          ? `Couldn’t get an answer: ${a.text}`
          : parts.map((p, i) => {
              const m = /^\[(\d+)\]$/.exec(p);
              const doc = m ? a.refs[Number(m[1]) - 1] : undefined;
              return doc ? (
                <button key={i} className="cite" title={doc.title} onClick={() => onOpen(doc)}>
                  {m![1]}
                </button>
              ) : (
                <span key={i}>{p}</span>
              );
            })}
        {a.state === 'streaming' && <span className="caret" />}
      </div>
      {a.state === 'done' && <div className="ans-foot">From your planner, by your local AI — it can be wrong, so check the linked items.</div>}
    </div>
  );
}
