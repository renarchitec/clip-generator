const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dartclip', {
  render: (opts) => ipcRenderer.invoke('render', opts),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  onEvent: (cb) => ipcRenderer.on('worker-event', (_e, data) => cb(data)),
  onLog: (cb) => ipcRenderer.on('worker-log', (_e, line) => cb(line)),
  onExit: (cb) => ipcRenderer.on('worker-exit', (_e, data) => cb(data)),
});
