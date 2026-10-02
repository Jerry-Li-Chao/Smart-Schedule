import { create } from 'zustand';
import type { DayItem, Entity, HistoryEntry, ISODate, Settings } from './types';
import { uid } from './lib/id';
import { desk } from './lib/bridge';

const STORAGE_KEY = 'planner.v1';
const HISTORY_CAP = 4000;

export type View = 'timeline' | 'sticky' | 'projects' | 'upcoming' | 'wins' | 'history' | 'settings';

interface Change {
  id: string;
  before: Entity | null;
  after: Entity;
}
interface Batch {
  label: string;
  changes: Change[];
}
export interface Toast {
  id: number;
  msg: string;
  actions?: { label: string; run: () => void }[];
  ms?: number;
}
interface UI {
  view: View;
  selectedId?: string;
  occDate?: ISODate;
  projectId?: string;
  planOpen: boolean;
  toast?: Toast;
  syncing: boolean;
  jump?: { date: ISODate; n: number };
  menu?: { x: number; y: number; item: DayItem };
  deleteAsk?: { id: string; date?: ISODate };
  /** multi-selection: task ids, or `${seriesId}@${date}` for one day of a repeating task */
  multi?: string[];
  batchAsk?: boolean;
  /** first/last day currently on screen in the timeline */
  visible?: { from: ISODate; to: ISODate };
  aiQueue?: { running: string | null; waiting: string[] };
  /** local LLM reachability, checked periodically while AI is enabled */
  llm?: { state: 'checking' | 'ok' | 'down'; error?: string };
}

interface Store {
  loaded: boolean;
  entities: Record<string, Entity>;
  /** id → updatedAt of local edits not yet confirmed by the sheet */
  dirty: Record<string, number>;
  history: HistoryEntry[]; // newest first
  undoStack: Batch[];
  redoStack: Batch[];
  settings: Settings;
  ui: UI;

  load(): Promise<void>;
  commit(label: string, list: Entity[], opts?: { undoable?: boolean }): void;
  applyRemote(list: Entity[]): number;
  undo(): void;
  redo(): void;
  setUI(patch: Partial<UI>): void;
  setSettings(patch: Partial<Settings>): void;
  toast(msg: string, actions?: Toast['actions'], ms?: number): void;
  /** Drop local history entries older than `before` (all when omitted). */
  clearHistory(before?: number): number;
}

function defaultSettings(): Settings {
  const ua = navigator.userAgent;
  const deviceName = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : desk ? 'Mac app' : 'Browser';
  return {
    deviceId: uid('d'),
    deviceName,
    syncUrl: '',
    syncToken: '',
    cursor: 0,
    morningPlanning: true,
    confirmBatchDelete: true,
    rangeBackDays: 365,
    rangeFwdDays: 730,
    captureShortcut: 'CommandOrControl+Shift+Space',
    defaultImportance: 'must',
    llmEnabled: false,
    llmUrl: 'http://localhost:11434/v1',
    llmModel: '',
  };
}

let toastSeq = 0;

