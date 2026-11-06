const { contextBridge, ipcRenderer } = require('electron');

// Paint only. This renderer receives no salary data and exposes no desktop commands.
let latest;
const listeners = new Set();
ipcRenderer.on('niuma:desktop-pet-frame', (_event, frame) => {
  latest = frame;
  for (const listener of listeners) listener(frame);
});
contextBridge.exposeInMainWorld('petOverlay', {
  onFrame(listener) {
    listeners.add(listener);
    if (latest) listener(latest);
    return () => listeners.delete(listener);
  },
});
