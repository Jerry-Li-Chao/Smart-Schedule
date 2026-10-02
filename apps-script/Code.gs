/**
 * Planner — Google Sheets backend.
 *
 * Lives inside your existing spreadsheet (Extensions → Apps Script). It adds three tabs and
 * never touches your other tabs:
 *   _app_data      one row per task/project (the source of truth the apps sync with)
 *   _app_history   every version that was ever overwritten, so nothing is lost
 *   Calendar (app) a read-only, colour-coded day-column view for glancing in the Sheets app
 *
 * Merge rule: each item is merged on its own; the newer edit of THAT item wins and the older
 * one is copied to _app_history. Two devices editing different tasks never collide.
 */

var DATA_SHEET = '_app_data';
var HIST_SHEET = '_app_history';
var CAL_SHEET = 'Calendar (app)';
var DATA_HEADERS = ['id', 'type', 'updatedAt', 'serverTs', 'deleted', 'device', 'json'];
var HIST_HEADERS = ['savedAt', 'id', 'device', 'updatedAt', 'json (overwritten version)'];
var OWN_SHEETS = [DATA_SHEET, HIST_SHEET, CAL_SHEET];

/** Run this once from the editor (select "setup" → Run). It prints your sync token. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 40);
    props.setProperty('TOKEN', token);
  }
  sheet_(DATA_SHEET, DATA_HEADERS);
  sheet_(HIST_SHEET, HIST_HEADERS);
  Logger.log('Your sync token (paste into the app → Settings):\n\n    ' + token + '\n');
  Logger.log('Next: Deploy → New deployment → type "Web app", Execute as "Me", Who has access "Anyone". Copy the URL ending in /exec.');
  return token;
}

/** If the token ever leaks, run this and paste the new one into each device. */
function rotateToken() {
  PropertiesService.getScriptProperties().deleteProperty('TOKEN');
  return setup();
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action) return json_(api_(p));
  try {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Planner')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
  } catch (err) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif">Planner sync backend is running. The phone UI file (Index.html) is not installed yet — see README “Phone”.</p>'
    );
  }
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request body' });
  }
  return json_(api_(req));
}

/** Entry point for the phone UI served by this script (google.script.run). */
function api(reqJson) {
  return JSON.stringify(api_(JSON.parse(reqJson)));
}

function api_(req) {
  var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
  if (!token) return { ok: false, error: 'Backend not set up yet: open Extensions → Apps Script and run setup().' };
  if (!req || req.token !== token) return { ok: false, error: 'Wrong sync token.' };
  try {
    switch (req.action) {
      case 'ping':
        return { ok: true, spreadsheet: SpreadsheetApp.getActive().getName(), sheets: userSheets_(), linked: linked_() };
      case 'sync':
        return sync_(req);
      case 'legacy':
        return { ok: true, sheet: readLegacy_(req.sheet) };
      case 'link':
        return link_(req);
      case 'unlink':
        return unlink_();
      case 'mirror':
        renderCalendar_(readRows_(sheet_(DATA_SHEET, DATA_HEADERS)));
        renderLinked_(readRows_(sheet_(DATA_SHEET, DATA_HEADERS)));
        return { ok: true };
      default:
        return { ok: false, error: 'Unknown action: ' + req.action };
    }
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// ---------------------------------------------------------------- sync

function sync_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var sh = sheet_(DATA_SHEET, DATA_HEADERS);
    var rows = readRows_(sh);
    var index = {};
    for (var i = 0; i < rows.length; i++) index[rows[i][0]] = i;

    var clock = Number(props.getProperty('CLOCK') || 0);
    var tick = function () {
      clock = Math.max(Date.now(), clock + 1);
      return clock;
    };
    var since = Number(req.since || 0);
    var device = String(req.device || '');
    var changes = req.changes || [];
    var hist = [];
    var accepted = {};
    var rejected = {};
    var nAccepted = 0;

    for (var c = 0; c < changes.length; c++) {
      var ent = changes[c];
      if (!ent || typeof ent.id !== 'string' || !ent.type) continue;
      var json = JSON.stringify(ent);
      if (json.length > 49000) throw new Error('Item too large for one cell: ' + (ent.title || ent.id));
      var at = index[ent.id];
      if (at !== undefined) {
        var cur = rows[at];
        if (Number(ent.updatedAt) < Number(cur[2])) {
          rejected[ent.id] = true; // someone else's newer edit wins; client gets it below
          continue;
        }
        if (cur[6] === json) {
          accepted[ent.id] = true;
          continue;
        }
        hist.push([new Date(), cur[0], cur[5], Number(cur[2]), cur[6]]);
        rows[at] = [ent.id, ent.type, Number(ent.updatedAt), tick(), !!ent.deleted, device, json];
      } else {
        index[ent.id] = rows.length;
        rows.push([ent.id, ent.type, Number(ent.updatedAt), tick(), !!ent.deleted, device, json]);
      }
      accepted[ent.id] = true;
      nAccepted++;
    }

    if (nAccepted) {
      ensureSize_(sh, rows.length + 1, DATA_HEADERS.length);
      sh.getRange(2, 1, rows.length, DATA_HEADERS.length).setValues(rows);
      if (hist.length) {
        var hs = sheet_(HIST_SHEET, HIST_HEADERS);
        var start = hs.getLastRow() + 1;
        ensureSize_(hs, start + hist.length - 1, HIST_HEADERS.length);
        hs.getRange(start, 1, hist.length, HIST_HEADERS.length).setValues(hist);
      }
      props.setProperty('CLOCK', String(clock));
    }

    var out = [];
    var cursor = since;
    for (var r = 0; r < rows.length; r++) {
      var ts = Number(rows[r][3]);
      if (ts > cursor) cursor = ts;
      var id = rows[r][0];
      if (rejected[id] || (ts > since && !accepted[id])) out.push(JSON.parse(rows[r][6]));
    }

    if (nAccepted) {
      try {
        renderCalendar_(rows);
      } catch (err) {
        console.warn('Calendar mirror failed: ' + err);
      }
      try {
        renderLinked_(rows);
      } catch (err) {
        console.warn('Linked tab update failed: ' + err);
      }
    }
    return { ok: true, cursor: cursor, changes: out, accepted: nAccepted, rejected: Object.keys(rejected) };
  } finally {
    lock.releaseLock();
  }
}

