import type { Entity } from '../types';
import { S, useStore } from '../store';
import { desk, inAppsScript } from './bridge';

/** One call to the Apps Script backend, over whichever transport this platform has. */
export async function apiCall<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T & { ok: boolean; error?: string }> {
  const { syncUrl, syncToken } = S().settings;
  const body = JSON.stringify({ ...payload, token: syncToken.trim() });
  let text: string;
  if (inAppsScript()) {
    // Phone UI served by Apps Script itself: talk to the server directly.
    text = await new Promise<string>((resolve, reject) =>
      window.google!.script!.run.withSuccessHandler(resolve).withFailureHandler(reject).api(body),
    );
  } else {
    const url = syncUrl.trim();
    if (!/^https:\/\//.test(url)) throw new Error('Set the Apps Script web-app URL in Settings first.');
    try {
      if (desk) {
        const r = await desk.post(url, body);
        text = r.text;
      } else {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
        text = await r.text();
      }
    } catch {
      throw new Error('Couldn’t reach that URL. Check you’re online and that it’s the Web app URL ending in /exec.');
    }
  }
  if (text.trimStart().startsWith('<'))
    throw new Error('The URL returned a web page instead of data. Make sure it ends in /exec and the deployment’s access is “Anyone”.');
  return JSON.parse(text);
}

export const syncConfigured = () => {
  const { syncUrl, syncToken } = S().settings;
  return !!syncToken.trim() && (inAppsScript() || !!syncUrl.trim());
};

let inflight: Promise<void> | null = null;
let again = false;

/**
 * Push local edits, pull everyone else's. The server merges per item (newest edit of
 * that item wins, the loser is kept in the _app_history tab), so an edit on the phone
 * can never overwrite a different task edited on the laptop.
 */
export function syncNow(): Promise<void> {
  if (!syncConfigured()) return Promise.resolve();
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    const st = S();
    st.setUI({ syncing: true });
    try {
      const sent = { ...st.dirty };
      const changes = Object.keys(sent).map((id) => st.entities[id]).filter(Boolean);
      const res = await apiCall<{ cursor: number; changes: Entity[] }>({
        action: 'sync',
        since: st.settings.cursor,
        device: st.settings.deviceName,
        changes,
      });
      if (!res.ok) throw new Error(res.error || 'Sync failed');
      // anything we sent that hasn't been edited again since is now safely in the sheet
      const dirty = { ...S().dirty };
      for (const id in sent) if (dirty[id] === sent[id]) delete dirty[id];
      useStore.setState({ dirty });
      S().applyRemote(res.changes ?? []);
      S().setSettings({ cursor: res.cursor, lastSyncAt: Date.now(), lastSyncError: undefined });
    } catch (err) {
      S().setSettings({ lastSyncError: err instanceof Error ? err.message : String(err) });
    } finally {
      S().setUI({ syncing: false });
      inflight = null;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  })();
  return inflight;
}

