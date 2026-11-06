import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, screen, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCalendarYear, isValidDateKey, normalizeCalendarCache } from '../shared/calendar.mjs';
import { createWidgetSession, decideWidget, dismissWidget, getActiveShift, markManualWidget } from '../shared/scheduler.mjs';
import { createEntryPolicy, isTrustedIpc } from '../shared/ipc-origin.mjs';
import widgetLayout from '../shared/widget-layout.json' with { type: 'json' };
import { fullWidgetHeight, petLaneHeight, widgetBoundsInWorkArea, widgetScaleInWorkArea } from '../shared/widget-geometry.mjs';
import { normalizeWidgetAppearance, validateWidgetAppearance } from '../shared/widget-appearance.mjs';
import { setWindowsWidgetLayer } from './windows-widget-layer.mjs';
import { DesktopPet } from './desktop-pet.mjs';
import { normalizePetLaunchPose } from '../shared/desktop-pet-motion.mjs';
import { migrateLegacyProfile } from '../shared/profile-migration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const developmentURL = process.env.VITE_DEV_SERVER_URL;
if (developmentURL && !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(developmentURL)) {
  throw new Error('The development server must use a local HTTP address.');
}
// Native smoke tests can isolate all state without touching the user's normal profile.
if (app.commandLine.hasSwitch('user-data-dir')) {
  const suppliedPath = app.commandLine.getSwitchValue('user-data-dir');
  if (!suppliedPath) throw new Error('--user-data-dir requires a directory path.');
  const isolatedPath = path.resolve(suppliedPath);
  fs.mkdirSync(isolatedPath, { recursive: true });
  app.setPath('userData', isolatedPath);
  app.setPath('sessionData', isolatedPath);
}

let mainWindow;
let widgetWindow;
let widgetShown = false;
let tray;
let trayMenuUpdate;
let quitting = false;
let appState = null;
let desktopState = {};
let positionTimer;
let lanePointerTimer;
let widgetPassesClicks = false;
let widgetPet = null;
let lastPetPointer = null;
let scheduleTimer;
let widgetSession = createWidgetSession();
let widgetRequest = 0;
const calendarJobs = new Map();
const calendarAttempts = new Map();
const CALENDAR_TTL = 7 * 24 * 60 * 60 * 1000;
const RETRY_DELAY = 6 * 60 * 60 * 1000;
let calendarStatus = { status: 'idle', message: '节假日日历尚未更新', calendar: {} };
const appIcon = path.join(root, 'build', 'icon.png');
const statePath = () => path.join(app.getPath('userData'), 'state.json');
const desktopPath = () => path.join(app.getPath('userData'), 'desktop.json');
const desktopPet = new DesktopPet({
  root, developmentURL, getWidget: () => widgetShown ? widgetWindow : null, getHit: () => widgetPet,
  notify(state) {
    if (widgetWindow && !widgetWindow.isDestroyed() && !widgetWindow.webContents.isDestroyed()) {
      widgetWindow.webContents.send('niuma:desktop-pet-state', state);
    }
    // Let a native menu finish dispatching its current command before replacing it.
    trayMenuUpdate ??= setImmediate(() => { trayMenuUpdate = undefined; refreshTrayMenu(); });
  },
});

