import { useEffect, useState } from 'react';
import { FileDown, Upload, X } from 'lucide-react';
import { S, useStore } from '../store';
import { mergePlanner, summarize, switchPlanner, type PlannerFile, type SheetChoice } from '../lib/transfer';
import { cls } from '../lib/id';

type Mode = 'switch' | 'merge';

const sheetLabel = (name: string | undefined, url: string) => (name ? `“${name}”` : `the sheet …${url.replace(/\/exec$/, '').slice(-8)}`);

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
        S().toast(`Switched planners. Your previous one was saved to ${saved.split('/').slice(-2).join('/')}`, undefined, 8000);
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
                {file.sheet ? `Includes its Google Sheet: ${sheetLabel(file.sheet.name, file.sheet.url)}` : 'No Google Sheet connection in the file'}
              </div>
            </div>
          </div>

          <label className={cls('imp-opt', mode === 'switch' && 'on')}>
            <input type="radio" checked={mode === 'switch'} onChange={() => setMode('switch')} />
            <div>
              <b>Switch to this planner</b>
              <div className="small muted">
                Replaces what’s here ({stats(here)}). A copy of your current planner is saved first, so you can switch back.
              </div>
            </div>
          </label>

          {mode === 'switch' && (
            <div className="imp-sheet">
              <div className="sub-label">Google Sheet</div>
              {file.sheet && (
                <label className="check-row small">
                  <input type="radio" checked={sheet === 'file'} onChange={() => setSheet('file')} />
                  <span>
                    Sync with the planner’s own sheet, {sheetLabel(file.sheet.name, file.sheet.url)}
                    {sameSheet ? ' (the one connected now)' : connected ? ` — instead of ${current}, which keeps its data untouched` : ''}
                  </span>
                </label>
              )}
              <label className="check-row small">
                <input type="radio" checked={sheet === 'offline'} onChange={() => setSheet('offline')} />
                <span>
                  Don’t sync for now{connected && !sameSheet ? ` — disconnects from ${current}, which keeps the old planner untouched` : ''}. You can connect a sheet later in Settings.
                </span>
              </label>
              {connected && !sameSheet && (
                <label className="check-row small warn-opt">
                  <input type="radio" checked={sheet === 'upload'} onChange={() => setSheet('upload')} />
                  <span>
                    Put this planner into {current} — <b>its current planner is replaced</b> (older versions stay in its history tab)
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
              <b>Add to this planner</b>
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
            {busy ? 'Working…' : mode === 'merge' ? 'Add to this planner' : 'Switch planners'}
          </button>
        </div>
      </div>
    </div>
  );
}