export const useStore = create<Store>((set, get) => {
  function write(label: string, list: Entity[], source: 'local' | 'remote', undoable: boolean) {
    const now = Date.now();
    set((st) => {
      const entities = { ...st.entities };
      const dirty = { ...st.dirty };
      const entries: HistoryEntry[] = [];
      const changes: Change[] = [];
      for (const e of list) {
        const before = st.entities[e.id] ?? null;
        const after = (
          source === 'local'
            ? { ...e, updatedAt: Math.max(now, (before?.updatedAt ?? 0) + 1), device: st.settings.deviceName }
            : e
        ) as Entity;
        entities[e.id] = after;
        if (source === 'local') dirty[e.id] = after.updatedAt;
        else if (dirty[e.id] !== undefined && dirty[e.id] <= after.updatedAt) delete dirty[e.id];
        entries.push({ hid: uid('h'), ts: now, id: e.id, label, before, after, source, device: after.device });
        changes.push({ id: e.id, before, after });
      }
      return {
        entities,
        dirty,
        history: [...entries.reverse(), ...st.history].slice(0, HISTORY_CAP),
        ...(undoable ? { undoStack: [...st.undoStack, { label, changes }].slice(-200), redoStack: [] } : {}),
      };
    });
  }

  return {
    loaded: false,
    entities: {},
    dirty: {},
    history: [],
    undoStack: [],
    redoStack: [],
    settings: defaultSettings(),
    ui: { view: 'timeline', planOpen: false, syncing: false },

    async load() {
      try {
        const raw = desk ? await desk.load() : localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          set({
            entities: p.entities ?? {},
            dirty: p.dirty ?? {},
            history: p.history ?? [],
            settings: { ...defaultSettings(), ...p.settings },
          });
        }
      } catch (err) {
        // never let a later autosave silently replace data we couldn't read
        console.error('Failed to load data', err);
        if (!desk) {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) localStorage.setItem(`${STORAGE_KEY}.unreadable.${Date.now()}`, raw);
        }
        alert('Planner could not read its saved data. A copy was kept (desktop: see the backups folder). Your Google Sheet still has everything that synced.');
      }
      set({ loaded: true });
      startAutosave();
    },

    commit(label, list, opts = {}) {
      if (list.length) write(label, list, 'local', opts.undoable !== false);
    },

    applyRemote(list) {
      const cur = get().entities;
      const newer = list.filter((e) => !cur[e.id] || e.updatedAt > cur[e.id].updatedAt);
      if (newer.length) write('Synced from sheet', newer, 'remote', false);
      // our echoed or older copies: nothing left to push for them
      set((st) => {
        const dirty = { ...st.dirty };
        for (const e of list) if (dirty[e.id] !== undefined && dirty[e.id] <= e.updatedAt) delete dirty[e.id];
        return { dirty };
      });
      return newer.length;
    },

    undo() {
      const b = get().undoStack.at(-1);
      if (!b) return;
      set((st) => ({ undoStack: st.undoStack.slice(0, -1), redoStack: [...st.redoStack, b] }));
      write(`Undo: ${b.label}`, b.changes.map((c) => c.before ?? ({ ...c.after, deleted: true } as Entity)), 'local', false);
      get().toast(`Undid “${b.label}”`);
    },

    redo() {
      const b = get().redoStack.at(-1);
      if (!b) return;
      set((st) => ({ redoStack: st.redoStack.slice(0, -1), undoStack: [...st.undoStack, b] }));
      write(`Redo: ${b.label}`, b.changes.map((c) => c.after), 'local', false);
    },

    setUI(patch) {
      set((st) => ({ ui: { ...st.ui, ...patch } }));
    },
    setSettings(patch) {
      set((st) => ({ settings: { ...st.settings, ...patch } }));
    },
    toast(msg, actions, ms) {
      get().setUI({ toast: { id: ++toastSeq, msg, actions, ms } });
    },
    clearHistory(before) {
      const keep = before === undefined ? [] : get().history.filter((h) => h.ts >= before);
      const removed = get().history.length - keep.length;
      set({ history: keep, undoStack: [], redoStack: [] });
      return removed;
    },
  };
});

// ---------- persistence ----------
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function snapshot() {
  const { entities, dirty, history, settings } = useStore.getState();
  return { v: 1, savedAt: Date.now(), entities, dirty, history, settings };
}

export function saveNow() {
  clearTimeout(saveTimer);
  let snap = snapshot();
  let json = JSON.stringify(snap);
  if (desk) return desk.save(json);
  for (let tries = 0; tries < 4; tries++) {
    try {
      localStorage.setItem(STORAGE_KEY, json);
      return;
    } catch {
      // quota: keep the data, shed the oldest local history (the sheet keeps its own)
      snap = { ...snap, history: snap.history.slice(0, Math.floor(snap.history.length / 2)) };
      json = JSON.stringify(snap);
    }
  }
}

function startAutosave() {
  if (started) return;
  started = true;
  useStore.subscribe((st, prev) => {
    if (st.entities === prev.entities && st.settings === prev.settings && st.dirty === prev.dirty && st.history === prev.history) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  });
  window.addEventListener('beforeunload', () => void saveNow());
}

export const S = () => useStore.getState();
