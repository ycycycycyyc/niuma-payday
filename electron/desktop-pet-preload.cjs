const { contextBridge, ipcRenderer } = require('electron');

// This renderer receives no salary data. Its commands are limited to pet
// interaction; the owning surface is checked by the main process.
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
  restoreWidget: () => ipcRenderer.send('niuma:desktop-pet-restore-widget'),
  setRestoreTarget: rect => ipcRenderer.send('niuma:desktop-pet-restore-target', rect),
  feed: food => {
    if (food === 'kibble' || food === 'stick') ipcRenderer.send('niuma:desktop-pet-feed', food);
  },
  setReducedMotion: reduced => {
    if (typeof reduced === 'boolean') ipcRenderer.send('niuma:desktop-pet-motion-preference', reduced);
  },
  onFrame(listener) {
    listeners.add(listener);
    if (latest) listener(latest);
    return () => listeners.delete(listener);
  },
});
