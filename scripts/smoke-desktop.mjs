import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const userData = path.join(process.env.NIUMA_SMOKE_DATA_ROOT || artifacts, `desktop-test-${Date.now()}`);
const executablePath = process.env.NIUMA_SMOKE_EXECUTABLE;
fs.mkdirSync(userData, { recursive: true });
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
let desktop;
let main;
const failures = [];
const passed = [];
const record = name => { passed.push(name); console.log(`PASS ${name}`); };
const windows = () => desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
  id: window.id, url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(),
  alwaysOnTop: window.isAlwaysOnTop(), bounds: window.getBounds(), destroyed: window.isDestroyed(),
})));

try {
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
  assert.equal(path.resolve(paths.userData), userData);
  assert.equal(path.resolve(paths.sessionData), userData);
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

  const unauthorized = await desktop.evaluate(async ({ BrowserWindow }, preload) => {
    const rogue = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await rogue.loadURL('about:blank');
      return await rogue.webContents.executeJavaScript('window.niuma.setState({version:2,configured:false}).then(() => "accepted", error => error.message)');
    } finally { rogue.destroy(); }
  }, path.join(root, 'electron', 'preload.cjs'));
  assert.match(unauthorized, /\[WINDOW_NOT_TRUSTED\]/);
  record('unowned about:blank window cannot invoke protected state IPC');
  await main.screenshot({ path: path.join(artifacts, 'native-main.png'), fullPage: false });

  const newWidget = desktop.waitForEvent('window', { predicate: page => page !== main, timeout: 15_000 });
  await main.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  const widget = await newWidget;
  widget.on('pageerror', error => failures.push(error.message));
  await expect(widget.getByLabel('工资悬浮窗')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(true);
  const initialWindows = await windows();
  const widgetState = initialWindows.find(window => window.url.endsWith('#/widget'));
  assert.equal(widgetState.alwaysOnTop, true);
  assert.equal(widgetState.bounds.width, 350);
  assert.equal(widgetState.bounds.height, 232);
  const card = await widget.locator('.widget').boundingBox();
  assert.equal(card.y, 72);
  assert.equal(card.height, 160);
  assert.equal(initialWindows.find(window => !window.url.endsWith('#/widget'))?.minimized, true);
  await widget.screenshot({ path: path.join(artifacts, 'native-widget.png'), fullPage: false });
  record('manual floating widget is visible, always on top, with a 72 px pet lane and 350×160 card; main minimized');

  await widget.getByRole('button', { name: '返回主窗口', exact: true }).click();
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
  await widget.getByRole('button', { name: '隐藏浮窗', exact: true }).click();
  await expect.poll(async () => (await windows()).find(window => window.url.endsWith('#/widget'))?.visible).toBe(false);
  await main.evaluate(() => window.niuma.restoreMain());
  await main.getByRole('button', { name: '收起到托盘', exact: true }).click();
  await expect.poll(async () => (await windows()).find(window => !window.url.endsWith('#/widget'))?.visible).toBe(false);
  assert.equal(child.exitCode, null);
  assert.equal((await main.evaluate(() => window.niuma.getState())).settings.dailySalary, 680);
  record('widget hide works; closing main keeps application running in tray');
  assert.deepEqual(failures, []);
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
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'Electron process should exit after test cleanup');
    record('Electron process closed cleanly');
  }
  fs.writeFileSync(path.join(artifacts, 'native-smoke-result.json'), JSON.stringify({ status: failures.length ? 'failed' : 'passed', passed, errors: failures, userData }, null, 2));
}
