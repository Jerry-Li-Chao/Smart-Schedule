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

const KIND: Record<DocKind, { icon: typeof Search; label: string }> = {
  task: { icon: CalendarDays, label: 'Task' },
  sticky: { icon: StickyNote, label: 'Sticky note' },
  repeat: { icon: Repeat, label: 'Repeat' },
  event: { icon: CalendarDays, label: 'All-day' },
  project: { icon: FolderKanban, label: 'Project' },
};

const EXAMPLES = ['passport', 'dentist next week', 'bills', 'done last month', 'must', '牙医'];

/** ⌘K search over everything in the planner. */
export function SearchPanel({ today }: { today: ISODate }) {
  const entities = useStore((s) => s.entities);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => S().setUI({ search: false });

  // the index is rebuilt only when the planner changes, not on every keystroke
  const index = useMemo(() => buildTextIndex(buildDocs(entities, today)), [entities, today]);
  const parsed = useMemo(() => parseQuery(q, today), [q, today]);
  const textHits = useMemo(() => (q.trim() ? searchText(index, parsed.text, parsed.filters, today) : []), [index, parsed, q, today]);

  // layer 2: a moment after typing stops, ask the embedding model and merge what it finds
  const semantic = useStore((s) => !!s.settings.semanticSearch && s.ui.searchIndex?.state !== 'off');
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

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.sr-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const open = (d: SearchDoc) => {
    close();
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
    else if (e.key === 'Enter' && hits[sel] && !e.nativeEvent.isComposing) open(hits[sel].doc);
  };

  const f = parsed.filters;
  const chips = [f.dateLabel, f.status === 'done' ? 'done' : f.status === 'open' ? 'not done' : '', f.importance, f.bills ? 'bills' : ''].filter(Boolean);

  return (
    <div className="modal-bg search-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="search-panel" onKeyDown={onKey}>
        <div className="sp-input">
          <Search size={17} />
          <input autoFocus value={q} placeholder="Search tasks, notes, repeats, projects…" onChange={(e) => setQ(e.target.value)} />
          {q && (
            <button className="icon-btn" title="Clear" onClick={() => setQ('')}>
              <X size={14} />
            </button>
          )}
          {thinking && <Loader2 size={14} className="spin" aria-label="Searching by meaning" />}
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
            <Row key={h.doc.id} h={h} on={i === sel} today={today} onPick={() => open(h.doc)} onHover={() => setSel(i)} />
          ))}
        </div>
        {hits.length > 0 && (
          <div className="sp-foot small muted">
            {hits.length} result{hits.length > 1 ? 's' : ''} · <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>↵</kbd> to open
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

function Row({ h, on, today, onPick, onHover }: { h: Hit; on: boolean; today: ISODate; onPick: () => void; onHover: () => void }) {
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
