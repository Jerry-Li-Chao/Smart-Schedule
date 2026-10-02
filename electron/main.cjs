// Electron main process: windows, local storage on disk, daily backups, the global quick-capture sticky.
const { app, BrowserWindow, ipcMain, globalShortcut, Menu, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const dataDir = () => app.getPath('userData');
const dataFile = () => path.join(dataDir(), 'data.json');
const backupDir = () => path.join(dataDir(), 'backups');
const prefsFile = () => path.join(dataDir(), 'prefs.json');

let win = null;
let captureWin = null;
let capturePinned = false;
let lastInbox = [];
let quitting = false;

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}
function writePrefs(p) {
  fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...p }, null, 2));
}

function load(w, hash = '') {
  if (DEV_URL) w.loadURL(DEV_URL + (hash ? `#${hash}` : ''));
  else w.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), hash ? { hash } : undefined);
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function createMain() {
  const bounds = readPrefs().bounds;
  win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 720,
    minHeight: 480,
    title: 'Planner',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 17 }, // inside the 84px mac sidebar, centred on the 46px top bar
    backgroundColor: '#f5f4f0',
    webPreferences,
  });
  load(win);
  // pinch zooms the day columns (handled in the page), not the whole window
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('close', (e) => {
    writePrefs({ bounds: win.getBounds() });
    // macOS convention: closing hides; the app (and the capture shortcut) keeps running
    if (process.platform === 'darwin' && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createCapture() {
  captureWin = new BrowserWindow({
    width: 340,
    height: 300,
    show: false,
    frame: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#fdf6a3',
    roundedCorners: true,
    webPreferences,
  });
  captureWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  load(captureWin, 'capture');
  captureWin.on('blur', () => {
    if (!capturePinned) captureWin.hide();
  });
  captureWin.webContents.on('did-finish-load', () => captureWin.webContents.send('inbox', lastInbox));
}

function toggleCapture() {
  if (!captureWin || captureWin.isDestroyed()) createCapture();
  if (captureWin.isVisible() && captureWin.isFocused()) return captureWin.hide();
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [w] = captureWin.getSize();
  captureWin.setPosition(workArea.x + workArea.width - w - 24, workArea.y + 24);
  captureWin.show();
  captureWin.focus();
}

function registerShortcut(acc) {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(acc, toggleCapture);
  } catch {
    return false;
  }
}

// ---------- persistence: atomic writes + one dated backup per day ----------
ipcMain.handle('db:load', async () => {
  try {
    const raw = await fs.promises.readFile(dataFile(), 'utf8');
    // copy of what we started this session with — recoverable even if the app then misbehaves
    await fs.promises.writeFile(path.join(dataDir(), 'data.session-start.json'), raw);
    return raw;
  } catch {
    return null;
  }
});

ipcMain.handle('db:save', async (_e, json) => {
  if (typeof json !== 'string' || !json.startsWith('{')) return;
  const tmp = dataFile() + '.tmp';
  await fs.promises.writeFile(tmp, json);
  await fs.promises.rename(tmp, dataFile());
  await backupIfNeeded(json);
});

async function backupIfNeeded(json) {
  const day = new Date().toISOString().slice(0, 10);
  const dir = backupDir();
  const file = path.join(dir, `${day}.json`);
  await fs.promises.mkdir(dir, { recursive: true });
  if (fs.existsSync(file)) return;
  await fs.promises.writeFile(file, json);
  const all = (await fs.promises.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 60))) await fs.promises.unlink(path.join(dir, old));
}

// ---------- network: sync requests go through Node so there is no CORS to fight ----------
ipcMain.handle('http:post', async (_e, url, body) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Only https URLs are allowed');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
  return { status: r.status, text: await r.text() };
});

// local LLM (Ollama / LM Studio): plain http to your own machine is allowed here
ipcMain.handle('llm:request', async (_e, method, url, body) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('LLM URL must start with http:// or https://');
  const r = await fetch(url, {
    method: method === 'GET' ? 'GET' : 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body || undefined,
    signal: AbortSignal.timeout(120000),
  });
  return { status: r.status, text: await r.text() };
});

// ---------- quick capture ----------
ipcMain.on('capture:add', (_e, text) => {
  if (win && !win.isDestroyed()) win.webContents.send('capture:added', String(text));
});
ipcMain.on('capture:hide', () => captureWin?.hide());
ipcMain.on('capture:toggle', () => toggleCapture());
ipcMain.on('capture:pin', (_e, pin) => {
  capturePinned = !!pin;
});
ipcMain.on('inbox', (_e, items) => {
  lastInbox = Array.isArray(items) ? items : [];
  if (captureWin && !captureWin.isDestroyed()) captureWin.webContents.send('inbox', lastInbox);
});
ipcMain.on('badge', (_e, n) => {
  if (process.platform === 'darwin' && app.dock) app.dock.setBadge(n > 0 ? String(n) : '');
});
ipcMain.handle('shortcut:set', (_e, acc) => {
  const ok = registerShortcut(String(acc));
  if (ok) writePrefs({ shortcut: String(acc) });
  else registerShortcut(readPrefs().shortcut || 'CommandOrControl+Shift+Space');
  return ok;
});
ipcMain.on('backups:open', () => {
  fs.mkdirSync(backupDir(), { recursive: true });
  shell.openPath(backupDir());
});

function send(cmd) {
  if (!win || win.isDestroyed()) return;
  win.show();
  win.webContents.send('menu', cmd);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Sticky Note', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Quick Capture (floating sticky)', click: toggleCapture },
        { type: 'separator' },
        { label: 'Sync Now', accelerator: 'CmdOrCtrl+S', click: () => send('sync') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // undo/redo go to the app (task history) unless you're typing in a field
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Today', accelerator: 'CmdOrCtrl+T', click: () => send('today') },
        { label: 'Plan…', accelerator: 'CmdOrCtrl+P', click: () => send('plan') },
      ],
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { label: 'Actual Size (days)', accelerator: 'CmdOrCtrl+0', click: () => send('zoom-reset') }, { label: 'Zoom In (fewer, bigger days)', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') }, { label: 'Zoom Out (more days)', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.setName('Planner');
app.whenReady().then(() => {
  buildMenu();
  createMain();
  createCapture();
  registerShortcut(readPrefs().shortcut || 'CommandOrControl+Shift+Space');
  app.on('activate', () => {
    if (!win || win.isDestroyed()) createMain();
    else win.show();
  });
});
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
