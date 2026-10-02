import { useEffect, useState } from 'react';
import { Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCopy, ExternalLink, X } from 'lucide-react';
import codeGs from '../../apps-script/Code.gs?raw';
import { S, useStore } from '../store';
import { apiCall } from '../lib/sync';
import { cls } from '../lib/id';
import { Field } from './ui';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={cls('btn', done ? 'copied' : 'primary')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // fallback for browsers that block the async clipboard
          const ta = document.createElement('textarea');
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? <Check size={14} /> : <ClipboardCopy size={14} />} {done ? 'Copied!' : label}
    </button>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => <span className="ui-path">{children}</span>;

/** In-app walkthrough for connecting a Google Sheet — the README steps, with the script one click away. */
export function SetupGuide({ onClose, onConnected }: { onClose: () => void; onConnected: (name: string, sheets: string[]) => void }) {
  const settings = useStore((s) => s.settings);
  const [step, setStep] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const lines = codeGs.split('\n').length;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await apiCall<{ spreadsheet: string; sheets: string[] }>({ action: 'ping' });
      if (!r.ok) throw new Error(r.error);
      setTest({ ok: true, msg: `Connected to “${r.spreadsheet}”. Your changes will now sync automatically.` });
      onConnected(r.spreadsheet, r.sheets);
    } catch (e) {
      setTest({ ok: false, msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: 'Open the script editor in your spreadsheet',
      body: (
        <>
          <p>
            Open the Google Sheet you want to use — a new one or an existing planner. The app only adds its own tabs and never edits yours.
          </p>
          <ol>
            <li>
              In the menu bar choose <Kbd>Extensions → Apps Script</Kbd>.
            </li>
            <li>A new tab opens with a file called <code>Code.gs</code> containing a few lines of code.</li>
          </ol>
          <a className="btn" href="https://sheets.google.com" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Open Google Sheets
          </a>
        </>
      ),
    },
    {
      title: 'Paste the Planner script',
      body: (
        <>
          <ol>
            <li>
              Click into <code>Code.gs</code>, select everything (<Kbd>⌘A</Kbd>) and delete it.
            </li>
            <li>Copy the script below and paste it in (<Kbd>⌘V</Kbd>).</li>
            <li>
              Save with <Kbd>⌘S</Kbd> (or the 💾 icon).
            </li>
          </ol>
          <div className="copy-row">
            <CopyButton text={codeGs} label="Copy script" />
            <span className="muted small">{lines} lines · Code.gs</span>
            <span className="spacer" />
            <button className="link-btn" onClick={() => setShowCode((x) => !x)}>
              {showCode ? 'Hide' : 'Preview'} script
            </button>
          </div>
          {showCode && <pre className="code-preview">{codeGs}</pre>}
        </>
      ),
    },
    {
      title: 'Run “setup” once to get your sync token',
      body: (
        <>
          <ol>
            <li>
              In the toolbar above the code, pick <b>setup</b> from the function dropdown (next to <Kbd>▷ Run</Kbd> and <Kbd>Debug</Kbd>).
            </li>
            <li>
              Click <Kbd>▷ Run</Kbd>. Google asks for permission the first time:
              <div className="callout">
                <Kbd>Review permissions</Kbd> → choose your account → if you see “Google hasn’t verified this app”, click <Kbd>Advanced</Kbd> →{' '}
                <Kbd>Go to … (unsafe)</Kbd> → <Kbd>Allow</Kbd>. That warning appears for any personal script; this one only touches the spreadsheet it lives
                in.
              </div>
            </li>
            <li>
              The <b>Execution log</b> at the bottom prints <i>“Your sync token …”</i>. Copy that long string — you’ll paste it in the last step.
            </li>
          </ol>
        </>
      ),
    },
    {
      title: 'Deploy it as a web app',
      body: (
        <>
          <ol>
            <li>
              Top-right: <Kbd>Deploy → New deployment</Kbd>.
            </li>
            <li>
              Click the ⚙️ next to “Select type” and choose <Kbd>Web app</Kbd>.
            </li>
            <li>
              Set <b>Execute as:</b> <Kbd>Me</Kbd> and <b>Who has access:</b> <Kbd>Anyone</Kbd>, then <Kbd>Deploy</Kbd>.
            </li>
            <li>
              Copy the <b>Web app URL</b> — it ends in <code>/exec</code>.
            </li>
          </ol>
          <div className="callout">
            “Anyone” lets the app reach the script without a Google login inside the app. Your data is still protected by the token — treat it like a
            password. If it ever leaks, run <code>rotateToken</code> the same way you ran <code>setup</code>.
          </div>
          <p className="small muted">Updating the script later? Use Deploy → Manage deployments → ✏️ → Version: New version, so the URL stays the same.</p>
        </>
      ),
    },
    {
      title: 'Connect',
      body: (
        <>
          <Field label="Web app URL" hint="Ends in /exec">
            <input value={settings.syncUrl} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => S().setSettings({ syncUrl: e.target.value.trim() })} />
          </Field>
          <Field label="Sync token" hint="From the Execution log in step 3">
            <input type="password" value={settings.syncToken} onChange={(e) => S().setSettings({ syncToken: e.target.value.trim() })} autoComplete="off" />
          </Field>
          <div className="inline gap">
            <button className="btn primary" disabled={testing || !settings.syncUrl || !settings.syncToken} onClick={runTest}>
              {testing ? 'Connecting…' : 'Test connection'}
            </button>
            {test && (
              <span className={cls('small', test.ok ? 'ok-text' : 'err-text')}>
                {test.ok && <CheckCircle2 size={13} />} {test.msg}
              </span>
            )}
          </div>
          {test && !test.ok && (
            <div className="callout">
              <b>Common fixes:</b> the URL must end in <code>/exec</code> (not <code>/dev</code>) · access must be “Anyone” · the token has no spaces · if you
              changed the script, deploy a <i>new version</i>.
            </div>
          )}
        </>
      ),
    },
  ];

  const last = step === steps.length - 1;
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal guide">
        <div className="guide-head">
          <b>Connect your Google Sheet</b>
          <span className="muted small">about 5 minutes</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="guide-steps">
          {steps.map((s, i) => (
            <button key={i} className={cls('gstep', i === step && 'on', i < step && 'done')} onClick={() => setStep(i)}>
              <span className="gnum">{i < step ? <Check size={11} strokeWidth={3} /> : i + 1}</span>
              <span className="glabel">{s.title}</span>
            </button>
          ))}
        </div>
        <div className="guide-body">
          <div className="guide-kicker">Step {step + 1} of {steps.length}</div>
          <h3>{steps[step].title}</h3>
          {steps[step].body}
        </div>
        <div className="guide-foot">
          <button className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
            <ChevronLeft size={14} /> Back
          </button>
          <span className="spacer" />
          {last ? (
            <button className="btn primary" onClick={onClose}>
              {test?.ok ? 'Done' : 'Close'}
            </button>
          ) : (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              Next <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
