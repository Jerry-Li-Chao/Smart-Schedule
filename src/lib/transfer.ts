import type { Entity, HistoryEntry, Settings } from '../types';
import { S, saveNow, useStore } from '../store';
import { desk } from './bridge';
import { todayISO } from './date';
import { syncConfigured, syncNow } from './sync';

/**
 * Terms used in the app:
 * - planner: everything in this app — tasks, sticky notes, repeats, bills, projects, events, preferences
 * - Google Sheet: an optional spreadsheet the planner keeps a synced copy in (one sheet per planner)
 *
 * Whole-planner export / import, for keeping a copy, starting fresh, or switching between planners.
 */
export const FORMAT = 'smart-schedule-planner';

/** Preferences that travel with a planner. Device identity and sync bookkeeping never do. */
const PREF_KEYS: (keyof Settings)[] = [
  'morningPlanning', 'confirmBatchDelete', 'autoSync', 'rangeBackDays', 'rangeFwdDays', 'timelineZoom', 'daySort',
  'alertLevels', 'alertsCollapsed', 'tracksCollapsed', 'stickyCollapsed', 'defaultImportance', 'currency',
  'llmEnabled', 'llmUrl', 'llmModel', 'llmAbout',
];

export interface PlannerFile {
  format: typeof FORMAT;
  v: 2;
  exportedAt: string;
  entities: Record<string, Entity>;
  /** the History tab's change log, so a restore brings that back too */
  history?: HistoryEntry[];
  prefs: Partial<Settings>;
  /** the Google Sheet this planner syncs with (URL + token: keep the file private) */
  sheet?: { url: string; token: string; name?: string };
}

export function buildExport(opts: { includeSheet: boolean }): PlannerFile {
  const { entities, settings, history } = S();
  const prefs: Partial<Settings> = {};
  for (const k of PREF_KEYS) if (settings[k] !== undefined) (prefs as Record<string, unknown>)[k] = settings[k];
  return {
    format: FORMAT,
    v: 2,
    exportedAt: new Date().toISOString(),
    entities,
    history,
    prefs,
    ...(opts.includeSheet && settings.syncUrl && settings.syncToken ? { sheet: { url: settings.syncUrl, token: settings.syncToken, name: settings.sheetName } } : {}),
  };
}

const slug = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

export function exportFileName(prefix = 'planner') {
  const name = slug(S().settings.sheetName);
  // "Planner A" → planner-a-2026-10-03.json, not planner-planner-a-…
  const tail = name ? (name.startsWith('planner') && prefix === 'planner' ? name.slice(7).replace(/^-/, '') : name) : '';
  return `${prefix}${tail ? `-${tail}` : ''}-${todayISO()}.json`;
}