function readJSON(filename, fallback) {
  try {
    const result = JSON.parse(fs.readFileSync(filename, 'utf8'));
    return result && typeof result === 'object' && !Array.isArray(result) ? result : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(filename, value) {
  // Rename replaces the previous complete document only after the next one is written.
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filename);
}

const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
function validState(value) {
  if (!isRecord(value) || value.version !== 3 || typeof value.configured !== 'boolean') return false;
  if (value.privacy !== undefined && typeof value.privacy !== 'boolean') return false;
  if (value.goal !== undefined && (!isRecord(value.goal) || typeof value.goal.name !== 'string'
    || !value.goal.name.trim() || value.goal.name.length > 32 || !Number.isFinite(value.goal.amount)
    || value.goal.amount <= 0 || value.goal.amount > 100_000_000)) return false;
  // A calendar-only first-run state is valid; it cannot schedule a popup.
  if (value.settings === undefined) return value.configured === false;
  const settings = value.settings;
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!isRecord(settings) || !Number.isFinite(settings.monthlySalary) || settings.monthlySalary < 0
    || (value.configured && settings.monthlySalary === 0)
    || settings.monthlySalary > 1_000_000_000 || !['CNY', 'HKD', 'USD'].includes(settings.currency)
    || !['CN', 'HK'].includes(settings.region) || typeof settings.autoWidget !== 'boolean'
    || !['last-workday', 'fixed-day'].includes(settings.paydayMode)
    || typeof settings.lunchEnabled !== 'boolean' || !Number.isInteger(settings.payday)
    || settings.payday < 1 || settings.payday > 31 || !isRecord(settings.dayOverrides)
    || Object.entries(settings.dayOverrides).some(([key, mode]) => !isValidDateKey(key) || !['work', 'rest'].includes(mode))
    || ['startTime', 'endTime', 'lunchStart', 'lunchEnd'].some(key => typeof settings[key] !== 'string' || !time.test(settings[key]))
    || settings.startTime === settings.endTime) return false;
  if (settings.lunchEnabled) {
    const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    const start = minutes(settings.startTime);
    let end = minutes(settings.endTime);
    if (end <= start) end += 1440;
    let lunchStart = minutes(settings.lunchStart);
    if (lunchStart < start) lunchStart += 1440;
    let lunchEnd = minutes(settings.lunchEnd);
    while (lunchEnd <= lunchStart) lunchEnd += 1440;
    if (lunchEnd > end || lunchEnd - lunchStart >= end - start) return false;
  }
  return true;
}

const isAllowedURL = createEntryPolicy(path.join(root, 'dist', 'index.html'), { developmentURL });
const ownedContents = new Map();

function validateSender(event) {
  if (!isTrustedIpc(event, ownedContents, isAllowedURL)) {
    throw new Error('[WINDOW_NOT_TRUSTED] 当前窗口的页面来源验证未通过。请从托盘退出后重新打开最新版本。');
  }
}

function secureWindow(window, role) {
  const id = window.webContents.id;
  ownedContents.set(id, role);
  window.webContents.once('destroyed', () => ownedContents.delete(id));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedURL(url, role)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
}

function loadWindow(window, widget = false) {
  secureWindow(window, widget ? 'widget' : 'main');
  window.webContents.on('did-finish-load', () => {
    window.webContents.send('niuma:widget-layer-changed', getWidgetLayer());
    window.webContents.send('niuma:widget-appearance-changed', getWidgetAppearance());
  });
  if (developmentURL) {
    return window.loadURL(`${developmentURL.replace(/\/$/, '')}/${widget ? '#/widget' : ''}`);
  }
  return window.loadFile(path.join(root, 'dist', 'index.html'), widget ? { hash: '/widget' } : {});
}

const webPreferences = {
  preload: path.join(root, 'electron', 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  backgroundThrottling: false,
};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 880,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#fff6f1',
    title: '牛马鼓励器 · 薪动',
    icon: appIcon,
    webPreferences,
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('minimize', () => {
    // Explicit minimization is a user request for the compact view, even on a rest day.
    if (widgetSession.visibleMode !== 'manual' || !widgetWindow?.isVisible()) {
      void showWidget(false, 'manual').catch(() => {});
    }
  });
  mainWindow.on('restore', () => hideWidget());
  mainWindow.on('maximize', () => notifyWindowState());
  mainWindow.on('unmaximize', () => notifyWindowState());
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      mainWindow.hide();
      tickSchedule();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    if (!quitting && !tray) app.quit();
  });
  void loadWindow(mainWindow).catch((error) => {
    console.error('Unable to load main window:', error.message);
    app.quit();
  });
}

function fitWidgetPresentation(saved, appearance = getWidgetAppearance()) {
  const anchor = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
    ? { x: Math.round(saved.x), y: Math.round(saved.y) } : undefined;
  // At a monitor boundary choose the display covering most of the window.
  const display = anchor ? screen.getDisplayMatching({
    x: anchor.x, y: Math.round(anchor.y - widgetLayout.laneHeight * appearance.scale),
    width: Math.ceil(widgetLayout.width * appearance.scale), height: Math.ceil(fullWidgetHeight * appearance.scale),
  }) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return {
    bounds: widgetBoundsInWorkArea(display.workArea, anchor, appearance.scale),
    scale: widgetScaleInWorkArea(display.workArea, appearance.scale),
  };
}

// Persist the card's top-left corner, the same anchor used before the pet was added.
function widgetCardPosition() {
  const { x, y, height } = widgetWindow.getBounds();
  const scale = widgetWindow.webContents.getZoomFactor();
  return { x, y: y + petLaneHeight(height / scale) * scale };
}

