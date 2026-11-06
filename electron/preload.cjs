const { contextBridge, ipcRenderer } = require('electron');

if (location.hash === '#/widget' && (process.platform === 'win32' || process.platform === 'darwin')) {
  // The widget mounts after its saved state loads; capture also covers later remounts.
  const onLaneBoundary = event => {
    const classes = event.target.classList;
    if (event.isTrusted && (classes?.contains('widget-pet-lane') || classes?.contains('connection-error'))) {
      ipcRenderer.send('niuma:widget-pointer-crossed');
    }
  };
  document.addEventListener('mouseenter', onLaneBoundary, true);
  document.addEventListener('mouseleave', onLaneBoundary, true);
}

const listen = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('niuma', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('niuma:get-state'),
  setState: (value) => ipcRenderer.invoke('niuma:set-state', value),
  onStateChanged: (callback) => listen('niuma:state-changed', callback),
  onWindowState: (callback) => listen('niuma:window-state', callback),
  onCalendarStatus: (callback) => listen('niuma:calendar-status', callback),
  refreshCalendar: () => ipcRenderer.invoke('niuma:refresh-calendar'),
  getCalendarStatus: () => ipcRenderer.invoke('niuma:get-calendar-status'),
  showWidget: () => ipcRenderer.invoke('niuma:show-widget'),
  hideWidget: () => ipcRenderer.invoke('niuma:hide-widget'),
  restoreMain: () => ipcRenderer.invoke('niuma:restore-main'),
  minimize: () => ipcRenderer.invoke('niuma:minimize'),
  maximize: () => ipcRenderer.invoke('niuma:maximize'),
  close: () => ipcRenderer.invoke('niuma:close'),
  quit: () => ipcRenderer.invoke('niuma:quit'),
});
