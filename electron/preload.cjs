const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('Expected a callback.');
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('niuma', {
  platform: process.platform,
  setPrivacy: (hidden) => ipcRenderer.invoke('niuma:set-privacy', hidden),
  getState: () => ipcRenderer.invoke('niuma:get-state'),
  setState: (value) => ipcRenderer.invoke('niuma:set-state', value),
  onStateChanged: (callback) => listen('niuma:state-changed', callback),
  onWindowState: (callback) => listen('niuma:window-state', callback),
  onCalendarStatus: (callback) => listen('niuma:calendar-status', callback),
  refreshCalendar: () => ipcRenderer.invoke('niuma:refresh-calendar'),
  getCalendarStatus: () => ipcRenderer.invoke('niuma:get-calendar-status'),
  showWidget: () => ipcRenderer.invoke('niuma:show-widget'),
  getWidgetLayer: () => ipcRenderer.invoke('niuma:get-widget-layer'),
  setWidgetLayer: (layer) => ipcRenderer.invoke('niuma:set-widget-layer', layer),
  onWidgetLayerChanged: (callback) => listen('niuma:widget-layer-changed', callback),
  getDesktopPetState: () => ipcRenderer.invoke('niuma:get-desktop-pet-state'),
  setDesktopPetMode: (mode) => ipcRenderer.invoke('niuma:desktop-pet-mode', mode),
  onDesktopPetState: (callback) => listen('niuma:desktop-pet-state', callback),
  setWidgetPet: (state) => ipcRenderer.send('niuma:set-widget-pet', state),
  onWidgetPointer: (callback) => listen('niuma:widget-pointer', callback),
  hideWidget: () => ipcRenderer.invoke('niuma:hide-widget'),
  restoreMain: () => ipcRenderer.invoke('niuma:restore-main'),
  minimize: () => ipcRenderer.invoke('niuma:minimize'),
  maximize: () => ipcRenderer.invoke('niuma:maximize'),
  close: () => ipcRenderer.invoke('niuma:close'),
  quit: () => ipcRenderer.invoke('niuma:quit'),
});
