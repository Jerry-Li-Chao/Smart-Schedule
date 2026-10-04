import { useEffect, useState } from 'react';
import { Eraser, FileDown, Upload, X } from 'lucide-react';
import { S, useStore } from '../store';
import { clearPlanner, mergePlanner, summarize, switchPlanner, type PlannerFile, type SheetChoice } from '../lib/transfer';
import { cls } from '../lib/id';

type Mode = 'switch' | 'merge';

const sheetLabel = (name: string | undefined, url: string) => (name ? `the Google Sheet “${name}”` : `the Google Sheet …${url.replace(/\/exec$/, '').slice(-8)}`);

/** Preview a planner file, then switch to it or add it to this one — saying exactly what happens to the Google Sheet. */
export function ImportPlanner({ file, onClose }: { file: PlannerFile; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const connected = !!(settings.syncUrl && settings.syncToken);
  const sameSheet = !!file.sheet && file.sheet.url === settings.syncUrl;
  const [mode, setMode] = useState<Mode>('switch');
  const [sheet, setSheet] = useState<SheetChoice>(file.sheet ? 'file' : 'offline');
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const n = summarize(file.entities);
  const here = summarize(S().entities);
  const current = connected ? sheetLabel(settings.sheetName, settings.syncUrl) : '';

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    try {
      if (mode === 'merge') {
        const added = mergePlanner(file);
        S().toast(`Added ${added} item${added === 1 ? '' : 's'}${connected ? ` — they’ll sync to ${current}` : ''}`, [{ label: 'Undo', run: () => S().undo() }], 6000);
      } else {
        const saved = await switchPlanner(file, sheet);
        S().toast(`Planner replaced. The previous one was saved to ${saved.split('/').slice(-2).join('/')}`, undefined, 8000);
      }
      onClose();
    } catch (e) {
      S().toast(`Import failed: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  const stats = (x: ReturnType<typeof summarize>) =>
    (
      [
        [x.tasks, 'task'],
        [x.sticky, 'sticky note'],
        [x.repeats, 'repeat'],
        [x.bills, 'bill'],
        [x.projects, 'project'],
        [x.events, 'all-day event'],
      ] as [number, string][]
    )
      .filter(([v]) => v)
      .map(([v, l]) => `${v} ${l}${v === 1 ? '' : 's'}`)
      .join(' · ') || 'empty';

  const blocked = busy || (mode === 'switch' && sheet === 'upload' && !confirmUpload);

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal import-dlg">
        <div className="guide-head">
          <Upload size={16} />
          <b>Import a planner</b>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="imp-body">
          <div className="imp-file">
            <FileDown size={15} />
            <div>
              <b>In the file</b>
              {file.exportedAt && <span className="muted small"> · exported {new Date(file.exportedAt).toLocaleString()}</span>}
              <div className="small">{stats(n)}</div>
              <div className="small muted">
                {file.sheet ? `This planner syncs with ${sheetLabel(file.sheet.name, file.sheet.url)}` : 'Doesn’t say which Google Sheet it syncs with'}
              </div>
            </div>
          </div>

          <label className={cls('imp-opt', mode === 'switch' && 'on')}>
            <input type="radio" checked={mode === 'switch'} onChange={() => setMode('switch')} />
            <div>
              <b>Replace this planner with the file</b>
              <div className="small muted">
                Everything here ({stats(here)}) is replaced by what’s in the file. A copy of this planner is saved first, so you can come back to it.
              </div>
            </div>
          </label>

          {mode === 'switch' && (
            <div className="imp-sheet">
              <div className="sub-label">Then sync with which Google Sheet?</div>
              {file.sheet && (
                <label className="check-row small">
                  <input type="radio" checked={sheet === 'file'} onChange={() => setSheet('file')} />
                  <span>
                    The file’s own: {sheetLabel(file.sheet.name, file.sheet.url)}
                    {sameSheet ? ' (the one connected now)' : connected ? ` — instead of ${current}, which keeps its data untouched` : ''}
                  </span>
                </label>
              )}
              <label className="check-row small">
                <input type="radio" checked={sheet === 'offline'} onChange={() => setSheet('offline')} />
                <span>
                  None for now{connected && !sameSheet ? ` — disconnects from ${current}, which keeps this planner’s copy untouched` : ''}. You can connect one later in Settings.
                </span>
              </label>
              {connected && !sameSheet && (
                <label className="check-row small warn-opt">
                  <input type="radio" checked={sheet === 'upload'} onChange={() => setSheet('upload')} />
                  <span>
                    Keep {current}, and replace what’s in it with the file — <b>its current copy is overwritten</b> (older versions stay in its _app_history tab)
                  </span>
                </label>
              )}
              {sheet === 'upload' && (
                <label className="check-row small confirm-upload">
                  <input type="checkbox" checked={confirmUpload} onChange={(e) => setConfirmUpload(e.target.checked)} />I understand {current} will be overwritten
                </label>
              )}
            </div>
          )}

          <label className={cls('imp-opt', mode === 'merge' && 'on')}>
            <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
            <div>
              <b>Add the file to this planner</b>
              <div className="small muted">
                Brings in what’s new or newer; nothing here is removed{connected ? `. The additions also sync to ${current}` : ''}.
              </div>
            </div>
          </label>
        </div>
        <div className="guide-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button className={cls('btn', sheet === 'upload' && mode === 'switch' ? 'danger-solid' : 'primary')} disabled={blocked} onClick={go}>
            {busy ? 'Working…' : mode === 'merge' ? 'Add to this planner' : 'Replace this planner'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Empty the planner — a copy is saved first — and decide what happens to the Google Sheet. */
export function ClearPlanner({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const connected = !!(settings.syncUrl && settings.syncToken);
  const current = connected ? sheetLabel(settings.sheetName, settings.syncUrl) : '';
  const [scope, setScope] = useState<'this-device' | 'sheet-too'>('this-device');
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const here = summarize(S().entities);
  const total = here.tasks + here.sticky + here.repeats + here.projects + here.events;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    try {
      const saved = await clearPlanner(connected ? scope : 'this-device');
      S().toast(`Planner cleared. A copy was saved to ${saved.split('/').slice(-2).join('/')} — import it to get everything back.`, undefined, 9000);
      onClose();
    } catch (e) {
      S().toast(`Couldn’t clear: ${e instanceof Error ? e.message : e}`);
      setBusy(false);
    }
  };

  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal import-dlg">
        <div className="guide-head">
          <Eraser size={16} />
          <b>Clear this planner</b>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="imp-body">
          <div className="small">
            Removes all {total} items (tasks, sticky notes, repeats, bills, projects, events) and the change history, leaving an empty planner. Your preferences stay.
            A copy of the planner is saved first — import it any time to get everything back exactly as it was.
          </div>
          {connected && (
            <div className="imp-sheet" style={{ margin: 0 }}>
              <div className="sub-label">What about {current}?</div>
              <label className="check-row small">
                <input type="radio" checked={scope === 'this-device'} onChange={() => setScope('this-device')} />
                <span>Leave it as it is — this app disconnects from it, so it keeps its full copy of the planner</span>
              </label>
              <label className="check-row small warn-opt">
                <input type="radio" checked={scope === 'sheet-too'} onChange={() => setScope('sheet-too')} />
                <span>
                  Empty it too — <b>the planner disappears from the Google Sheet and your phone</b> (older versions stay in its _app_history tab)
                </span>
              </label>
            </div>
          )}
          <label className="check-row small confirm-upload">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            Yes, clear {connected && scope === 'sheet-too' ? 'the planner and the Google Sheet' : 'the planner'}
          </label>
        </div>
        <div className="guide-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <span className="spacer" />
          <button className="btn danger-solid" disabled={!sure || busy} onClick={go}>
            {busy ? 'Saving a copy…' : 'Clear planner'}
          </button>
        </div>
      </div>
    </div>
  );
}
