const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inbox', {
  onSelection: (fn) => ipcRenderer.on('capture:selection', (_e, d) => fn(d)),
  onSource: (fn) => ipcRenderer.on('capture:source', (_e, d) => fn(d)),
  onPending: (fn) => ipcRenderer.on('capture:pending', () => fn()),
  save: (payload) => ipcRenderer.invoke('capture:save', payload),
  file: (payload) => ipcRenderer.invoke('capture:file', payload),
  dismiss: () => ipcRenderer.send('capture:dismiss'),
  resume: () => ipcRenderer.send('capture:resume'),
  resize: (h) => ipcRenderer.send('capture:resize', h),
  openVault: () => ipcRenderer.send('capture:open-vault'),
});
