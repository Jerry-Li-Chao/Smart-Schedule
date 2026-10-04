import { useState } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { useStore } from '../store';
import { BUNDLED_SCRIPT_VERSION, missingChanges } from '../lib/scriptVersion';
import { ScriptUpdateGuide } from './SetupGuide';

let snoozed = false; // "Later" hides it until the app is restarted

/** Shown when the connected Google Sheet runs an older script than this app ships with. */
export function ScriptBanner() {
  const connected = useStore((s) => !!(s.settings.syncUrl && s.settings.syncToken));
  const deployed = useStore((s) => s.settings.scriptVersion);
  const [hidden, setHidden] = useState(snoozed);
  const [guide, setGuide] = useState(false);
  const missing = missingChanges(deployed);
  // the guide stays mounted while the banner disappears, so its "up to date" result stays visible
  return (
    <>
      {connected && missing.length > 0 && !hidden && (
        <div className="script-banner">
          <ArrowUpCircle size={16} />
          <span>
            <b>Your Google Sheet’s script is out of date</b> (version {deployed || 1}, latest {BUNDLED_SCRIPT_VERSION}). Updating adds: {missing[0].charAt(0).toLowerCase() + missing[0].slice(1)}
            {missing.length > 1 ? ` and ${missing.length - 1} more` : ''}.
          </span>
          <button className="btn tiny primary" onClick={() => setGuide(true)}>
            Update — 2 min
          </button>
          <button
            className="icon-btn"
            title="Later (asks again next time you open the app)"
            onClick={() => {
              snoozed = true;
              setHidden(true);
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {guide && <ScriptUpdateGuide onClose={() => setGuide(false)} />}
    </>
  );
}

/** One line for Settings → Google Sheet. */
export function ScriptStatus() {
  const deployed = useStore((s) => s.settings.scriptVersion);
  const [guide, setGuide] = useState(false);
  if (deployed === undefined) return null;
  const old = missingChanges(deployed).length > 0;
  return (
    <div className={old ? 'script-status old' : 'script-status'}>
      {old ? (
        <>
          Script version {deployed || 1} — <b>update available</b> (version {BUNDLED_SCRIPT_VERSION}){' '}
          <button className="btn tiny primary" onClick={() => setGuide(true)}>
            Update…
          </button>
        </>
      ) : (
        <>Script version {deployed} — up to date</>
      )}
      {guide && <ScriptUpdateGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
