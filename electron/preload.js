const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('inbox', {
  onSelection: (fn) => ipcRenderer.on('capture:selection', (_e, d) => fn(d)),
  onSource: (fn) => ipcRenderer.on('capture:source', (_e, d) => fn(d)),
  onPending: (fn) => ipcRenderer.on('capture:pending', () => fn()),
  submit: (payload) => ipcRenderer.invoke('capture:submit', payload),
  dismiss: () => ipcRenderer.send('capture:dismiss'),
  resize: (h) => ipcRenderer.send('capture:resize', h),
  openVault: () => ipcRenderer.send('capture:open-vault'),
});