function ensureSize_(sh, rows, cols) {
  if (sh.getMaxRows() < rows) sh.insertRowsAfter(sh.getMaxRows(), rows - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
}

function readRows_(sh) {
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, DATA_HEADERS.length).getValues() : [];
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name, ss.getSheets().length);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange(1, headers.length, sh.getMaxRows(), 1).setNumberFormat('@');
    if (name !== CAL_SHEET) sh.hideSheet();
  }
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function userSheets_() {
  return SpreadsheetApp.getActive()
    .getSheets()
    .map(function (s) {
      return s.getName();
    })
    .filter(function (n) {
      return OWN_SHEETS.indexOf(n) < 0 && !/\(backup before Planner\)$/.test(n);
    });
}

// ---------------------------------------------------------------- import of the old layout

function readLegacy_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('No tab named "' + name + '"');
  var range = sh.getDataRange();
  var values = range.getDisplayValues();
  var bgs = range.getBackgrounds();
  return { name: name, header: values[0] || [], cells: values.slice(1), bgs: bgs.slice(1) };
}

// ---------------------------------------------------------------- read-only calendar mirror

var COLORS = { must: '#ff0000', should: '#ffff00', could: '#ffffff', done: '#00ff00', dropped: '#b7b7b7' };

function renderCalendar_(rows) {
  var ss = SpreadsheetApp.getActive();
  var tz = ss.getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var start = addDays_(today, -7);
  var DAYS = 50;

  var data = collect_(rows);
  var cols = [];
  var maxLen = 0;
  for (var d = 0; d < DAYS; d++) {
    var date = addDays_(start, d);
    var items = itemsOn_(data, date);
    cols.push({ date: date, items: items });
    maxLen = Math.max(maxLen, items.length);
  }

  var H = Math.max(maxLen, 1) + 1;
  var values = [];
  var bgs = [];
  var lines = [];
  for (var r = 0; r < H; r++) {
    values.push([]);
    bgs.push([]);
    lines.push([]);
  }
  for (var c = 0; c < cols.length; c++) {
    var col = cols[c];
    var dd = col.date.split('-');
    values[0].push(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow_(col.date)] + ' ' + Number(dd[1]) + '/' + Number(dd[2]));
    bgs[0].push(col.date === today ? '#c9daf8' : '#f3f3f3');
    lines[0].push('none');
    for (var rr = 1; rr < H; rr++) {
      var it = col.items[rr - 1];
      if (!it) {
        values[rr].push('');
        bgs[rr].push('#ffffff');
        lines[rr].push('none');
        continue;
      }
      values[rr].push(cellText_(it));
      bgs[rr].push(cellColor_(it));
      lines[rr].push(it.status === 'dropped' ? 'line-through' : 'none');
    }
  }

  var sh = ss.getSheetByName(CAL_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CAL_SHEET);
    sh.protect().setDescription('Generated by the Planner app — edit in the app instead').setWarningOnly(true);
    sh.setFrozenRows(1);
  }
  sh.clear();
  ensureSize_(sh, H, DAYS);
  var rng = sh.getRange(1, 1, H, DAYS);
  rng.setValues(values).setBackgrounds(bgs).setFontLines(lines).setFontWeight('bold').setVerticalAlignment('middle');
  sh.getRange(1, 1, 1, DAYS).setHorizontalAlignment('right');
  sh.setColumnWidths(1, DAYS, 210);
  sh.getRange(1, 1).setNote('Read-only mirror, rebuilt on every sync. Edits here are not read back — use the app.');
}

