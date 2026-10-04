import { useMemo, useState } from 'react';
import { History as HistoryIcon, RotateCcw, Search, Trash2, Undo2 } from 'lucide-react';
import type { Entity, HistoryEntry } from '../types';
import { S, useStore } from '../store';
import { fmtDay } from '../lib/date';
import { restoreVersion } from '../actions';
import { Empty } from './ui';

const FIELDS: [string, string][] = [
  ['title', 'title'], ['date', 'day'], ['time', 'time'], ['status', 'status'], ['importance', 'importance'],
  ['deadline', 'deadline'], ['notes', 'notes'], ['deleted', 'deleted'], ['someday', 'someday'], ['parentId', 'order in project'],
];

function diff(a: Entity | null, b: Entity): string[] {
  if (!a) return ['created'];
  const out: string[] = [];
  const A = a as unknown as Record<string, unknown>;
  const B = b as unknown as Record<string, unknown>;
  for (const [k, label] of FIELDS) {
    const norm = (v: unknown) => JSON.stringify(v === false || v === '' || v === undefined ? null : v);
    if (norm(A[k]) === norm(B[k])) continue;
    if (k === 'notes' || k === 'parentId') out.push(`${label} changed`);
    else out.push(`${label}: ${fmt(A[k])} → ${fmt(B[k])}`);
  }
  const ca = (A.completions ?? {}) as Record<string, string>;
  const cb = (B.completions ?? {}) as Record<string, string>;
  for (const d of new Set([...Object.keys(ca), ...Object.keys(cb)]))
    if (ca[d] !== cb[d]) out.push(`${fmtDay(d)}: ${OCC[cb[d]] ?? 'reset to do'}`);
  if (JSON.stringify((A.recurrence as { until?: string })?.until) !== JSON.stringify((B.recurrence as { until?: string })?.until))
    out.push((B.recurrence as { until?: string })?.until ? `repeats until ${fmtDay((B.recurrence as { until: string }).until)}` : 'repeat end removed');
  if (!out.length && JSON.stringify(A.tracker) !== JSON.stringify(B.tracker)) out.push('tracker updated');
  return out;
}
const OCC: Record<string, string> = { done: 'done', dropped: 'skipped', deleted: 'deleted', moved: 'moved to another day' };
const fmt = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

/**
 * Every edit from every device, newest first. Restoring brings back one item's
 * version without touching anything else — the fix for "if I revert I lose my current entry".
 */
export function HistoryView() {
  const history = useStore((s) => s.history);
  const entities = useStore((s) => s.entities);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'changes' | 'trash'>('changes');

  const shown = useMemo(() => {
    const ql = q.toLowerCase();
    return history.filter((h) => !ql || h.after.title.toLowerCase().includes(ql) || h.label.toLowerCase().includes(ql)).slice(0, 400);
  }, [history, q]);
  const trash = useMemo(() => Object.values(entities).filter((e) => e.deleted && !e.purged).sort((a, b) => b.updatedAt - a.updatedAt), [entities]);

  const bytes = useMemo(() => new Blob([JSON.stringify(history)]).size, [history]);
  const clear = (days?: number) => {
    const what = days ? `history older than ${days} days` : 'all history';
    if (!window.confirm(`Clear ${what} on this device?\n\nYour tasks are not affected — only the record of past edits (and ⌘Z) is removed. The copy in the sheet's _app_history tab is kept.`)) return;
    const n = S().clearHistory(days ? Date.now() - days * 86400000 : undefined);
    S().toast(`Cleared ${n} history entr${n === 1 ? 'y' : 'ies'}`);
  };

  const groups = useMemo(() => {
    const m = new Map<string, HistoryEntry[]>();
    for (const h of shown) {
      const k = new Date(h.ts).toDateString();
      m.set(k, [...(m.get(k) ?? []), h]);
    }
    return [...m];
  }, [shown]);

  return (
    <div className="history">
      <div className="hist-bar">
        <div className="seg">
          <button className={tab === 'changes' ? 'on' : ''} onClick={() => setTab('changes')}>Changes</button>
          <button className={tab === 'trash' ? 'on' : ''} onClick={() => setTab('trash')}>Trash ({trash.length})</button>
        </div>
        {tab === 'changes' && (
          <label className="search">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task…" />
          </label>
        )}
        <span className="spacer" />
        <span className="hist-size" title="Space the edit history takes on this device">
          <HistoryIcon size={13} /> {history.length.toLocaleString()} changes · {fmtBytes(bytes)}
        </span>
        <button className="btn tiny" disabled={!history.length} onClick={() => clear(30)}>Clear older than 30 days</button>
        <button className="btn tiny danger" disabled={!history.length} onClick={() => clear()}>
          <Trash2 size={12} /> Clear all
        </button>
      </div>
      {tab === 'changes' && (
        <div className="hist-help">
          Each row is one change to one item. <b><Undo2 size={12} /> Undo this change</b> puts that item back exactly how it was just before it.{' '}
          <b><RotateCcw size={12} /> Go back to this version</b> sets the item to how it looked right after it. Either way only that one item changes,
          everything else stays as it is, and the restore shows up here too so you can reverse it.
        </div>
      )}
      {tab === 'trash' ? (
        <div className="hist-list">
          {!trash.length && <Empty>Trash is empty.</Empty>}
          {trash.map((e) => (
            <div key={e.id} className="hist-row">
              <div className="hist-main">
                <div>{e.title || 'Untitled'}</div>
                <div className="tiny muted">{e.type} · deleted {new Date(e.updatedAt).toLocaleString()}</div>
              </div>
              <button className="btn tiny" onClick={() => restoreVersion(e, 'Restored from trash')}>
                <RotateCcw size={12} /> Restore
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="hist-list">
          {!groups.length && <Empty>No changes yet.</Empty>}
          {groups.map(([day, list]) => (
            <div key={day}>
              <div className="hist-day">{day}</div>
              {list.map((h) => {
                const cur = entities[h.id];
                const isCurrent = cur && cur.updatedAt === h.after.updatedAt;
                return (
                  <div key={h.hid} className="hist-row">
                    <span className="hist-time">{new Date(h.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    <div className="hist-main">
                      <div>{h.label}</div>
                      <div className="tiny muted">
                        {diff(h.before, h.after).join(' · ')} · {h.source === 'remote' ? `synced from ${h.device ?? 'another device'}` : h.device}
                      </div>
                    </div>
                    {isCurrent && !h.after.deleted && <span className="pill">current version</span>}
                    {h.before && (
                      <button
                        className="btn tiny ghost"
                        title={`Put “${h.before.title}” back exactly how it was just before this change. Only this item is affected.`}
                        onClick={() => restoreVersion(h.before!, 'Undid one change')}
                      >
                        <Undo2 size={12} /> Undo this change
                      </button>
                    )}
                    {!isCurrent && !h.after.deleted && (
                      <button className="btn tiny ghost" title={`Set “${h.after.title}” to how it looked right after this change. Only this item is affected.`} onClick={() => restoreVersion(h.after)}>
                        <RotateCcw size={12} /> Go back to this version
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