function stopWidgetPointerTracking() {
  clearInterval(lanePointerTimer);
  lanePointerTimer = undefined;
  desktopPet.end();
  lastPetPointer = null;
  if (widgetPet) widgetPet.chasing = false;
  if (widgetPassesClicks && widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.setIgnoreMouseEvents(false);
  widgetPassesClicks = false;
}

function hitsWidgetPet(x, y) {
  if (!widgetPet?.width || !widgetPet.height) return false;
  const u = (x - widgetPet.left) / widgetPet.width;
  const v = (y - widgetPet.top) / widgetPet.height;
  // Match the dog button's 40% corner radius so its transparent corners stay click-through.
  const radius = .4;
  const dx = Math.max(radius - u, 0, u - (1 - radius));
  const dy = Math.max(radius - v, 0, v - (1 - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function syncWidgetMouseRegion() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  const cursor = screen.getCursorScreenPoint();
  desktopPet.tick(cursor);
  const { x, y, width, height } = widgetWindow.getBounds();
  // Electron screen and window geometry are DIP; renderer rectangles are CSS pixels.
  const zoom = widgetWindow.webContents.getZoomFactor();
  const localX = (cursor.x - x) / zoom;
  const localY = (cursor.y - y) / zoom;
  const overLane = localX >= 0 && localX < width / zoom && localY >= 0 && localY < petLaneHeight(height / zoom);
  const roaming = desktopPet.state.phase !== 'docked';
  const passClicks = overLane && (roaming || !hitsWidgetPet(localX, localY));
  if (passClicks !== widgetPassesClicks) {
    widgetWindow.setIgnoreMouseEvents(passClicks);
    widgetPassesClicks = passClicks;
  }
  if (!roaming && widgetPet?.chasing && (localX !== lastPetPointer?.x || localY !== lastPetPointer?.y)) {
    lastPetPointer = { x: localX, y: localY };
    widgetWindow.webContents.send('niuma:widget-pointer', lastPetPointer);
  }
}

function startWidgetPointerTracking() {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  syncWidgetMouseRegion();
  if (!lanePointerTimer) desktopPet.prewarm();
  // Native drag regions swallow DOM enter/leave events. Sample the OS cursor
  // only while visible and change the native hit test only on a lane crossing.
  lanePointerTimer ??= setInterval(syncWidgetMouseRegion, 24);
}

function refitWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  applyWidgetAppearance(getWidgetAppearance(), widgetCardPosition());
  if (widgetWindow.isVisible()) syncWidgetMouseRegion();
}

function getWidgetAppearance() {
  return normalizeWidgetAppearance(desktopState.widgetAppearance);
}

function applyWidgetAppearance(appearance, anchor) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const presentation = fitWidgetPresentation(anchor, appearance);
  // Main and widget share an origin. Only this WebContents may change scale.
  widgetWindow.webContents.setZoomMode('isolated');
  widgetWindow.webContents.setZoomFactor(presentation.scale);
  widgetWindow.setBounds(presentation.bounds);
}

function setWidgetAppearance(value) {
  if (!validateWidgetAppearance(value)) throw new Error('[SETTINGS_INVALID] 浮窗外观设置无效。');
  const next = normalizeWidgetAppearance(value);
  const window = widgetWindow && !widgetWindow.isDestroyed() ? widgetWindow : null;
  const previousBounds = window?.getBounds();
  const previousScale = window?.webContents.getZoomFactor();
  const anchor = window ? widgetCardPosition() : desktopState.widgetPosition;
  try {
    applyWidgetAppearance(next, anchor);
    const nextDesktopState = { ...desktopState, widgetAppearance: next,
      ...(window ? { widgetPosition: widgetCardPosition() } : {}) };
    writeJSON(desktopPath(), nextDesktopState);
    desktopState = nextDesktopState;
  } catch (error) {
    // No acknowledgement or broadcast is allowed until the atomic write succeeds.
    if (window && !window.isDestroyed()) {
      try {
        window.webContents.setZoomFactor(previousScale);
        window.setBounds(previousBounds);
        if (window.isVisible()) syncWidgetMouseRegion();
      } catch (restoreError) { console.warn('Unable to restore widget appearance:', restoreError.message); }
    }
    if (error.code === 'ENOSPC') throw new Error('[SAVE_SPACE] 磁盘空间不足，浮窗设置未保存。');
    if (['EPERM', 'EACCES', 'EBUSY', 'EROFS', 'EISDIR'].includes(error.code)) {
      throw new Error('[SAVE_PERMISSION] 无法写入本机应用数据目录，浮窗设置未保存。');
    }
    throw new Error('[SAVE_FAILED] 浮窗设置未保存，请重试。');
  }
  if (window?.isVisible()) syncWidgetMouseRegion();
  for (const target of [mainWindow, widgetWindow]) {
    if (target && !target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send('niuma:widget-appearance-changed', next);
    }
  }
  return next;
}

function saveWidgetPosition() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  if (lanePointerTimer) desktopPet.prewarm();
  desktopState.widgetPosition = widgetCardPosition();
  try { writeJSON(desktopPath(), desktopState); } catch (error) {
    console.warn('Unable to save widget position:', error.message);
  }
}

