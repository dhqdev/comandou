// Ponte entre a tela (sem acesso ao Node) e o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  state: () => ipcRenderer.invoke('state'),
  connect: (code) => ipcRenderer.invoke('connect', code),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  printers: () => ipcRenderer.invoke('printers'),
  ports: () => ipcRenderer.invoke('ports'),
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  onScanProgress: (fn) => ipcRenderer.on('scan-progress', (_e, p) => fn(p)),
  setPrinter: (target, spec) => ipcRenderer.invoke('set-printer', target, spec),
  testPrint: (spec) => ipcRenderer.invoke('test-print', spec),
  setAutostart: (on) => ipcRenderer.invoke('set-autostart', on),
  openPanel: () => ipcRenderer.invoke('open-panel'),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onLink: (fn) => ipcRenderer.on('link', (_e, l) => fn(l)),
});
