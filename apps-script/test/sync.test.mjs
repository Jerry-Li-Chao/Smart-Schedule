// Runs the real Code.gs against an in-memory fake of SpreadsheetApp & friends,
// simulating a laptop and a phone editing at the same time.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

function fakeGoogle() {
  const sheets = new Map();
  const props = new Map();
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop });
  function makeSheet(name) {
    const s = {
      name, data: [], bg: [], maxRows: 1000, maxCols: 26, hidden: false,
      getLastColumn: () => Math.max(0, ...s.data.map((r) => r.length)),
      copyTo: () => { const c = makeSheet(name + ' copy'); c.data = s.data.map((r) => [...r]); return { setName: (n) => { sheets.set(n, c); return c; } }; },
      getName: () => name,
      getLastRow: () => s.data.length,
      getMaxRows: () => s.maxRows,
      getMaxColumns: () => s.maxCols,
      insertRowsAfter: (_a, n) => { s.maxRows += n; },
      insertColumnsAfter: (_a, n) => { s.maxCols += n; },
      hideSheet: () => { s.hidden = true; },
      setFrozenRows: () => {},
      setColumnWidths: () => {},
      clear: () => { s.data = []; },
      protect: () => noop,
      getDataRange: () => s.getRange(1, 1, s.data.length, Math.max(...s.data.map((r) => r.length))),
      getRange(r, c, nr = 1, nc = 1) {
        if (typeof r === 'string') return noop;
        if (r + nr - 1 > s.maxRows || c + nc - 1 > s.maxCols) throw new Error(`Range outside sheet ${name}: ${r},${c},${nr},${nc}`);
        let proxy;
        const range = {
          getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.data[r - 1 + i]?.[c - 1 + j] ?? '')),
          getDisplayValues: () => range.getValues().map((row) => row.map(String)),
          getBackgrounds: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => s.bg[r - 1 + i]?.[c - 1 + j] ?? '#ffffff')),
          getMergedRanges: () => (s.merges ?? []).map(([mr, mc, mn]) => ({ getRow: () => mr, getColumn: () => mc, getNumColumns: () => mn })),
          setBackgrounds(v) {
            v.forEach((row, i) => row.forEach((val, j) => { s.bg[r - 1 + i] ??= []; s.bg[r - 1 + i][c - 1 + j] = val; }));
            return proxy;
          },
          setValues(v) {
            v.forEach((row, i) => row.forEach((val, j) => {
              s.data[r - 1 + i] ??= [];
              s.data[r - 1 + i][c - 1 + j] = val;
            }));
            return proxy;
          },
        };
        proxy = new Proxy(range, { get: (t, k) => (k in t ? t[k] : () => proxy) });
        return proxy;
      },
    };
    return s;
  }
  const ss = {
    getName: () => 'Test Spreadsheet',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit',
    getSpreadsheetTimeZone: () => 'Etc/UTC',
    getSheetByName: (n) => sheets.get(n) ?? null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
  };
  return {
    sheets,
    globals: {
      SpreadsheetApp: { getActive: () => ss },
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v), deleteProperty: (k) => props.delete(k) }) },
      LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
      Utilities: { getUuid: () => crypto.randomUUID(), formatDate: (d) => d.toISOString().slice(0, 10) },
      ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
      HtmlService: noop,
      Logger: { log() {} },
      console,
    },
  };
}

const g = fakeGoogle();
const ctx = vm.createContext({ ...g.globals, Date, Math, JSON, Number, String, Object });
vm.runInContext(readFileSync(new URL('../Code.gs', import.meta.url), 'utf8'), ctx);
const token = ctx.setup();
const call = (req) => JSON.parse(ctx.api(JSON.stringify({ token, ...req })));

const task = (id, title, updatedAt, extra = {}) => ({ type: 'task', id, title, updatedAt, createdAt: 1, date: '2026-10-01', importance: 'could', status: 'open', order: 1, ...extra });

// auth
assert.equal(JSON.parse(ctx.api(JSON.stringify({ token: 'nope', action: 'ping' }))).ok, false);
assert.equal(call({ action: 'ping' }).ok, true);

// laptop creates A and B
let laptop = call({ action: 'sync', since: 0, device: 'Mac', changes: [task('t_a', 'Pay rent', 1000), task('t_b', 'Update password', 1000)] });
assert.equal(laptop.ok, true);
assert.equal(laptop.accepted, 2);
assert.equal(laptop.changes.length, 0, 'own writes are not echoed back');

// phone pulls everything
let phone = call({ action: 'sync', since: 0, device: 'iPhone', changes: [] });
assert.deepEqual(phone.changes.map((e) => e.id).sort(), ['t_a', 't_b']);

// phone edits A, laptop edits B at the same time — both survive
phone = call({ action: 'sync', since: phone.cursor, device: 'iPhone', changes: [task('t_a', 'Pay rent (done on phone)', 2000, { status: 'done' })] });
laptop = call({ action: 'sync', since: laptop.cursor, device: 'Mac', changes: [task('t_b', 'Update password – 1Password', 2001)] });
assert.deepEqual(laptop.changes.map((e) => e.title), ['Pay rent (done on phone)']);
phone = call({ action: 'sync', since: phone.cursor, device: 'iPhone', changes: [] });
assert.deepEqual(phone.changes.map((e) => e.title), ['Update password – 1Password']);

// stale edit of the same item is rejected and the newer version is returned instead
const stale = call({ action: 'sync', since: laptop.cursor, device: 'Mac', changes: [task('t_a', 'old edit', 1500)] });
assert.deepEqual(stale.rejected, ['t_a']);
assert.equal(stale.changes[0].title, 'Pay rent (done on phone)');