function getWidgetLayer() {
  return desktopState.widgetLayer === 'bottom' ? 'bottom' : 'top';
}

function applyWidgetLayer(layer) {
  if (process.platform === 'win32') {
    setWindowsWidgetLayer(widgetWindow, layer);
  } else if (layer === 'top') {
    widgetWindow.setAlwaysOnTop(true, 'floating');
  } else if (process.platform === 'darwin') {
    // On macOS false always resets to level 0. The relative offset needs the true form.
    widgetWindow.setAlwaysOnTop(true, 'normal', -1);
  } else {
    widgetWindow.setAlwaysOnTop(false);
  }
}

function setWidgetLayer(layer) {
  if (layer !== 'top' && layer !== 'bottom') throw new Error('未知的浮窗层级');
  if (layer === getWidgetLayer()) return layer;
  if (widgetWindow && !widgetWindow.isDestroyed()) applyWidgetLayer(layer);
  desktopState.widgetLayer = layer;
  try { writeJSON(desktopPath(), desktopState); } catch (error) {
    console.warn('Unable to save widget layer:', error.message);
  }
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('niuma:widget-layer-changed', layer);
  }
  return layer;
}

function bringWidgetToTop() {
  setWidgetLayer('top');
  return showWidget().catch(() => {});
}

async function createWidget() {
  const presentation = fitWidgetPresentation(desktopState.widgetPosition);
  widgetWindow = new BrowserWindow({
    ...presentation.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    roundedCorners: false,
    ...(process.platform === 'win32' ? { thickFrame: false, backgroundMaterial: 'none' } : {}),
    // A Cocoa panel joins all Spaces, including full-screen apps, without hiding the app's Dock icon.
    ...(process.platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true } : {}),
    show: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    title: '薪动 · 工资浮窗',
    icon: appIcon,
    webPreferences: { ...webPreferences, backgroundThrottling: true },
  });
  widgetWindow.webContents.setZoomMode('isolated');
  widgetWindow.webContents.setZoomFactor(presentation.scale);
  try {
    applyWidgetLayer(getWidgetLayer());
  } catch (error) {
    console.warn('Unable to restore saved widget layer:', error.message);
    setWidgetLayer('top');
  }
  widgetWindow.on('move', () => {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(saveWidgetPosition, 300);
  });
  widgetWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      hideWidget();
    }
  });
  // AppKit also emits hide when another app merely covers the salary card.
  widgetWindow.on('hide', () => {
    if (process.platform !== 'darwin' || app.isHidden()) stopWidgetPointerTracking();
  });
  widgetWindow.on('show', () => {
    if (widgetShown && !lanePointerTimer) startWidgetPointerTracking();
  });
  widgetWindow.webContents.on('did-start-loading', () => { desktopPet.end(); widgetPet = null; lastPetPointer = null; });
  widgetWindow.on('closed', () => { widgetShown = false; widgetWindow = undefined; widgetPet = null; stopWidgetPointerTracking(); });
  const createdWindow = widgetWindow;
  try {
    await loadWindow(createdWindow, true);
    applyWidgetAppearance(getWidgetAppearance(), desktopState.widgetPosition);
    return createdWindow;
  } catch (error) {
    // A failed first load must not leave a blank window cached forever.
    if (!createdWindow.isDestroyed()) createdWindow.destroy();
    throw error;
  }
}