function collect_(rows) {
  var tasks = [];
  var projects = {};
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][4] === true || rows[i][4] === 'TRUE') continue;
    var e = JSON.parse(rows[i][6]);
    if (e.deleted) continue;
    if (e.type === 'project') projects[e.id] = e;
    else if (e.type === 'task' && e.date) tasks.push(e);
  }
  return { tasks: tasks, projects: projects };
}

/** Everything shown on one day, in the app's default order (timed first, then manual order). */
function itemsOn_(data, date) {
  var items = [];
  for (var k = 0; k < data.tasks.length; k++) {
    var t = data.tasks[k];
    if (t.recurrence) {
      var st = (t.completions && t.completions[date]) || 'open';
      if (st !== 'deleted' && st !== 'moved' && occursOn_(t.recurrence, t.date, date)) items.push({ t: t, status: st, date: date });
    } else if (t.date === date) items.push({ t: t, status: t.status });
  }
  items.sort(function (a, b) {
    return (a.t.time || '99').localeCompare(b.t.time || '99') || a.t.order - b.t.order;
  });
  for (var pid in data.projects) {
    var entries = (data.projects[pid].tracker && data.projects[pid].tracker.entries) || [];
    for (var x = 0; x < entries.length; x++)
      if (entries[x].outcome === 'pending' && entries[x].followUp === date)
        items.push({ t: { title: 'Follow up: ' + entries[x].name, importance: 'could' }, status: 'open' });
  }
  return items;
}

/** Same as the app: "#" becomes this day's number (deleted days don't count, moved/skipped do). */
function numbered_(t, date) {
  if (!t.numbering || !t.recurrence) return t.title;
  var n = (t.numbering.start || 1) - 1;
  for (var d = t.date; d <= date; d = addDays_(d, 1))
    if (occursOn_(t.recurrence, t.date, d) && !(t.completions && t.completions[d] === 'deleted')) n++;
  return t.title.indexOf('#') >= 0 ? t.title.replace('#', String(n)) : t.title + ' ' + n;
}

function cellText_(it) {
  var label = (it.t.time ? fmtTime_(it.t.time) + ' ' : '') + (it.date ? numbered_(it.t, it.date) : it.t.title);
  if (it.t.firstScheduled && it.t.date > it.t.firstScheduled && it.status !== 'done') label += ' (cont.)';
  return label;
}
function cellColor_(it) {
  return it.status === 'done' ? COLORS.done : it.status === 'dropped' ? COLORS.dropped : COLORS[it.t.importance] || '#ffffff';
}

// ---------------------------------------------------------------- linked original tab

/**
 * After importing a tab, the app can keep writing back into it, in its own layout:
 * row 1 = dates, one task per cell, same colours. Columns dated before `from` are never touched;
 * days after the last column get new columns. A backup copy of the tab is made when linking.
 */
function link_(req) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(req.sheet);
  if (!sh) throw new Error('No tab named "' + req.sheet + '"');
  var backupName = req.sheet + ' (backup before Planner)';
  if (!ss.getSheetByName(backupName)) sh.copyTo(ss).setName(backupName);
  PropertiesService.getScriptProperties().setProperty('LINKED', JSON.stringify({ sheet: req.sheet, from: req.from }));
  renderLinked_(readRows_(sheet_(DATA_SHEET, DATA_HEADERS)));
  return { ok: true, backup: backupName };
}

function unlink_() {
  PropertiesService.getScriptProperties().deleteProperty('LINKED');
  return { ok: true };
}

function linked_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LINKED');
  return raw ? JSON.parse(raw) : null;
}

/** "9/28", "9/28/2026", "2026-09-28" → ISO, inferring the year as columns advance (same rules as the app). */
function headerDates_(header, sheetName) {
  var y = Number((/20\d\d/.exec(sheetName) || [])[0] || new Date().getFullYear());
  var lastM = 0;
  return header.map(function (h) {
    var s = String(h || '').trim();
    var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) {
      y = Number(m[1]);
      lastM = Number(m[2]);
      return m[1] + '-' + pad_(Number(m[2])) + '-' + pad_(Number(m[3]));
    }
    m = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(s);
    if (!m) return null;
    var mo = Number(m[1]);
    if (m[3]) y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    else if (lastM && mo < lastM - 6) y += 1;
    lastM = mo;
    return y + '-' + pad_(mo) + '-' + pad_(Number(m[2]));
  });
}

