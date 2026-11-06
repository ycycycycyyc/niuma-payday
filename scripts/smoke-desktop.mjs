import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import widgetLayout from '../shared/widget-layout.json' with { type: 'json' };
import { macClick, verifyMacWidget } from './smoke-macos-widget.mjs';
import { verifyWindowsWidget } from './smoke-windows-widget.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const userData = path.join(process.env.NIUMA_SMOKE_DATA_ROOT || artifacts, `desktop-test-${Date.now()}`);
const executablePath = process.env.NIUMA_SMOKE_EXECUTABLE && path.resolve(process.env.NIUMA_SMOKE_EXECUTABLE);
fs.mkdirSync(artifacts, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
let desktop;
let main;
const failures = [];
const passed = [];
const record = name => { passed.push(name); console.log(`PASS ${name}`); };
const windowsNative = process.platform === 'win32' && process.env.NIUMA_WINDOWS_NATIVE_INPUT === '1';
const windowsBaseline = process.env.NIUMA_WINDOWS_BASELINE === '1';
let native;
const windows = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
  id: window.id, url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(),
  alwaysOnTop: window.isAlwaysOnTop(), bounds: window.getBounds(), destroyed: window.isDestroyed(),
})));

async function verifyDesktop() {
  if (windowsBaseline) assert.ok(windowsNative, 'Baseline comparisons require real Windows system input');
  desktop = await electron.launch({
    executablePath,
    args: [...(executablePath ? [] : [root]), `--user-data-dir=${userData}`],
    cwd: root, env: environment, timeout: 30_000,
  });
  const child = desktop.process();
  child.stderr?.on('data', data => {
    const line = data.toString();
    if (/Uncaught|UnhandledPromiseRejection|Unable to load main window/.test(line)) failures.push(line);
  });
  main = await desktop.firstWindow();
  main.on('pageerror', error => failures.push(error.message));
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  const paths = await desktop.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
  assert.equal(fs.realpathSync.native(paths.userData), fs.realpathSync.native(userData));
  assert.equal(fs.realpathSync.native(paths.sessionData), fs.realpathSync.native(userData));
  record('isolated userData/sessionData and native main window');

  await main.getByRole('button', { name: '设置我的日薪', exact: true }).click();
  await main.getByLabel('日薪', { exact: true }).fill('680');
  await main.getByLabel('上班时间', { exact: true }).fill('09:00');
  await main.getByLabel('下班时间', { exact: true }).fill('18:00');
  await main.getByRole('button', { name: '保存并开始计薪', exact: true }).click();
  await expect(main.getByRole('dialog')).toHaveCount(0);
  const saved = await main.evaluate(() => window.niuma.getState());
  assert.equal(saved.version, 2);
  assert.equal(saved.configured, true);
  assert.equal(saved.settings.dailySalary, 680);
  assert.equal(saved.settings.startTime, '09:00');
  assert.equal(saved.settings.endTime, '18:00');
  const invalid = await main.evaluate(async () => {
    const state = await window.niuma.getState();
    try { await window.niuma.setState({ ...state, settings: { ...state.settings, dailySalary: -1 } }); return 'accepted'; }
    catch (error) { return error.message; }
  });
  assert.match(invalid, /\[SETTINGS_INVALID\]/);
  assert.equal((await main.evaluate(() => window.niuma.getState())).settings.dailySalary, 680);
  record('daily salary form saves through authorized IPC; invalid settings rejected');

  const appRoot = await desktop.evaluate(({ app }) => app.getAppPath());
  const unauthorized = await desktop.evaluate(async ({ BrowserWindow }, preload) => {
    const rogue = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await rogue.loadURL('about:blank');
      return await rogue.webContents.executeJavaScript('window.niuma.setState({version:2,configured:false}).then(() => "accepted", error => error.message)');
    } finally { rogue.destroy(); }
  }, path.join(appRoot, 'electron', 'preload.cjs'));
  assert.match(unauthorized, /\[WINDOW_NOT_TRUSTED\]/);
  record('unowned about:blank window cannot invoke protected state IPC');
  await main.screenshot({ path: path.join(artifacts, 'native-main.png'), fullPage: false });

  const newWidget = desktop.waitForEvent('window', { predicate: page => page !== main, timeout: 15_000 });
  await main.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  const widget = await newWidget;
  widget.on('pageerror', error => failures.push(error.message));
  await expect(widget.getByLabel('工资悬浮窗')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(true);
  await expect.poll(async () => (await windows()).find(window => !window.url.endsWith('#/widget'))?.minimized).toBe(true);
  const initialWindows = await windows();
  const widgetState = initialWindows.find(window => window.url.endsWith('#/widget'));
  assert.equal(widgetState.alwaysOnTop, true);
  assert.equal(widgetState.bounds.width, widgetLayout.width);
  assert.equal(widgetState.bounds.height, widgetLayout.laneHeight + widgetLayout.cardHeight);
  const card = await widget.locator('.widget').boundingBox();
  assert.equal(card.y, widgetLayout.laneHeight);
  assert.equal(card.width, widgetLayout.width);
  assert.equal(card.height, widgetLayout.cardHeight);
  if (process.platform === 'darwin') {
    const nativeState = await desktop.evaluate(({ app, BrowserWindow }) => {
      const panel = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
      return {
        allSpaces: panel.isVisibleOnAllWorkspaces(), focusable: panel.isFocusable(),
        fullscreenable: panel.isFullScreenable(), dockVisible: app.dock.isVisible(),
      };
    });
    assert.deepEqual(nativeState, { allSpaces: true, focusable: true, fullscreenable: false, dockVisible: true });
    record('macOS floating panel joins all Spaces, accepts focus and keeps the application in the Dock');
  }
  await widget.screenshot({ path: path.join(artifacts, 'native-widget.png'), fullPage: false });
  record(`manual floating widget is visible, always on top, with a ${widgetLayout.laneHeight} px pet lane and ${card.width}×${card.height} card; main minimized`);

  if (process.platform === 'darwin') {
    await verifyMacWidget(desktop, widget, userData, record);
  } else if (windowsNative) {
    native = await verifyWindowsWidget(desktop, widget, userData, record, windowsBaseline);
    if (windowsBaseline) return;
  } else {
    const dog = widget.getByRole('button', { name: '和狗狗握手', exact: true });
    const dogBox = await dog.boundingBox();
    assert.ok(dogBox);
    await widget.mouse.click(dogBox.x + dogBox.width / 2, dogBox.y + dogBox.height / 2);
    await expect(dog).toHaveAttribute('data-pose', 'paw');
    record('targeted pointer input in the native widget plays the seated handshake');
  }

  if (process.platform === 'win32' && !windowsNative) {
    const originalCursor = await desktop.evaluateHandle(({ screen }) => screen.getCursorScreenPoint);
    try {
      // Only this isolated Electron process reads a fixture coordinate; the OS pointer never moves.
      await desktop.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
        const { x, y } = win.getBounds();
        screen.getCursorScreenPoint = () => ({ x: x + 147, y: y + 112 });
      });
      const [point] = await Promise.all([
        widget.evaluate(() => new Promise((resolve, reject) => {
          const off = window.niuma.onWidgetPointer(value => { clearTimeout(timer); off(); resolve(value); });
          const timer = setTimeout(() => { off(); reject(new Error('No initial native pet pointer received')); }, 4000);
        })),
        widget.getByRole('button', { name: '拿起骨头', exact: true }).click(),
      ]);
      assert.deepEqual(point, { x: 147, y: 112 });
      await expect(widget.locator('.pet-held-bone')).toBeVisible();
      await widget.keyboard.press('Escape');
      await expect(widget.getByRole('button', { name: '拿起骨头', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(widget.locator('.pet-held-bone')).toBeHidden();
      record('native widget receives the first local cursor coordinate for the bone and puts it away on Escape');
    } finally {
      await desktop.evaluate(({ screen }, original) => { screen.getCursorScreenPoint = original; }, originalCursor);
      await originalCursor.dispose();
    }
  }

  const clickWidgetControl = async name => {
    const button = widget.getByRole('button', { name, exact: true });
    if (process.platform === 'darwin') await macClick(desktop, button);
    else if (windowsNative) await native.click(button);
    else await button.click();
  };
  await clickWidgetControl('返回主窗口');
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(false);
  await expect.poll(async () => (await windows()).find(window => !window.url.endsWith('#/widget'))?.minimized).toBe(false);
  await main.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(main.locator('.earnings-card .live-amount')).toHaveAttribute('aria-label', '金额已隐藏');
  await expect(widget.locator('.live-amount')).toHaveAttribute('aria-label', '金额已隐藏');
  assert.equal((await widget.evaluate(() => window.niuma.getState())).privacy, true);
  const disk = JSON.parse(fs.readFileSync(path.join(userData, 'state.json'), 'utf8'));
  assert.equal(disk.privacy, true);
  assert.equal(disk.settings.dailySalary, 680);
  record('restore hides widget; privacy synchronizes to both windows and persists');

  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(true);
  await clickWidgetControl('隐藏浮窗');
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(false);
  if (process.platform === 'darwin') {
    const invoked = await desktop.evaluate(({ Menu }) => {
      const windowMenu = Menu.getApplicationMenu()?.items.find(item => item.label === '窗口');
      const restore = windowMenu?.submenu.items.find(item => item.label === '返回主窗口');
      if (!restore?.enabled || !restore.visible) return false;
      restore.click();
      return true;
    });
    assert.equal(invoked, true);
    await expect.poll(async () => (await windows()).find(win => !win.url.endsWith('#/widget'))?.minimized).toBe(false);
    assert.equal(await desktop.evaluate(({ app }) => app.dock.isVisible()), true);
    record('native macOS Window menu command restores the main window with its Dock icon');
  } else {
    await main.evaluate(() => window.niuma.restoreMain());
  }
  await main.getByRole('button', { name: '收起到托盘', exact: true }).click();
  await expect.poll(async () => (await windows()).find(window => !window.url.endsWith('#/widget'))?.visible).toBe(false);
  assert.equal(child.exitCode, null);
  assert.equal((await main.evaluate(() => window.niuma.getState())).settings.dailySalary, 680);
  record('widget hide works; closing main keeps application running in tray');
  assert.deepEqual(failures, []);
}

try {
  await verifyDesktop();
} catch (error) {
  failures.push(error.stack || error.message || String(error));
  if (main && !main.isClosed()) {
    try { await main.screenshot({ path: path.join(artifacts, 'native-error.png') }); } catch { /* Retain original failure. */ }
  }
  throw error;
} finally {
  if (desktop) {
    const child = desktop.process();
    await desktop.close();
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 8_000 }).toBe(true);
    record('Electron process closed cleanly');
  }
  const filename = windowsBaseline ? 'windows-baseline-result.json' : 'native-smoke-result.json';
  const evidence = { status: failures.length ? 'failed' : windowsBaseline ? 'observed' : 'passed', passed, errors: failures, userData,
    windowsSystemInput: windowsNative, version: native?.version, baselineObservations: windowsBaseline ? native?.observations : undefined };
  fs.writeFileSync(path.join(artifacts, filename), JSON.stringify(evidence, null, 2));
}
