import { useEffect, useRef, useState } from 'react';
import { Check, FolderPlus, GitBranch, Plus, Trash2, X } from 'lucide-react';
import { S, useStore } from '../store';
import { fmtDay } from '../lib/date';
import { addManyToProject, batchStatus, deleteMany, deleteSelection, describeKeys, projects } from '../actions';
import { isSubmitKey } from './ui';

/** Floating bar shown while several cards are selected (⌘/Shift-click). */
export function SelectionBar() {
  const multi = useStore((s) => s.ui.multi);
  if (!multi?.length) return null;
  return (
    <div className="sel-bar">
      <b>{multi.length} selected</b>
      <span className="muted small">⌘/Shift-click to add more</span>
      <button className="btn tiny" onClick={() => batchStatus(multi, 'done')}>
        <Check size={13} /> Done
      </button>
      <ProjectPicker keys={multi} />
      <button className="btn tiny danger-outline" onClick={deleteSelection}>
        <Trash2 size={13} /> Delete <kbd>⌫</kbd>
      </button>
      <button className="icon-btn" title="Clear selection (Esc)" onClick={() => S().setUI({ multi: undefined })}>
        <X size={14} />
      </button>
    </div>
  );
}

export function BatchDeleteDialog() {
  const ask = useStore((s) => s.ui.batchAsk);
  const multi = useStore((s) => s.ui.multi) ?? [];
  const [dontAsk, setDontAsk] = useState(false);
  const close = () => S().setUI({ batchAsk: false });
  const confirm = () => {
    if (dontAsk) S().setSettings({ confirmBatchDelete: false });
    deleteMany(multi);
  };
  useEffect(() => {
    if (!ask) return;
    setDontAsk(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ask || !multi.length) return null;
  const items = describeKeys(multi);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal confirm">
        <div className="confirm-head">
          <Trash2 size={16} />
          <b>Delete {items.length} item{items.length > 1 ? 's' : ''}?</b>
        </div>
        <div className="confirm-body">
          <ul className="batch-list">
            {items.slice(0, 8).map((i) => (
              <li key={i.key}>
                {i.title}
                {i.date && <span className="muted"> · only {fmtDay(i.date)}</span>}
              </li>
            ))}
            {items.length > 8 && <li className="muted">…and {items.length - 8} more</li>}
          </ul>
          <div className="tiny muted">Repeating tasks only lose the selected day. You can undo with ⌘Z or restore from History → Trash.</div>
          <label className="check-row small">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
            Don’t ask again for batch deletes (turn back on in Settings)
          </label>
          <div className="confirm-actions">
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn danger-solid" autoFocus onClick={confirm}>
              Delete {items.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Add to project…": pick an existing project or name a new one. */
function ProjectPicker({ keys }: { keys: string[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const list = open ? projects().filter((p) => p.status !== 'done') : [];
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && e.target instanceof Node && !ref.current.contains(e.target) && setOpen(false);
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);
  const create = () => {
    if (!name.trim()) return;
    addManyToProject(keys, { newTitle: name.trim() });
    setOpen(false);
    setName('');
  };
  return (
    <div className="proj-pick" ref={ref}>
      <button className="btn tiny" onClick={() => setOpen((o) => !o)}>
        <FolderPlus size={13} /> Add to project…
      </button>
      {open && (
        <div className="proj-pop">
          <div className="pp-head">
            Add {keys.length} as steps, <b>in time order</b>
          </div>
          {list.map((p) => (
            <button key={p.id} className="pp-item" onClick={() => (addManyToProject(keys, { projectId: p.id }), setOpen(false))}>
              <span className="dot" style={{ background: p.color }} />
              <span className="pp-name">{p.title}</span>
              <GitBranch size={12} className="muted" />
            </button>
          ))}
          {!list.length && <div className="pp-empty">No projects yet — create one:</div>}
          <div className="pp-new">
            <Plus size={13} />
            <input
              autoFocus={!list.length}
              value={name}
              placeholder="New project name…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => isSubmitKey(e) && create()}
            />
            <button className="btn tiny primary" disabled={!name.trim()} onClick={create}>
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