let creatingWidget;
async function showWidget(minimizeMain = true, mode = 'manual') {
  const request = ++widgetRequest;
  if (mode === 'manual') widgetSession = markManualWidget(appState, new Date(), widgetSession);
  try {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      creatingWidget ??= createWidget().finally(() => { creatingWidget = undefined; });
      await creatingWidget;
    } else if (creatingWidget) {
      await creatingWidget;
    }
    if (quitting || request !== widgetRequest) return;
    if (mode === 'auto') {
      const active = getActiveShift(appState?.settings, new Date(), appState?.calendar);
      if (!appState?.configured || !appState?.settings?.autoWidget || active?.key !== widgetSession.visibleKey
        || (mainWindow?.isVisible() && !mainWindow.isMinimized())) {
        widgetSession = { ...widgetSession, visibleMode: null, visibleKey: null };
        return;
      }
    }
    refitWidget();
    widgetShown = true;
    widgetWindow.showInactive();
    startWidgetPointerTracking();
    if (minimizeMain && mainWindow && !mainWindow.isMinimized()) mainWindow.minimize();
  } catch (error) {
    if (request !== widgetRequest || quitting) return;
    widgetSession = { ...widgetSession, visibleMode: null, visibleKey: null };
    console.error('Unable to open widget:', error.message);
    restoreMain();
    throw error;
  }
}

function restoreMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  hideWidget(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function dismissNativeWidget() {
  widgetShown = false;
  stopWidgetPointerTracking();
  widgetWindow?.hide();
}

function hideWidget(restoreWithoutTray = true) {
  widgetRequest++;
  widgetSession = dismissWidget(appState, new Date(), widgetSession);
  dismissNativeWidget();
  // Without a tray, hiding the only visible window must not strand the application.
  if (restoreWithoutTray && !tray && mainWindow?.isMinimized()) restoreMain();
}

function broadcastState() {
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('niuma:state-changed', appState);
  }
}

function publishCalendarStatus(value) {
  calendarStatus = { ...value, calendar: appState?.calendar ?? {} };
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('niuma:calendar-status', calendarStatus);
  }
  return calendarStatus;
}

async function refreshCalendar(force = false) {
  const region = appState?.settings?.region === 'HK' ? 'HK' : 'CN';
  if (calendarJobs.has(region)) return calendarJobs.get(region);
  const year = new Date().getFullYear();
  const now = Date.now();
  const cache = normalizeCalendarCache(appState?.calendar);
  const years = [year, year - 1, year + 1];
  const needed = years.filter(value => {
    const key = `${region}-${value}`;
    const fetched = Date.parse(cache[key]?.fetchedAt ?? '');
    const fresh = Number.isFinite(fetched) && fetched <= now && now - fetched < CALENDAR_TTL;
    return force || (!fresh && now - (calendarAttempts.get(key) ?? 0) > RETRY_DELAY);
  });
  if (!needed.length) {
    const current = cache[`${region}-${year}`];
    const result = current
      ? { status: 'cached', message: `正在使用 ${year} 年已缓存的节假日日历` }
      : { status: 'unavailable', message: `${year} 年日历暂不可用，暂按周一至周五；可手动切换今天上班或休息` };
    if (calendarStatus.status !== result.status || calendarStatus.message !== result.message) publishCalendarStatus(result);
    return { ...result, calendar: appState?.calendar ?? {} };
  }
  publishCalendarStatus({ status: 'loading', message: '正在更新节假日日历…' });
  const job = (async () => {
    const outcomes = await Promise.allSettled(needed.map(async value => {
      calendarAttempts.set(`${region}-${value}`, Date.now());
      const data = await fetchCalendarYear(region, value, (url, options = {}) => fetch(url, {
        ...options, signal: AbortSignal.timeout(12_000),
      }), cache[`${region}-${value}`]);
      return { key: `${region}-${value}`, data };
    }));
    if (quitting) return { status: 'cached', message: '应用正在退出', calendar: appState?.calendar ?? {} };
    const updates = Object.fromEntries(outcomes.filter(result => result.status === 'fulfilled').map(result => [result.value.key, result.value.data]));
    let saved = true;
    if (Object.keys(updates).length && !quitting) {
      // Read latest state after the network await so edits made while fetching survive.
      const next = { ...(appState ?? { version: 3, configured: false }), calendar: { ...normalizeCalendarCache(appState?.calendar), ...updates } };
      try { writeJSON(statePath(), next); appState = next; broadcastState(); }
      catch (error) { saved = false; console.warn('Unable to cache holiday calendar:', error.message); }
    }
    const current = appState?.calendar?.[`${region}-${year}`];
    const currentUpdated = saved && Boolean(updates[`${region}-${year}`]);
    const result = {
      status: currentUpdated ? 'updated' : current ? 'cached' : 'unavailable',
      message: currentUpdated ? `${year} 年节假日日历已更新`
        : current ? '更新暂不可用，继续使用已缓存的节假日日历'
          : `${year} 年日历暂不可用，暂按周一至周五；可手动切换今天上班或休息`,
      calendar: appState?.calendar ?? {},
    };
    if ((appState?.settings?.region === 'HK' ? 'HK' : 'CN') === region) publishCalendarStatus(result);
    tickSchedule();
    return result;
  })().finally(() => calendarJobs.delete(region));
  calendarJobs.set(region, job);
  return job;
}

