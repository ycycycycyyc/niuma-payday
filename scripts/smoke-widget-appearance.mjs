import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import { DEFAULT_WIDGET_APPEARANCE } from '../shared/widget-appearance.mjs';
import { petLaneHeight, widgetBoundsInWorkArea, widgetScaleInWorkArea } from '../shared/widget-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'artifacts', 'widget-appearance-native');
const userData = path.join(process.env.NIUMA_SMOKE_DATA_ROOT || output, `appearance-test-${Date.now()}`);
const executablePath = process.env.NIUMA_SMOKE_EXECUTABLE && path.resolve(process.env.NIUMA_SMOKE_EXECUTABLE);
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
let desktop;
const passed = [];
const record = message => { passed.push(message); console.log(`PASS ${message}`); };
const snapshot = () => desktop.evaluate(({ BrowserWindow, screen }) => {
  const widget = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
  const main = BrowserWindow.getAllWindows().find(win => win !== widget && !win.webContents.getURL().endsWith('/pet.html'));
  return {
    bounds: widget.getBounds(), scale: widget.webContents.getZoomFactor(), mode: widget.webContents.getZoomMode(),
    mainScale: main.webContents.getZoomFactor(), area: screen.getDisplayMatching(widget.getBounds()).workArea,
  };
});
async function launch() {
  desktop = await electron.launch({ executablePath,
    args: [...(executablePath ? [] : [root]), `--user-data-dir=${userData}`],
    cwd: root, env: environment, timeout: 30_000 });
  const main = await desktop.firstWindow();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  return main;
}
async function openWidget(main) {
  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(() => desktop.windows().some(page => page.url().endsWith('#/widget'))).toBe(true);
  const widget = desktop.windows().find(page => page.url().endsWith('#/widget'));
  await expect(widget.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
  return widget;
}

try {
  const main = await launch();
  assert.deepEqual(await main.evaluate(() => window.niuma.getWidgetAppearance()), DEFAULT_WIDGET_APPEARANCE);
  const widget = await openWidget(main);
  for (const page of [main, widget]) await page.evaluate(() => {
    window.__appearanceEvents = [];
    window.niuma.onWidgetAppearanceChanged(value => window.__appearanceEvents.push(value));
  });
  const before = await snapshot();
  const anchor = { x: before.bounds.x, y: before.bounds.y + petLaneHeight(before.bounds.height / before.scale) * before.scale };
  const chosen = { scale: 1.5, tint: '#d9d0f5', opacity: .72 };
  assert.deepEqual(await widget.evaluate(value => window.niuma.setWidgetAppearance(value), chosen), chosen);
  const scaled = await snapshot();
  assert.deepEqual(scaled.bounds, widgetBoundsInWorkArea(scaled.area, anchor, chosen.scale));
  assert.equal(scaled.scale, widgetScaleInWorkArea(scaled.area, chosen.scale));
  assert.equal(scaled.mode, 'isolated');
  assert.equal(scaled.mainScale, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'desktop.json'), 'utf8')).widgetAppearance, chosen);
  for (const page of [main, widget]) {
    await expect.poll(() => page.evaluate(() => window.__appearanceEvents)).toEqual([chosen]);
    assert.deepEqual(await page.evaluate(() => window.niuma.getWidgetAppearance()), chosen);
  }
  record('native size, isolated widget zoom, unchanged main zoom, saved receipt and two-window broadcast');

  const rejected = await widget.evaluate(async chosen => {
    try { await window.niuma.setWidgetAppearance({ ...chosen, scale: 2 }); return 'accepted'; }
    catch (error) { return error.message; }
  }, chosen);
  assert.match(rejected, /SETTINGS_INVALID/);
  assert.deepEqual(await snapshot(), scaled);
  record('out-of-range IPC rejected without native or persisted changes');

  // Finish any move-position debounce before blocking only this isolated profile's temporary file.
  await expect.poll(() => fs.existsSync(path.join(userData, 'desktop.json.tmp'))).toBe(false);
  await new Promise(resolve => setTimeout(resolve, 400));
  const savedBytes = fs.readFileSync(path.join(userData, 'desktop.json'));
  const blockedTemporary = path.join(userData, 'desktop.json.tmp');
  fs.mkdirSync(blockedTemporary);
  try {
    const failure = await widget.evaluate(async () => {
      try { await window.niuma.setWidgetAppearance({ scale: .85, tint: '#ffccee', opacity: .9 }); return 'accepted'; }
      catch (error) { return error.message; }
    });
    assert.match(failure, /SAVE_/);
    assert.deepEqual(await snapshot(), scaled);
    assert.deepEqual(await widget.evaluate(() => window.niuma.getWidgetAppearance()), chosen);
    assert.deepEqual(fs.readFileSync(path.join(userData, 'desktop.json')), savedBytes);
    for (const page of [main, widget]) assert.deepEqual(await page.evaluate(() => window.__appearanceEvents), [chosen]);
  } finally { fs.rmdirSync(blockedTemporary); }
  record('failed atomic write rolls native geometry back and emits no false save receipt or broadcast');

  // Fixture only this Electron process's screen query; never move the system pointer.
  const originalMatching = await desktop.evaluateHandle(({ screen }) => screen.getDisplayMatching);
  try {
    const smallArea = { ...scaled.area, width: 320, height: 190 };
    await desktop.evaluate(({ screen }, workArea) => {
      const actual = screen.getPrimaryDisplay();
      screen.getDisplayMatching = () => ({ ...actual, workArea });
    }, smallArea);
    await widget.evaluate(value => window.niuma.setWidgetAppearance(value), chosen);
    const fitted = await snapshot();
    assert.equal(fitted.scale, widgetScaleInWorkArea(smallArea, chosen.scale));
    assert.equal(fitted.bounds.width, 320);
    assert.equal(fitted.bounds.height, 190);
    assert.ok(fitted.bounds.x >= smallArea.x && fitted.bounds.x + fitted.bounds.width <= smallArea.x + smallArea.width);
    assert.ok(fitted.bounds.y >= smallArea.y && fitted.bounds.y + fitted.bounds.height <= smallArea.y + smallArea.height);
    assert.ok(fitted.bounds.height / fitted.scale >= 200);
    assert.deepEqual(await widget.evaluate(() => window.niuma.getWidgetAppearance()), chosen);
  } finally {
    await desktop.evaluate(({ screen }, original) => { screen.getDisplayMatching = original; }, originalMatching);
    await originalMatching.dispose();
    await widget.evaluate(value => window.niuma.setWidgetAppearance(value), chosen);
  }
  record('small work area contains all card controls while keeping the preferred scale for larger screens');

  if (process.platform === 'win32' || process.platform === 'darwin') {
    const originalCursor = await desktop.evaluateHandle(({ screen }) => screen.getCursorScreenPoint);
    const originalIgnore = await desktop.evaluateHandle(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget')).setIgnoreMouseEvents);
    try {
      await desktop.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
        const original = win.setIgnoreMouseEvents;
        win.setIgnoreMouseEvents = function(pass, ...rest) { this.__qaPass = pass; return original.call(this, pass, ...rest); };
        const { x, y } = win.getBounds();
        const scale = win.webContents.getZoomFactor();
        screen.getCursorScreenPoint = () => ({ x: x + 2 * scale, y: y + 4 * scale });
      });
      const passState = () => desktop.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget')).__qaPass);
      await expect.poll(passState).toBe(true);
      const dog = await widget.getByRole('button', { name: '和狗狗握手' }).boundingBox();
      assert.ok(dog);
      await desktop.evaluate(({ BrowserWindow, screen }, dog) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
        const { x, y } = win.getBounds();
        const scale = win.webContents.getZoomFactor();
        screen.getCursorScreenPoint = () => ({ x: x + (dog.x + dog.width / 2) * scale, y: y + (dog.y + dog.height / 2) * scale });
      }, dog);
      await expect.poll(passState).toBe(false);
    } finally {
      await desktop.evaluate(({ BrowserWindow, screen }, { cursor, ignore }) => {
        screen.getCursorScreenPoint = cursor;
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
        win.setIgnoreMouseEvents = ignore;
      }, { cursor: originalCursor, ignore: originalIgnore });
      await originalCursor.dispose();
      await originalIgnore.dispose();
    }
    record('scaled empty lane passes clicks and scaled dog footprint remains interactive using an isolated cursor fixture');
  }

  await desktop.close();
  desktop = undefined;
  const reopenedMain = await launch();
  assert.deepEqual(await reopenedMain.evaluate(() => window.niuma.getWidgetAppearance()), chosen);
  await openWidget(reopenedMain);
  const restored = await snapshot();
  assert.equal(restored.scale, widgetScaleInWorkArea(restored.area, chosen.scale));
  assert.equal(restored.mainScale, 1);
  record('fresh app and widget restore independently saved appearance without changing main-window scale');
} finally {
  if (desktop) await desktop.close();
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
    platform: process.platform, executablePath: executablePath || null, passed, userData,
  }, null, 2));
}
