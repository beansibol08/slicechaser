// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sliceChaser', {
  env: () => ipcRenderer.invoke('env'),
  listSources: () => ipcRenderer.invoke('list-sources'),
  readText: (file) => ipcRenderer.invoke('read-text', file),
  readChase: () => ipcRenderer.invoke('read-chase'),
  writeChase: (text) => ipcRenderer.invoke('write-chase', text),
  chooseSource: () => ipcRenderer.invoke('choose-source'),
  watchSource: (file) => ipcRenderer.invoke('watch-source', file),
  revealChase: () => ipcRenderer.invoke('reveal-chase'),
  onSourceChanged: (fn) => ipcRenderer.on('source-changed', (_e, file) => fn(file))
});
