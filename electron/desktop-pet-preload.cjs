const { contextBridge, ipcRenderer } = require('electron');

// Paint only. This renderer receives no salary data and exposes no desktop commands.
let latest;
const listeners = new Set();
let preparationPending = false;
const prepareListeners = new Set();
ipcRenderer.on('niuma:desktop-pet-prepare', () => {
  preparationPending = true;
  for (const listener of prepareListeners) listener();
});
ipcRenderer.on('niuma:desktop-pet-frame', (_event, frame) => {
  latest = frame;
  for (const listener of listeners) listener(frame);
});
contextBridge.exposeInMainWorld('petOverlay', {
  onPrepare(listener) {
    prepareListeners.add(listener);
    if (preparationPending) listener();
    return () => prepareListeners.delete(listener);
  },
  surfaceReady() {
    if (!preparationPending) return;
    preparationPending = false;
    ipcRenderer.send('niuma:desktop-pet-surface-ready');
  },
  firstFramePainted: () => ipcRenderer.send('niuma:desktop-pet-first-paint'),
  onFrame(listener) {
    listeners.add(listener);
    if (latest) listener(latest);
    return () => listeners.delete(listener);
  },
});