// overwritten versions are kept in _app_history
const hist = g.sheets.get('_app_history').data.slice(1);
assert.equal(hist.length, 2);
assert.ok(hist.some((r) => JSON.parse(r[4]).title === 'Pay rent'));

// re-sending an identical item is a no-op
const again = call({ action: 'sync', since: stale.cursor, device: 'Mac', changes: [task('t_b', 'Update password – 1Password', 2001)] });
assert.equal(again.accepted, 0);
assert.equal(g.sheets.get('_app_history').data.length - 1, 2);

// many rows: sheet grows past its default size
const bulk = Array.from({ length: 1200 }, (_, i) => task(`t_bulk${i}`, `bulk ${i}`, 3000, { recurrence: i === 0 ? { freq: 'daily', interval: 1 } : undefined }));
const big = call({ action: 'sync', since: again.cursor, device: 'Mac', changes: bulk });
assert.equal(big.accepted, 1200);
assert.equal(g.sheets.get('_app_data').data.length, 1 + 2 + 1200);

// the read-only calendar mirror was built
const cal = g.sheets.get('Calendar (app)');
assert.ok(cal && cal.data[0].length === 50, 'calendar has 50 day columns');
assert.ok(cal.data.flat().includes('bulk 0'), 'recurring task appears in mirror');

// ---- linked original tab: import, then keep writing back into it
const legacy = ctx.SpreadsheetApp.getActive().insertSheet('2026 Planner');
legacy.data = [
  ['9/29', '9/30', '10/1', '10/2'],
  ['old note', 'Pay day', 'stale cell', ''],
  ['', '', 'another stale', ''],
];
legacy.bg = [[], ['#00ff00', '#00ff00', '#ff0000', '#ffffff'], ['', '', '#ffff00', '']];
legacy.merges = [[2, 1, 2]]; // "old note" merged across 9/29–9/30 (row, column, width)
let res = call({ action: 'legacy', sheet: '2026 Planner' });
assert.deepEqual(res.sheet.spans, [{ r: 0, c: 0, cols: 2 }], 'merged blocks are reported for import');
legacy.merges = [];
res = call({ action: 'link', sheet: '2026 Planner', from: '2026-10-01' });
assert.equal(res.ok, true, res.error);
assert.ok(g.sheets.get('2026 Planner (backup before Planner)'), 'backup copy made');
assert.deepEqual(g.sheets.get('2026 Planner (backup before Planner)').data[1], ['old note', 'Pay day', 'stale cell', '']);
res = call({
  action: 'sync', since: 0, device: 'Mac',
  changes: [
    task('t_l1', 'Call the bank', 5000, { date: '2026-10-01', time: '07:55', importance: 'must' }),
    task('t_l2', 'Mia setup', 5000, { date: '2026-10-01', importance: 'should', status: 'done' }),
    task('t_l3', 'Vehicle renewal', 5000, { date: '2026-10-04', importance: 'must' }),
  ],
});
assert.equal(res.ok, true, res.error);
const L = legacy.data;
assert.equal(L[1][0], 'old note', 'columns before the link date are untouched');
assert.equal(L[1][1], 'Pay day');
assert.equal(L[1][2], '7:55AM Call the bank', 'linked day rewritten from the app');
assert.equal(legacy.bg[1][2], '#ff0000');
const col = (c) => L.slice(1).map((r, i) => [r[c], legacy.bg[i + 1]?.[c]]);
const mia = col(2).find(([v]) => v === 'Mia setup');
assert.ok(mia, 'other tasks of that day are written below');
assert.equal(mia[1], '#00ff00', 'done = green');
assert.ok(!col(2).some(([v]) => v === 'stale cell' || v === 'another stale'), 'old cells in linked columns are replaced');
assert.deepEqual(L[0].slice(4), ['10/3', '10/4'], 'new date columns appended for later tasks');
assert.ok(col(5).some(([v, bg]) => v === 'Vehicle renewal' && bg === '#ff0000'), 'task in the new column');
assert.ok(!call({ action: 'ping' }).sheets.includes('2026 Planner (backup before Planner)'), 'backup hidden from import list');
// an all-day span shows on every day it covers, on top, in the event colour
res = call({ action: 'sync', since: 0, device: 'Mac', changes: [task('t_ev', 'Vacation', 5500, { date: '2026-10-02', endDate: '2026-10-04', allDay: true })] });
assert.equal(res.ok, true, res.error);
assert.deepEqual([3, 4, 5].map((c) => legacy.data[1][c]), ['Vacation (1/3)', 'Vacation (2/3)', 'Vacation (3/3)'], 'span on each day, first row');
assert.equal(legacy.bg[1][3], '#e4d7fb');
assert.ok(col(5).some(([v]) => v === 'Vehicle renewal'), 'the day\'s task is still there, below the event');
assert.equal(call({ action: 'unlink' }).ok, true);
call({ action: 'sync', since: 0, device: 'Mac', changes: [task('t_l1', 'renamed after unlink', 6000, { date: '2026-10-01', time: '07:55' })] });
assert.equal(legacy.data[1][2], '7:55AM Call the bank', 'unlinked tab no longer changes');

// every response says which script version answered (so the app can ask for an update)
const pong = call({ action: 'ping' });
assert.equal(typeof pong.scriptVersion, 'number');
assert.ok(pong.url, 'ping returns the spreadsheet URL');
const src = (await import('node:fs')).readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
assert.equal(pong.scriptVersion, Number(/var SCRIPT_VERSION = (\d+)/.exec(src)[1]));

console.log('apps-script sync: all scenarios passed');