export function download(name: string, json: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Reads a planner file — also the older `{ exportedAt, entities }` backups. */
export function parsePlannerFile(text: string): PlannerFile {
  const d = JSON.parse(text);
  const entities = d?.entities;
  if (!entities || typeof entities !== 'object') throw new Error('This isn’t a planner export (no tasks found in it).');
  for (const e of Object.values(entities) as Entity[])
    if (!e || typeof e !== 'object' || !e.id || (e.type !== 'task' && e.type !== 'project')) throw new Error('The file has items this app doesn’t recognise.');
  const sheet = d.sheet && typeof d.sheet.url === 'string' && /^https:\/\//.test(d.sheet.url) && typeof d.sheet.token === 'string' ? d.sheet : undefined;
  const history = Array.isArray(d.history) ? d.history : undefined;
  return { format: FORMAT, v: 2, exportedAt: d.exportedAt ?? '', entities, history, prefs: d.prefs ?? {}, sheet };
}

export function summarize(entities: Record<string, Entity>) {
  const live = Object.values(entities).filter((e) => !e.deleted);
  const tasks = live.filter((e) => e.type === 'task');
  return {
    tasks: tasks.filter((t) => t.type === 'task' && t.date && !t.recurrence && !t.allDay).length,
    sticky: tasks.filter((t) => t.type === 'task' && !t.date && !t.projectId).length,
    repeats: tasks.filter((t) => t.type === 'task' && t.recurrence).length,
    bills: tasks.filter((t) => t.type === 'task' && t.recurrence && t.cost?.amount).length,
    events: tasks.filter((t) => t.type === 'task' && t.allDay).length,
    projects: live.filter((e) => e.type === 'project').length,
  };
}

/** Copy of the current planner (with its sheet connection) before it gets replaced. */
async function safetyCopy(why: 'before-import' | 'before-clear'): Promise<string> {
  const json = JSON.stringify(buildExport({ includeSheet: true }), null, 1);
  const name = exportFileName(why).replace('.json', `-${Date.now()}.json`);
  if (desk) return desk.writeBackup(name, json);
  download(name, json);
  return `Downloads/${name}`;
}

/**
 * - file:    use the imported planner's own Google Sheet
 * - offline: don't sync (the previous sheet keeps the previous planner, untouched)
 * - upload:  make the currently connected sheet match the imported planner
 */
export type SheetChoice = 'file' | 'offline' | 'upload';

export async function switchPlanner(file: PlannerFile, sheet: SheetChoice): Promise<string> {
  const saved = await safetyCopy('before-import');
  const now = Date.now();
  const cur = S();
  let entities: Record<string, Entity> = { ...file.entities };

  if (sheet === 'upload') {
    // everything the sheet has from the old planner is removed there too
    for (const [id, e] of Object.entries(cur.entities)) if (!entities[id]) entities[id] = { ...e, deleted: true, updatedAt: now };
  }
  // every item goes up on the next sync; identical copies are a no-op for the sheet
  const dirty: Record<string, number> = {};
  for (const [id, e] of Object.entries(entities)) dirty[id] = e.updatedAt;

  const settings: Settings = { ...cur.settings, ...file.prefs, lastSyncAt: undefined, lastSyncError: undefined };
  if (sheet === 'file' && file.sheet) Object.assign(settings, { syncUrl: file.sheet.url, syncToken: file.sheet.token, sheetName: file.sheet.name, cursor: 0 });
  else if (sheet === 'offline') Object.assign(settings, { syncUrl: '', syncToken: '', sheetName: undefined, cursor: 0 });

  useStore.setState({ entities, dirty, history: sheet === 'upload' ? [] : file.history ?? [], undoStack: [], redoStack: [], settings });
  S().setUI({ selectedId: undefined, multi: undefined, menu: undefined });
  await saveNow();
  if (sheet === 'file' && syncConfigured()) void restoreOverDeletions(file);
  else if (sheet === 'upload' && syncConfigured()) void syncNow();
  return saved;
}

/**
 * Switching to a planner means "make it like the file": if the Google Sheet had deleted things the
 * file still has (e.g. the sheet was cleared before restoring a backup), bring them back.
 */
async function restoreOverDeletions(file: PlannerFile) {
  await syncNow();
  const now = Date.now();
  const back = Object.values(file.entities)
    .filter((e) => !e.deleted && S().entities[e.id]?.deleted)
    .map((e) => ({ ...e, updatedAt: now }));
  if (!back.length) return;
  S().commit(`Restored ${back.length} item${back.length === 1 ? '' : 's'} the Google Sheet had deleted`, back, { undoable: false });
  void syncNow();
}

/** Add what's new or newer; nothing is removed. Goes to the connected sheet like any edit. */
export function mergePlanner(file: PlannerFile): number {
  const cur = S().entities;
  const newer = Object.values(file.entities).filter((e) => !cur[e.id] || e.updatedAt > cur[e.id].updatedAt);
  S().commit(`Imported ${newer.length} item${newer.length === 1 ? '' : 's'}`, newer);
  return newer.length;
}

/**
 * Empty the planner. A copy is saved first.
 * - this-device: the Google Sheet keeps everything; this app disconnects from it
 * - sheet-too:   stays connected and empties the Google Sheet as well
 */
export async function clearPlanner(scope: 'this-device' | 'sheet-too'): Promise<string> {
  const saved = await safetyCopy('before-clear');
  const now = Date.now();
  const cur = S();
  let entities: Record<string, Entity> = {};
  const dirty: Record<string, number> = {};
  if (scope === 'sheet-too') {
    entities = Object.fromEntries(Object.entries(cur.entities).map(([id, e]) => [id, { ...e, deleted: true, purged: true, updatedAt: now }]));
    for (const id in entities) dirty[id] = now;
  }
  const settings: Settings =
    scope === 'this-device' ? { ...cur.settings, syncUrl: '', syncToken: '', sheetName: undefined, cursor: 0, lastSyncAt: undefined, lastSyncError: undefined } : cur.settings;
  useStore.setState({ entities, dirty, history: [], undoStack: [], redoStack: [], settings });
  S().setUI({ selectedId: undefined, multi: undefined, menu: undefined });
  await saveNow();
  if (scope === 'sheet-too' && syncConfigured()) void syncNow();
  return saved;
}