function tickSchedule() {
  if (quitting || !app.isReady()) return;
  try {
    const mainVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
    const result = decideWidget(appState, new Date(), widgetSession, mainVisible);
    widgetSession = result.session;
    if (result.action === 'show') void showWidget(false, 'auto').catch(() => {});
    if (result.action === 'hide') { widgetRequest++; dismissNativeWidget(); }
  } catch (error) { console.warn('Unable to check work schedule:', error.message); }
}

function backgroundTick() {
  tickSchedule();
  void refreshCalendar().catch(error => console.warn('Unable to refresh holiday calendar:', error.message));
}

function notifyWindowState() {
  mainWindow?.webContents.send('niuma:window-state', { maximized: mainWindow.isMaximized() });
}

function refreshTrayMenu() {
  if (!tray || quitting) return;
  const recall = desktopPet.state.phase === 'chasing' ? [{
    label: '收起骨头', click: () => { void desktopPet.setMode(false); },
  }] : [];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开牛马鼓励器', click: restoreMain },
    { label: '显示工资浮窗', click: () => { void showWidget().catch(() => {}); } },
    { label: '将浮窗置顶', click: bringWidgetToTop },
    ...recall,
    { label: '隐藏工资浮窗', click: () => hideWidget() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

function createTray() {
  try {
    const iconPath = path.join(root, 'build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('Tray icon could not be loaded.');
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip('薪动 · 每一秒，都算数');
    refreshTrayMenu();
    // On macOS a status item emits click before it opens its menu.
    if (process.platform !== 'darwin') {
      tray.on('click', restoreMain);
      tray.on('double-click', restoreMain);
    }
  } catch (error) {
    tray = undefined;
    console.warn('Tray is not available:', error.message);
  }
}

function saveProfile(next) {
  try { writeJSON(statePath(), next); } catch (error) {
    if (['EPERM', 'EACCES', 'EBUSY', 'EROFS'].includes(error.code)) throw new Error('[SAVE_PERMISSION] 无法写入本机应用数据目录，请检查目录权限或关闭占用文件的程序。');
    if (error.code === 'ENOSPC') throw new Error('[SAVE_SPACE] 磁盘空间不足，请腾出空间后再试。');
    throw new Error('[SAVE_FAILED] 无法保存设置，请检查本机磁盘后重试。');
  }
  appState = next;
  broadcastState();
}

function installIPC() {
  ipcMain.on('niuma:set-widget-pet', (event, state) => {
    if (!widgetWindow || event.sender?.id !== widgetWindow.webContents.id || !isTrustedIpc(event, ownedContents, isAllowedURL)) return;
    if (!isRecord(state) || typeof state.chasing !== 'boolean') return;
    const { left, top, width, height } = state;
    if (![left, top, width, height].every(Number.isFinite) || width < 0 || height < 0
      || width > widgetLayout.width || height > fullWidgetHeight) return;
    const chasing = state.chasing && widgetWindow.isVisible();
    const startedChasing = chasing && !widgetPet?.chasing;
    widgetPet = { left, top, width, height, chasing, facing: state.facing === -1 ? -1 : 1,
      launchPose: normalizePetLaunchPose(state.launchPose) };
    if (startedChasing) {
      lastPetPointer = null;
      syncWidgetMouseRegion();
    }
  });
  const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
    validateSender(event);
    return callback(...args);
  });
  const widgetOnly = callback => (event, ...args) => {
    validateSender(event);
    if (event.sender?.id !== widgetWindow?.webContents.id) throw new Error('[WINDOW_NOT_TRUSTED] 此操作仅限工资浮窗。');
    return callback(...args);
  };
  ipcMain.handle('niuma:get-desktop-pet-state', widgetOnly(() => desktopPet.state));
  ipcMain.handle('niuma:desktop-pet-mode', widgetOnly(value => {
    if (!isRecord(value) || typeof value.active !== 'boolean' || typeof value.reducedMotion !== 'boolean') {
      throw new Error('无效的骨头开关。');
    }
    return desktopPet.setMode(value.active, value.reducedMotion);
  }));
  handle('niuma:get-state', () => appState);
  handle('niuma:set-privacy', hidden => {
    if (typeof hidden !== 'boolean') throw new Error('[SETTINGS_INVALID] 金额显隐设置无效。');
    saveProfile({ version: 3, configured: false, ...appState, privacy: hidden });
    return appState.privacy;
  });
  handle('niuma:get-widget-layer', getWidgetLayer);
  handle('niuma:set-widget-layer', setWidgetLayer);
  handle('niuma:get-widget-appearance', getWidgetAppearance);
  handle('niuma:set-widget-appearance', setWidgetAppearance);
  handle('niuma:set-state', (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Settings must be an object.');
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > 1024 * 1024) throw new Error('Settings are too large.');
    const next = JSON.parse(serialized);
    if (!validState(next)) throw new Error('[SETTINGS_INVALID] 设置无效，请检查月薪、发薪日、上下班时间和午休安排。');
    // Calendar data is authoritative in the main process. A stale renderer must not replace it.
    next.calendar = normalizeCalendarCache(appState?.calendar);
    saveProfile(next);
    backgroundTick();
    return appState;
  });
  handle('niuma:show-widget', async () => {
    try { await showWidget(); } catch { throw new Error('[WIDGET_FAILED] 无法创建浮窗，请从托盘退出后重新打开应用。'); }
  });
  handle('niuma:hide-widget', () => hideWidget());
  handle('niuma:restore-main', restoreMain);
  handle('niuma:minimize', () => mainWindow?.minimize());
  handle('niuma:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  handle('niuma:close', () => mainWindow?.close());
  handle('niuma:quit', () => app.quit());
  handle('niuma:refresh-calendar', () => refreshCalendar(true));
  handle('niuma:get-calendar-status', () => ({ ...calendarStatus, calendar: appState?.calendar ?? {} }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (app.isReady()) restoreMain(); });
  app.on('before-quit', () => {
    quitting = true;
    clearImmediate(trayMenuUpdate);
    clearTimeout(positionTimer);
    stopWidgetPointerTracking();
    clearInterval(scheduleTimer);
    widgetRequest++;
    saveWidgetPosition();
  });
  app.on('will-quit', () => tray?.destroy());
  app.on('window-all-closed', () => { if (!quitting && !tray) app.quit(); });
  app.on('activate', () => { if (app.isReady()) restoreMain(); });
  void app.whenReady().then(() => {
    app.setName('牛马鼓励器');
    if (process.platform === 'win32') app.setAppUserModelId('studio.niuma.payday');
    appState = migrateLegacyProfile(readJSON(statePath(), null));
    if (appState) {
      const calendar = normalizeCalendarCache(appState.calendar);
      // Preserve legacy preferences before validation, without scheduling before monthly confirmation.
      appState = validState(appState) ? { ...appState, calendar }
        : { version: 3, configured: false, calendar };
    }
    desktopState = readJSON(desktopPath(), {});
    installIPC();
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
        { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: '将浮窗置顶', click: bringWidgetToTop }, { label: '返回主窗口', click: restoreMain }] },
      ]));
    } else Menu.setApplicationMenu(null);
    createMainWindow();
    createTray();
    scheduleTimer = setInterval(backgroundTick, 15_000);
    powerMonitor.on('resume', backgroundTick);
    powerMonitor.on('unlock-screen', backgroundTick);
    powerMonitor.on('lock-screen', () => desktopPet.end());
    powerMonitor.on('suspend', () => desktopPet.end());
    void refreshCalendar().catch(error => console.warn('Unable to load holiday calendar:', error.message));
    screen.on('display-removed', refitWidget);
    screen.on('display-metrics-changed', refitWidget);
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
      screen.on(event, () => desktopPet.displaysChanged());
    }
  });
}
