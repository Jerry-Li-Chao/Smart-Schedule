import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ArrowRight, Link as LinkIcon, Unlink, CheckCircle2, CloudUpload, FileSpreadsheet, Link2, RefreshCw, TableProperties } from 'lucide-react';
import type { Task } from '../types';
import { S, useStore } from '../store';
import { addDays, fmtDay, fromISO, todayISO } from '../lib/date';
import { apiCall, syncConfigured, syncNow } from '../lib/sync';
import { inAppsScript } from '../lib/bridge';
import { legacyToTasks, parseHeaderDates, type LegacySheet } from '../lib/importLegacy';
import { readXlsx } from '../lib/xlsxImport';
import { cls } from '../lib/id';
import { Field, Segmented } from './ui';
import { SetupGuide } from './SetupGuide';

function ago(ms?: number) {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
}

type Linked = { sheet: string; from: string } | null;
type Ping = { spreadsheet: string; sheets: string[]; linked?: Linked };

/**
 * Two separate jobs:
 *  App → Google Sheet: every change you make is written to your Google Sheet automatically (and phone edits come back).
 *  Google Sheet → App: import an existing day-column tab (preview first); optionally keep that tab linked so the app
 *  keeps writing back into it.
 */
export function SheetSync() {
  const settings = useStore((s) => s.settings);
  const [ping, setPing] = useState<Ping | null>(null);
  const [err, setErr] = useState('');
  const [testing, setTesting] = useState(false);
  const [guide, setGuide] = useState(false);
  const set = S().setSettings;

  const test = async () => {
    setTesting(true);
    setErr('');
    try {
      const r = await apiCall<Ping>({ action: 'ping' });
      if (!r.ok) throw new Error(r.error);
      setPing({ spreadsheet: r.spreadsheet, sheets: r.sheets, linked: r.linked ?? null });
    } catch (e) {
      setPing(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };
  useEffect(() => {
    if (syncConfigured()) void test();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section>
        <h2>
          <Link2 size={16} /> Google Sheet connection
        </h2>
        <div className="guide-cta">
          <div>
            <b>First time?</b> A step-by-step guide walks you through it in about 5 minutes — the script is one click to copy.
          </div>
          <button className="btn primary" onClick={() => setGuide(true)}>
            <BookOpen size={14} /> Step-by-step setup
          </button>
        </div>
        <div className="row2">
          {!inAppsScript() && (
            <Field label="Apps Script web-app URL" hint="Ends in /exec">
              <input value={settings.syncUrl} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => set({ syncUrl: e.target.value.trim() })} />
            </Field>
          )}
          <Field label="Sync token" hint="Printed when you run setup() in the script editor">
            <input type="password" value={settings.syncToken} onChange={(e) => set({ syncToken: e.target.value.trim() })} autoComplete="off" />
          </Field>
        </div>
        <div className="inline gap">
          <button className="btn" onClick={test} disabled={testing}>
            {testing ? 'Connecting…' : 'Test connection'}
          </button>
          {ping && (
            <span className="ok-text small">
              <CheckCircle2 size={13} /> Connected to “{ping.spreadsheet}”
            </span>
          )}
          {err && <span className="err-text small">{err}</span>}
        </div>
      </section>

      {guide && <SetupGuide onClose={() => setGuide(false)} onConnected={(spreadsheet, sheets) => setPing({ spreadsheet, sheets, linked: null })} />}
      <div className="sync-grid">
        <PushCard connected={!!ping} linked={ping?.linked ?? null} onUnlinked={() => ping && setPing({ ...ping, linked: null })} />
        <ImportCard ping={ping} onLinked={(l) => ping && setPing({ ...ping, linked: l })} />
      </div>
    </>
  );
}

function PushCard({ connected, linked, onUnlinked }: { connected: boolean; linked: Linked; onUnlinked: () => void }) {
  const settings = useStore((s) => s.settings);
  const pending = useStore((s) => Object.keys(s.dirty).length);
  const syncing = useStore((s) => s.ui.syncing);
  const [mirror, setMirror] = useState('');
  const auto = settings.autoSync !== false;
  const rebuild = async () => {
    setMirror('Rebuilding…');
    try {
      const r = await apiCall({ action: 'mirror' });
      setMirror(r.ok ? 'Calendar tab rebuilt ✓' : r.error ?? 'Failed');
    } catch (e) {
      setMirror(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className={cls('sync-card', !connected && 'disabled')}>
      <div className="sync-dir">
        <span>App</span>
        <ArrowRight size={16} />
        <span>Google Sheet</span>
        <span className="pill">{auto ? 'automatic' : 'manual'}</span>
      </div>
      <h3>Keep my Google Sheet updated with my changes</h3>
      {!connected && <div className="card-notice">Connect your Google Sheet above to turn this on.</div>}
      <label className="check-row">
        <input type="checkbox" checked={auto} onChange={(e) => S().setSettings({ autoSync: e.target.checked })} />
        <span>
          Update automatically — a few seconds after every change, and every minute
          <span className="field-hint"> (off: only when you press Sync now)</span>
        </span>
      </label>
      <div className="writes">
        <div className="writes-title">What’s written to your spreadsheet</div>
        <div className="write-row">
          <TableProperties size={14} />
          <div>
            <b>Calendar (app)</b> — your familiar day-columns with the same colours, 7 days back to 6 weeks ahead. Rebuilt on every change. Read-only: edit in the app.
          </div>
        </div>
        <div className="write-row">
          <FileSpreadsheet size={14} />
          <div>
            <b>_app_data</b> (hidden) — one row per task. This is the synced copy your phone reads.
          </div>
        </div>
        <div className="write-row">
          <RefreshCw size={14} />
          <div>
            <b>_app_history</b> (hidden) — every version that was ever overwritten, so nothing is lost.
          </div>
        </div>
        {linked && (
          <div className="write-row linked-row">
            <LinkIcon size={14} />
            <div>
              <b>{linked.sheet}</b> (linked) — your original tab, rewritten in its own layout for days from {fmtDay(linked.from)} on. Earlier columns are left
              alone; new days get new columns.{' '}
              <button
                className="link-btn"
                onClick={async () => {
                  const r = await apiCall({ action: 'unlink' });
                  if (r.ok) onUnlinked();
                }}
              >
                <Unlink size={11} /> Unlink
              </button>
            </div>
          </div>
        )}
        <div className="tiny muted">{linked ? 'Other tabs' : 'Your other tabs'} are never touched. Edits made on your phone flow back into this app on the same sync.</div>
      </div>
      <div className="sync-status">
        <span className={cls('small', settings.lastSyncError ? 'err-text' : 'muted')}>
          {settings.lastSyncError ? `Problem: ${settings.lastSyncError}` : `Last synced ${ago(settings.lastSyncAt)} · ${pending} change${pending === 1 ? '' : 's'} waiting`}
        </span>
      </div>
      <div className="inline gap">
        <button className="btn primary" disabled={!connected || syncing} onClick={() => syncNow()}>
          <CloudUpload size={14} /> {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <button className="btn" disabled={!connected} onClick={rebuild}>
          Rebuild Calendar tab
        </button>
        {mirror && <span className="small muted">{mirror}</span>}
      </div>
    </section>
  );
}

type Source = 'sheet' | 'xlsx';
interface Preview {
  tasks: Task[];
  cells: number;
  merged: number;
  skipped: number;
}

function ImportCard({ ping, onLinked }: { ping: Ping | null; onLinked: (l: Linked) => void }) {
  const today = todayISO();
  const [source, setSource] = useState<Source>(ping ? 'sheet' : 'xlsx');
  const [file, setFile] = useState<{ name: string; sheets: LegacySheet[] } | null>(null);
  const [tab, setTab] = useState('');
  const [from, setFrom] = useState(addDays(today, -30));
  const [to, setTo] = useState('');
  const [policy, setPolicy] = useState<'keep' | 'obsolete'>('keep');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [keepLinked, setKeepLinked] = useState(true);

  const tabs = source === 'sheet' ? ping?.sheets ?? [] : file?.sheets.map((s) => s.name) ?? [];
  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs.find((s) => /plan|schedule|calendar|20\d\d/i.test(s)) ?? tabs[0] ?? '');
    setPreview(null);
  }, [source, ping, file]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setPreview(null), [tab, from, to, policy]);

  const load = async (): Promise<LegacySheet> => {
    if (source === 'xlsx') {
      const s = file?.sheets.find((x) => x.name === tab);
      if (!s) throw new Error('Choose a file and tab first.');
      return s;
    }
    const r = await apiCall<{ sheet: LegacySheet }>({ action: 'legacy', sheet: tab });
    if (!r.ok) throw new Error(r.error);
    return r.sheet;
  };

  const runPreview = async () => {
    setBusy(true);
    setMsg('');
    try {
      const sheet = await load();
      const opts = { from, to: to || undefined, today, oldUnfinished: policy };
      const all = legacyToTasks(sheet, { ...opts, existing: new Set() });
      const fresh = legacyToTasks(sheet, { ...opts, existing: new Set(Object.keys(S().entities)) });
      const dates = parseHeaderDates(sheet.header, sheet.name, fromISO(today).getFullYear());
      let cells = 0;
      dates.forEach((d, c) => {
        if (d && d >= from && (!to || d <= to)) sheet.cells.forEach((row) => String(row[c] ?? '').trim() && cells++);
      });
      setPreview({ tasks: fresh, cells, merged: cells - all.length, skipped: all.length - fresh.length });
      if (!cells) setMsg('No dated cells found in that range. Row 1 should hold the dates (like 9/28).');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!preview) return;
    const n = preview.tasks.length;
    if (n) S().commit(`Imported ${n} tasks from “${tab}”`, preview.tasks);
    setPreview(null);
    if (source === 'sheet' && keepLinked) {
      setMsg(`Imported ${n} tasks ✓ — linking “${tab}”…`);
      try {
        const r = await apiCall<{ backup: string }>({ action: 'link', sheet: tab, from });
        if (!r.ok) throw new Error(r.error);
        onLinked({ sheet: tab, from });
        await syncNow();
        setMsg(`Imported ${n} tasks ✓ and linked “${tab}”: your changes now flow back into it. A copy of the original was saved as “${r.backup}”.`);
      } catch (e) {
        setMsg(`Imported ${n} tasks ✓, but linking failed: ${e instanceof Error ? e.message : e}`);
      }
    } else setMsg(`Imported ${n} tasks ✓ — undo with ⌘Z if it doesn’t look right.`);
  };

  const counts = useMemo(() => {
    const t = preview?.tasks ?? [];
    return {
      must: t.filter((x) => x.status === 'open' && x.importance === 'must').length,
      should: t.filter((x) => x.status === 'open' && x.importance === 'should').length,
      could: t.filter((x) => x.status === 'open' && x.importance === 'could').length,
      done: t.filter((x) => x.status === 'done').length,
      dropped: t.filter((x) => x.status === 'dropped').length,
      first: t.reduce((m, x) => (x.date && (!m || x.date < m) ? x.date : m), ''),
      last: t.reduce((m, x) => (x.date && x.date > m ? x.date : m), ''),
    };
  }, [preview]);

  return (
    <section className="sync-card">
      <div className="sync-dir">
        <span>Google Sheet</span>
        <ArrowRight size={16} />
        <span>App</span>
        <span className="pill">import</span>
      </div>
      <h3>Bring my existing Google Sheet into the app</h3>
      <p className="muted small">
        Row 1 = dates, each cell = a task. Colours become: <span className="sw red" /> must · <span className="sw yellow" /> should · <span className="sw green" /> done ·{' '}
        <span className="sw grey" /> obsolete · other could. Copies marked “(cont.)” merge into one task. Importing only reads your tab — unless you choose to keep it linked below.
      </p>
      <Segmented<Source>
        className="full"
        value={source}
        onChange={setSource}
        options={[
          { value: 'sheet', label: 'From my connected Google Sheet' },
          { value: 'xlsx', label: 'From an .xlsx file' },
        ]}
      />
      {source === 'sheet' && !ping && <p className="small warn-text">Connect your Google Sheet above, or use an .xlsx file (no setup needed).</p>}
      {source === 'xlsx' && (
        <label className="file-drop">
          <FileSpreadsheet size={16} />
          {file ? <b>{file.name}</b> : <span>Choose a file — in Google Sheets: File → Download → Microsoft Excel (.xlsx)</span>}
          <input
            type="file"
            accept=".xlsx"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setMsg('');
              try {
                setFile({ name: f.name, sheets: await readXlsx(f) });
              } catch (er) {
                setMsg(`Couldn’t read that file: ${er instanceof Error ? er.message : er}`);
              }
            }}
          />
        </label>
      )}
      <div className="row2">
        <Field label="Tab">
          <select value={tab} onChange={(e) => setTab(e.target.value)} disabled={!tabs.length}>
            {tabs.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Unfinished cells on past days">
          <select value={policy} onChange={(e) => setPolicy(e.target.value as 'keep' | 'obsolete')}>
            <option value="keep">Leave as is</option>
            <option value="obsolete">Mark obsolete</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" hint="Empty = everything after">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {source === 'sheet' && (
        <label className={cls('check-row link-opt', keepLinked && 'on')}>
          <input type="checkbox" checked={keepLinked} onChange={(e) => setKeepLinked(e.target.checked)} />
          <span>
            <b>Keep “{tab || 'this tab'}” linked after importing</b>
            <span className="field-hint">
              {' '}
              — the app keeps writing your changes back into this tab, in the same layout and colours, for days from {from ? fmtDay(from) : 'the start date'} on.
              Earlier columns are never touched, and a backup copy of the tab is saved first. Edits made directly in the tab will be overwritten, so edit in the
              app.
            </span>
          </span>
        </label>
      )}
      <div className="inline gap">
        <button className="btn" disabled={busy || !tab} onClick={runPreview}>
          {busy ? 'Reading…' : 'Preview'}
        </button>
        {msg && <span className="small">{msg}</span>}
      </div>
      {preview && preview.cells > 0 && (
        <div className="preview">
          <div>
            <b>{preview.cells}</b> filled cells → <b>{preview.tasks.length}</b> new tasks
            {preview.merged > 0 && <> · {preview.merged} “(cont.)” copies merged</>}
            {preview.skipped > 0 && <> · {preview.skipped} already imported (skipped)</>}
          </div>
          {preview.tasks.length === 0 && source === 'sheet' && keepLinked && (
            <div className="inline gap">
              <span className="small muted">Everything here is already in the app.</span>
              <button className="btn primary" onClick={doImport}>
                Link “{tab}” without importing
              </button>
            </div>
          )}
          {preview.tasks.length > 0 && (
            <>
              <div className="preview-chips">
                {counts.must > 0 && <span className="pv must">{counts.must} must</span>}
                {counts.should > 0 && <span className="pv should">{counts.should} should</span>}
                {counts.could > 0 && <span className="pv could">{counts.could} could</span>}
                {counts.done > 0 && <span className="pv done">{counts.done} done</span>}
                {counts.dropped > 0 && <span className="pv dropped">{counts.dropped} obsolete</span>}
                <span className="muted small">
                  {fmtDay(counts.first)} → {fmtDay(counts.last)}
                </span>
              </div>
              <ul className="preview-list">
                {preview.tasks.slice(0, 8).map((t) => (
                  <li key={t.id}>
                    <span className={cls('pv-dot', t.status === 'open' ? t.importance : t.status)} />
                    <span className="muted">{fmtDay(t.date!)}</span> {t.time && `${t.time} `}
                    {t.title}
                  </li>
                ))}
                {preview.tasks.length > 8 && <li className="muted">…and {preview.tasks.length - 8} more</li>}
              </ul>
              <div className="inline gap">
                <button className="btn primary" onClick={doImport}>
                  Import {preview.tasks.length} tasks{source === 'sheet' && keepLinked ? ' & link' : ''}
                </button>
                <button className="btn" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
