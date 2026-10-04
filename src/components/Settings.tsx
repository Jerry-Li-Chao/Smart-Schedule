import { useState } from 'react';
import { Download, Eraser, FolderOpen, History, Upload } from 'lucide-react';
import type { Importance } from '../types';
import { ask, listModels } from '../lib/llm';
import { S, useStore } from '../store';
import { addDays, fmtDay, todayISO } from '../lib/date';
import { desk } from '../lib/bridge';
import { BlurInput, Field } from './ui';
import { buildExport, download, exportFileName, parsePlannerFile, type PlannerFile } from '../lib/transfer';
import { ClearPlanner, ImportPlanner } from './ImportPlanner';
import { SheetSync } from './SheetSync';
import { DEFAULT_ALERT_LEVELS } from './AlertsDock';
import { cls } from '../lib/id';

export function SettingsView() {
  const settings = useStore((s) => s.settings);
  const set = S().setSettings;

  return (
    <div className="settings">
      <SheetSync />

      <LocalAi />

      <section>
        <h2>Timeline range</h2>
        <p className="muted small">
          How far the day columns reach. This only changes what you can scroll to — tasks outside the range are kept, still sync, and still appear in Ahead,
          Projects and History. Widen it again any time and they’re right where you left them.
        </p>
        <div className="row2">
          <Field label="Show into the past">
            <select value={settings.rangeBackDays ?? 365} onChange={(e) => set({ rangeBackDays: Number(e.target.value) })}>
              {RANGE_OPTIONS.map(([d, l]) => (
                <option key={d} value={d}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Show into the future">
            <select value={settings.rangeFwdDays ?? 730} onChange={(e) => set({ rangeFwdDays: Number(e.target.value) })}>
              {RANGE_OPTIONS.map(([d, l]) => (
                <option key={d} value={d}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        <RangeHidden />
      </section>

      <AlertSettings />

      <section>
        <h2>Habits</h2>
        <Field label="New tasks start as" hint="Change any task later by clicking the bars on the right edge of its card.">
          <select value={settings.defaultImportance} onChange={(e) => set({ defaultImportance: e.target.value as Importance })}>
            <option value="must">Must</option>
            <option value="should">Should</option>
            <option value="could">Could</option>
          </select>
        </Field>
        <label className="check-row">
          <input type="checkbox" checked={settings.morningPlanning} onChange={(e) => set({ morningPlanning: e.target.checked })} />
          Open “Plan” the first time I open the app each day if there are unplanned sticky notes
        </label>
        <label className="check-row">
          <input type="checkbox" checked={settings.confirmBatchDelete !== false} onChange={(e) => set({ confirmBatchDelete: e.target.checked })} />
          Ask before deleting several selected tasks at once
        </label>
        <Field label="This device’s name" hint="Shown in history next to changes made here">
          <input value={settings.deviceName} onChange={(e) => set({ deviceName: e.target.value })} />
        </Field>
        {desk && <ShortcutField />}
      </section>

      <section>
        <h2>Your planner: export, import, start fresh</h2>
        <div className="terms">
          <div>
            <b>Planner</b> — everything in this app: tasks, sticky notes, repeats, bills, projects, all-day events, history and preferences. It lives on this
            computer.
          </div>
          <div>
            <b>Google Sheet</b> — an optional spreadsheet in your Google Drive where the planner keeps a synced copy (for backup and your phone). One planner
            syncs with at most one Google Sheet; set it up in the Google Sheet section above.
          </div>
        </div>
        <Transfer />
        <p className="muted small">{desk ? 'The desktop app also saves a dated copy of the planner to disk once a day (the last 60 days are kept).' : ''}</p>
        <div className="inline gap" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => S().setUI({ view: 'history' })}>
            <History size={14} /> History &amp; trash
          </button>
          {desk && (
            <button className="btn" onClick={() => desk!.openBackups()}>
              <FolderOpen size={14} /> Open backups folder
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ShortcutField() {
  const settings = useStore((s) => s.settings);
  const [v, setV] = useState(settings.captureShortcut);
  const [msg, setMsg] = useState('');
  return (
    <Field
      label="Floating sticky hotkey"
      hint={
        msg || (
          <>
            Press it in <b>any</b> app to pop up a small sticky note on top of everything. Jot the thought, hit Enter, and it lands on your sticky here —
            without switching to Planner. Esc hides it; the pin keeps it on screen. Format: <code>CommandOrControl+Shift+Space</code>, <code>Alt+Space</code>, …
          </>
        )
      }
    >
      <div className="inline gap">
        <button className="btn" onClick={() => desk!.openCapture()}>Try it</button>
        <input value={v} onChange={(e) => setV(e.target.value)} />
        <button
          className="btn"
          onClick={async () => {
            const ok = await desk!.setShortcut(v);
            setMsg(ok ? 'Saved.' : 'That shortcut is taken by another app — try another.');
            if (ok) S().setSettings({ captureShortcut: v });
          }}
        >
          Save
        </button>
      </div>
    </Field>
  );
}

function Transfer() {
  const connected = useStore((s) => !!(s.settings.syncUrl && s.settings.syncToken));
  const sheetName = useStore((s) => s.settings.sheetName);
  const [withSheet, setWithSheet] = useState(true);
  const [file, setFile] = useState<PlannerFile | null>(null);
  const [clearing, setClearing] = useState(false);
  const exportNow = () => {
    download(exportFileName(), JSON.stringify(buildExport({ includeSheet: connected && withSheet }), null, 1));
    S().toast('Planner exported');
  };
  const pick = async (f: File) => {
    try {
      setFile(parsePlannerFile(await f.text()));
    } catch (e) {
      S().toast(`Couldn’t read that file: ${e instanceof Error ? e.message : e}`);
    }
  };
  return (
    <>
      <div className="inline gap">
        <button className="btn primary" onClick={exportNow}>
          <Download size={14} /> Export planner
        </button>
        <label className="btn">
          <Upload size={14} /> Import planner…
          <input type="file" accept="application/json,.json" hidden onChange={(e) => (e.target.files?.[0] && pick(e.target.files[0]), (e.target.value = ''))} />
        </label>
        <button className="btn danger" onClick={() => setClearing(true)}>
          <Eraser size={14} /> Clear planner…
        </button>
      </div>
      {connected && (
        <label className="check-row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={withSheet} onChange={(e) => setWithSheet(e.target.checked)} />
          Also save which Google Sheet it syncs with{sheetName ? ` (“${sheetName}”)` : ''}, so importing the file reconnects to it. The file then works like a
          password — keep it private.
        </label>
      )}
      <p className="muted small">
        <b>Export</b> saves the whole planner as one file. <b>Import</b> opens a planner file and asks whether to replace this planner or add to it.{' '}
        <b>Clear</b> empties this planner (a copy is saved first) — export, clear, then import to get everything back exactly as it was.
      </p>
      {file && <ImportPlanner file={file} onClose={() => setFile(null)} />}
      {clearing && <ClearPlanner onClose={() => setClearing(false)} />}
    </>
  );
}

function LocalAi() {
  const settings = useStore((s) => s.settings);
  const set = S().setSettings;
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    setStatus('');
    try {
      const list = await listModels();
      setModels(list);
      if (!list.length) throw new Error('Connected, but the server has no models.');
      const model = list.includes(settings.llmModel) ? settings.llmModel : list[0];
      set({ llmModel: model });
      const t0 = Date.now();
      const a = await ask('Reply with just the word: ready');
      setStatus(`✓ ${model} answered “${a.slice(0, 40)}” in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    } catch (e) {
      setStatus(`✗ ${e instanceof Error ? e.message : String(e)} — is Ollama / LM Studio running?`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2>Local AI</h2>
      <p className="muted small">
        Put a <b>?</b> in a task (“how long does a passport renewal take?”) and your own model answers in a sentence or two, shown when you open the task.
        Runs on your computer — nothing is sent to the cloud. Works with Ollama, LM Studio, or any OpenAI-compatible server. Desktop only (your phone can’t reach your Mac’s model). The model does <b>not</b> search the internet, so treat its answers as suggestions: they can be outdated or simply wrong, especially for rules, fees, deadlines and prices.
      </p>
      <label className="check-row">
        <input type="checkbox" checked={settings.llmEnabled} onChange={(e) => set({ llmEnabled: e.target.checked })} />
        Answer “?” tasks automatically
      </label>
      <div className="row2">
        <Field label="Server URL" hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1">
          <input value={settings.llmUrl} onChange={(e) => set({ llmUrl: e.target.value.trim() })} />
        </Field>
        <Field label="Model">
          {models.length ? (
            <select value={settings.llmModel} onChange={(e) => set({ llmModel: e.target.value })}>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input value={settings.llmModel} placeholder="Press Connect to list models" onChange={(e) => set({ llmModel: e.target.value.trim() })} />
          )}
        </Field>
      </div>
      <Field label="About me (sent with every question)" hint="Where you live and anything that changes answers — e.g. “I live in Toronto, Canada. I'm a student.” Stays on your computer.">
        <BlurInput value={settings.llmAbout ?? ''} placeholder="I live in <city, country>…" onCommit={(llmAbout) => set({ llmAbout })} />
      </Field>
      <div className="inline gap">
        <button className="btn" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect & test'}</button>
        {status && <span className={status.startsWith('✓') ? 'ok-text small' : 'err-text small'}>{status}</span>}
      </div>
    </section>
  );
}

const RANGE_OPTIONS: [number, string][] = [
  [7, '1 week'], [30, '1 month'], [90, '3 months'], [182, '6 months'], [365, '1 year'], [730, '2 years'], [1095, '3 years'], [1825, '5 years'], [3650, '10 years'],
];

/** Reassurance: how many tasks currently sit outside the window (they are not deleted). */
function RangeHidden() {
  const entities = useStore((s) => s.entities);
  const back = useStore((s) => s.settings.rangeBackDays ?? 365);
  const fwd = useStore((s) => s.settings.rangeFwdDays ?? 730);
  const today = todayISO();
  const from = addDays(today, -back);
  const to = addDays(today, fwd);
  let before = 0;
  let after = 0;
  for (const e of Object.values(entities)) {
    if (e.type !== 'task' || e.deleted || !e.date || e.recurrence) continue;
    if (e.date < from) before++;
    else if (e.date > to) after++;
  }
  return (
    <p className="small muted">
      Showing {fmtDay(from)} → {fmtDay(to)}.
      {before + after > 0 ? ` ${before + after} task${before + after > 1 ? 's are' : ' is'} outside this range (${before} earlier, ${after} later) — kept safely, just not shown on the timeline.` : ' Every dated task is inside this range.'}
    </p>
  );
}

/** Heads-up levels for timed tasks (bottom-left "Coming up" panel). */
function AlertSettings() {
  const levels = useStore((s) => s.settings.alertLevels ?? DEFAULT_ALERT_LEVELS);
  const set = (next: { minutes: number; on: boolean }[]) => S().setSettings({ alertLevels: next });
  const names = ['First heads-up', 'Second', 'Third', 'Last call'];
  return (
    <section>
      <h2>Heads-up before timed tasks</h2>
      <p className="muted small">
        Anything with a time shows up in the <b>Coming up</b> panel (bottom-left) at the first level, and gets more insistent at each later one. You can
        minimise the panel, but it only goes away once the time has passed or you mark the task done.
      </p>
      <div className="alert-levels">
        {levels.map((l, i) => (
          <label key={i} className={cls('alert-level', `i${Math.round((i / Math.max(1, levels.length - 1)) * 3)}`, !l.on && 'off')}>
            <input type="checkbox" checked={l.on} onChange={(e) => set(levels.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
            <span className="al-name">{names[i] ?? `Level ${i + 1}`}</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={l.minutes}
              disabled={!l.on}
              onChange={(e) => set(levels.map((x, j) => (j === i ? { ...x, minutes: Math.max(1, Math.min(1440, Number(e.target.value) || 1)) } : x)))}
            />
            <span className="small muted">min before</span>
          </label>
        ))}
      </div>
      <div className="inline gap">
        <button className="btn tiny" onClick={() => set(DEFAULT_ALERT_LEVELS)}>Reset to 2 h · 1 h · 30 min · 1 min</button>
        <button className="btn tiny" onClick={() => set(levels.map((l) => ({ ...l, on: false })))}>Turn all off</button>
      </div>
    </section>
  );
}