function renderLinked_(rows) {
  var link = linked_();
  if (!link) return;
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(link.sheet);
  if (!sh) return;
  var data = collect_(rows);
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var header = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var dates = headerDates_(header, link.sheet);

  // add columns for days after the last dated column, up to the latest task (max ~1 year ahead)
  var lastDate = null;
  for (var c = dates.length - 1; c >= 0; c--) if (dates[c]) { lastDate = dates[c]; break; }
  var latest = lastDate;
  for (var k = 0; k < data.tasks.length; k++) {
    var t = data.tasks[k];
    if (!t.recurrence && t.date > (latest || '') && t.date <= addDays_(lastDate || t.date, 366)) latest = t.date;
  }
  if (lastDate && latest > lastDate) {
    var extra = diff_(lastDate, latest);
    ensureSize_(sh, sh.getMaxRows(), lastCol + extra);
    var heads = [];
    for (var n = 1; n <= extra; n++) {
      var dd = addDays_(lastDate, n);
      heads.push(Number(dd.slice(5, 7)) + '/' + Number(dd.slice(8, 10)));
      dates.push(dd);
    }
    sh.getRange(1, lastCol + 1, 1, extra).setNumberFormat('@').setValues([heads]).setHorizontalAlignment('right');
    lastCol += extra;
  }

  // rewrite every column from `from` onward
  var first = -1;
  for (var i = 0; i < dates.length; i++) if (dates[i] && dates[i] >= link.from) { first = i; break; }
  if (first < 0) return;
  var width = dates.length - first;
  var perCol = [];
  var maxLen = 0;
  for (var j = 0; j < width; j++) {
    var date = dates[first + j];
    var items = date ? itemsOn_(data, date) : null;
    perCol.push(items);
    if (items) maxLen = Math.max(maxLen, items.length);
  }
  var H = Math.max(maxLen, sh.getLastRow() - 1, 1);
  ensureSize_(sh, H + 1, lastCol);
  var range = sh.getRange(2, first + 1, H, width);
  var values = range.getValues();
  var bgs = range.getBackgrounds();
  var lines = [];
  for (var r = 0; r < H; r++) {
    lines.push([]);
    for (var cc = 0; cc < width; cc++) {
      var list = perCol[cc];
      if (!list) {
        lines[r].push('none');
        continue; // not a date column — leave it as it is
      }
      var it = list[r];
      values[r][cc] = it ? cellText_(it) : '';
      bgs[r][cc] = it ? cellColor_(it) : '#ffffff';
      lines[r].push(it && it.status === 'dropped' ? 'line-through' : 'none');
    }
  }
  range.setValues(values).setBackgrounds(bgs).setFontLines(lines);
}

function addDays_(iso, n) {
  var p = iso.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
  return d.getFullYear() + '-' + pad_(d.getMonth() + 1) + '-' + pad_(d.getDate());
}
function pad_(n) {
  return (n < 10 ? '0' : '') + n;
}
function toDate_(iso) {
  var p = iso.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function dow_(iso) {
  return toDate_(iso).getDay();
}
function diff_(a, b) {
  return Math.round((toDate_(b) - toDate_(a)) / 86400000);
}
function dim_(y, m0) {
  return new Date(y, m0 + 1, 0).getDate();
}
function fmtTime_(t) {
  var h = Number(t.split(':')[0]);
  var m = t.split(':')[1];
  return (h % 12 || 12) + (m !== '00' ? ':' + m : '') + (h >= 12 ? 'PM' : 'AM');
}

/** Same rules as src/lib/recurrence.ts */
function occursOn_(r, start, d) {
  if (d < start) return false;
  if (r.until && d > r.until) return false;
  var iv = Math.max(1, r.interval || 1);
  var s = toDate_(start);
  var x = toDate_(d);
  if (r.freq === 'daily') return diff_(start, d) % iv === 0;
  if (r.freq === 'weekly') {
    var days = r.byWeekday && r.byWeekday.length ? r.byWeekday : [s.getDay()];
    if (days.indexOf(x.getDay()) < 0) return false;
    var mon = function (iso) {
      return addDays_(iso, -((dow_(iso) + 6) % 7));
    };
    return Math.round(diff_(mon(start), mon(d)) / 7) % iv === 0;
  }
  if (r.freq === 'monthly') {
    var months = (x.getFullYear() - s.getFullYear()) * 12 + x.getMonth() - s.getMonth();
    if (months % iv) return false;
    return x.getDate() === Math.min(s.getDate(), dim_(x.getFullYear(), x.getMonth()));
  }
  if (r.freq === 'yearly') {
    if ((x.getFullYear() - s.getFullYear()) % iv || x.getMonth() !== s.getMonth()) return false;
    return x.getDate() === Math.min(s.getDate(), dim_(x.getFullYear(), x.getMonth()));
  }
  return false;
}
