const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('db:load'),
  save: (json) => ipcRenderer.invoke('db:save', json),
  post: (url, body) => ipcRenderer.invoke('http:post', url, body),
  capture: (text) => ipcRenderer.send('capture:add', text),
  onCapture: (cb) => ipcRenderer.on('capture:added', (_e, text) => cb(text)),
  hideCapture: () => ipcRenderer.send('capture:hide'),
  pinCapture: (pin) => ipcRenderer.send('capture:pin', pin),
  pushInbox: (items) => ipcRenderer.send('inbox', items),
  onInbox: (cb) => ipcRenderer.on('inbox', (_e, items) => cb(items)),
  setBadge: (n) => ipcRenderer.send('badge', n),
  setShortcut: (acc) => ipcRenderer.invoke('shortcut:set', acc),
  openBackups: () => ipcRenderer.send('backups:open'),
  writeBackup: (name, json) => ipcRenderer.invoke('backups:write', name, json),
  listBackups: () => ipcRenderer.invoke('backups:list'),
  readBackup: (name) => ipcRenderer.invoke('backups:read', name),
  llm: (method, url, body) => ipcRenderer.invoke('llm:request', method, url, body),
  llmStream: (id, url, body, onChunk) => {
    const listen = (_e, cid, text) => cid === id && onChunk(text);
    ipcRenderer.on('llm:chunk', listen);
    return ipcRenderer.invoke('llm:stream', id, url, body).finally(() => ipcRenderer.removeListener('llm:chunk', listen));
  },
  llmAbort: (id) => ipcRenderer.send('llm:abort', id),
  openCapture: () => ipcRenderer.send('capture:toggle'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
});
