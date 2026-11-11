import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';

// Uses an isolated profile and synthetic renderer events. It verifies the native
// window lifecycle, but does not prove physical OS mouse hit testing.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const userData = path.join(process.env.NIUMA_SMOKE_DATA_ROOT || artifacts, `companion-test-${Date.now()}`);
const executablePath = process.env.NIUMA_SMOKE_EXECUTABLE && path.resolve(process.env.NIUMA_SMOKE_EXECUTABLE);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(artifacts, { recursive: true });

const passed = [];
const failures = [];
const observations = {};
const record = text => { passed.push(text); console.log(`PASS ${text}`); };
let desktop;
let widget;
let main;

async function windows() {
  return desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({
    id: win.id, url: win.webContents.getURL(), visible: win.isVisible(),
    minimized: win.isMinimized(), bounds: win.getContentBounds(),
  })));
}

const widgetWindow = async () => (await windows()).find(win => win.url.endsWith('#/widget'));
const phase = async () => widget.evaluate(async () => (await window.niuma.getDesktopPetState()).phase);
const isPetPage = page => /\/pet\.html(?:[?#]|$)/.test(page.url());
const preferences = value => ({
  settings: value?.settings, goal: value?.goal, privacy: value?.privacy, configured: value?.configured ?? false,
});

async function paintedDogs() {
  const dogs = [];
  for (const page of desktop.windows()) {
    const selector = isPetPage(page) ? '#desktop-dog' : page.url().endsWith('#/widget') ? '.widget-dog' : null;
    if (!selector || page.isClosed()) continue;
    const handle = await desktop.browserWindow(page);
    let zoom;
    try {
      zoom = await handle.evaluate(win => win.isVisible() && !win.isMinimized() ? win.webContents.getZoomFactor() : 0);
    } finally { await handle.dispose(); }
    if (!zoom) continue;
    const dog = await page.evaluate(({ selector, zoom }) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden || !element.getClientRects().length) return null;
      const rect = element.getBoundingClientRect();
      return { x: window.screenX + (rect.x + rect.width / 2) * zoom, y: window.screenY + (rect.y + rect.height / 2) * zoom,
        size: rect.width * zoom, pose: element.dataset.pose, frame: element.dataset.frame, interactive: element.dataset.interactive };
    }, { selector, zoom }).catch(error => { if (!page.isClosed()) throw error; return null; });
    if (dog) dogs.push({ ...dog, zoom, page });
  }
  return dogs;
}

async function companionDog() {
  const dogs = await paintedDogs();
  assert.equal(dogs.length, 1, 'Exactly one painted dog owns the desktop');
  assert.ok(isPetPage(dogs[0].page), 'The dog is owned by the desktop paint surface');
  return dogs[0];
}

async function minimize() {
  await widget.evaluate(() => window.niuma.minimizeWidget({ reducedMotion: false }));
  await expect.poll(phase, { timeout: 10_000 }).toBe('companion');
  await expect.poll(async () => (await widgetWindow())?.visible).toBe(false);
  await expect.poll(async () => (await paintedDogs()).length).toBe(1);
  const dog = await companionDog();
  assert.equal(dog.interactive, 'true');
  return dog;
}

async function restoreByDoubleClick(position) {
  const { page } = await companionDog();
  // Renderer mouse input does not move the user's physical system cursor.
  if (position) await page.locator('#desktop-dog').dblclick({ position });
  else {
    await page.locator('#desktop-dog').dispatchEvent('pointerdown', { button: 0, isPrimary: true });
    await page.locator('#desktop-dog').dispatchEvent('dblclick');
  }
  await expect.poll(async () => (await widgetWindow())?.visible, { timeout: 10_000 }).toBe(true);
  await expect.poll(phase).toBe('docked');
  await expect.poll(async () => (await paintedDogs()).length).toBe(1);
  await expect(widget.locator('.widget-dog')).toBeVisible();
}

async function verify() {
  desktop = await electron.launch({ executablePath,
    args: [...(executablePath ? [] : [root]), `--user-data-dir=${userData}`],
    cwd: root, env: environment, timeout: 30_000 });
  desktop.on('window', page => page.on('pageerror', error => failures.push(`${page.url()}: ${error.message}`)));
  desktop.process().stderr?.on('data', data => {
    const line = data.toString();
    if (/Uncaught|UnhandledPromiseRejection|Unable to load main window/.test(line)) failures.push(line);
  });
  main = await desktop.firstWindow();
  main.on('pageerror', error => failures.push(error.message));
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  const paths = await desktop.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
  for (const value of Object.values(paths)) assert.equal(fs.realpathSync.native(value), fs.realpathSync.native(userData));
  const profile = preferences(await main.evaluate(() => window.niuma.getState()));
  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(() => desktop.windows().some(page => page.url().endsWith('#/widget'))).toBe(true);
  widget = desktop.windows().find(page => page.url().endsWith('#/widget'));
  await expect(widget.getByRole('button', { name: '最小化浮窗', exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await widgetWindow())?.visible).toBe(true);
  // Keep the initial dog away from the unchanged physical cursor so hovering
  // does not intentionally freeze the autonomous-motion observation.
  observations.cursor = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const x = cursor.x < area.x + area.width / 2 ? area.x + area.width - bounds.width - 30 : area.x + 30;
    const y = Math.max(area.y, area.y + area.height - bounds.height - 60);
    win.setPosition(Math.round(x), Math.round(y));
    return cursor;
  });
  const originalBounds = (await widgetWindow()).bounds;
  record('isolated desktop app opened its widget without changing salary data');

  const before = (await paintedDogs())[0];
  assert.ok(before, 'The docked dog has a painted location');
  await widget.getByRole('button', { name: '最小化浮窗', exact: true }).click();
  await expect.poll(phase, { timeout: 10_000 }).toBe('companion');
  await expect.poll(async () => (await widgetWindow())?.visible).toBe(false);
  await expect.poll(async () => (await paintedDogs()).length).toBe(1);
  const start = await companionDog();
  assert.equal(start.interactive, 'true');
  assert.ok(Math.hypot(start.x - before.x, start.y - before.y) < 90,
    'Minimizing hands the current dog to the desktop near its current location');
  assert.deepEqual((await widgetWindow()).bounds, originalBounds);
  record('minimize button hides the card and leaves one interactive dog at its starting location');

  const samples = await start.page.evaluate(zoom => new Promise(resolve => {
    const values = [];
    const started = performance.now();
    const sample = () => {
      const dog = document.getElementById('desktop-dog');
      const rect = dog.getBoundingClientRect();
      values.push({ x: window.screenX + (rect.x + rect.width / 2) * zoom, y: window.screenY + (rect.y + rect.height / 2) * zoom,
        pose: dog.dataset.pose, frame: dog.dataset.frame });
      if (performance.now() - started < 5_000) setTimeout(sample, 100);
      else resolve(values);
    };
    sample();
  }), start.zoom);
  const movement = Math.max(...samples.map(value => Math.hypot(value.x - samples[0].x, value.y - samples[0].y)));
  const poses = [...new Set(samples.map(value => `${value.pose}:${value.frame}`))];
  observations.autonomous = { movement, poses };
  assert.ok(movement > 8, `The desktop dog moves autonomously (${movement.toFixed(1)} DIP observed)`);
  assert.ok(poses.length > 1, 'The dog has animated poses without a cursor chase');
  // A person or another task may use this shared desktop during the check.
  // Observe the OS pointer without requiring exclusive control over it.
  observations.cursorAfterAutonomy = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  record('desktop dog keeps walking and animating without any mouse commands from the test');

  // An unrelated window with the same preload is not an owned desktop surface.
  await desktop.evaluate(async ({ BrowserWindow }, preload) => {
    const rogue = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await rogue.loadURL('about:blank');
      await rogue.webContents.executeJavaScript('window.petOverlay.restoreWidget(); window.petOverlay.setRestoreTarget({ x: 0, y: 0, width: 76, height: 76 }); window.petOverlay.setReducedMotion(true);');
      await new Promise(resolve => setTimeout(resolve, 80));
    } finally { rogue.destroy(); }
  }, path.join(root, 'electron', 'desktop-pet-preload.cjs'));
  assert.equal((await widgetWindow()).visible, false);
  assert.equal(await phase(), 'companion');
  record('unowned window cannot use desktop-pet commands to restore the widget');

  await restoreByDoubleClick();
  assert.deepEqual((await widgetWindow()).bounds, originalBounds);
  record('double-click restores the card at its original location with exactly one docked dog');

  for (let iteration = 0; iteration < 2; iteration++) {
    await minimize();
    await restoreByDoubleClick();
  }
  record('repeated minimize/restore cycles leave no duplicate dog or visible paint surface');

  for (const [label, x, y] of [['feet', 38, 74], ['left toes', 15, 73], ['right toes', 61, 73], ['upper corner', 2, 2]]) {
    const dog = await minimize();
    await dog.page.evaluate(() => window.petOverlay.setReducedMotion(true));
    await expect.poll(async () => dog.page.locator('#desktop-dog').getAttribute('data-reduced-motion')).toBe('true');
    const size = (await dog.page.locator('#desktop-dog').boundingBox()).width;
    await restoreByDoubleClick({ x: x * size / 76, y: y * size / 76 });
    assert.deepEqual((await widgetWindow()).bounds, originalBounds);
    record(`double-clicking the ${label} restores exactly one widget at its saved position`);
  }

  await widget.evaluate(() => window.niuma.setDesktopPetMode({ active: true, reducedMotion: false }));
  await expect.poll(phase).toBe('chasing');
  await minimize();
  await expect.poll(async () => {
    const dogs = await paintedDogs();
    const page = dogs[0]?.page;
    return page ? page.locator('#desktop-bone').isVisible() : true;
  }).toBe(false);
  await restoreByDoubleClick();
  record('minimizing during a bone chase switches to autonomous companionship and removes the cursor bone');

  const reduced = await minimize();
  await reduced.page.evaluate(() => window.petOverlay.setReducedMotion(true));
  await expect.poll(async () => reduced.page.locator('#desktop-dog').getAttribute('data-reduced-motion')).toBe('true');
  const quietPosition = await companionDog();
  await reduced.page.waitForTimeout(300);
  const still = await companionDog();
  assert.deepEqual([still.x, still.y, still.size], [quietPosition.x, quietPosition.y, quietPosition.size]);
  await restoreByDoubleClick();
  record('reduced-motion companion stays still and still supports double-click restoration');

  await minimize();
  await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'));
  await expect.poll(async () => (await paintedDogs()).length).toBe(0);
  assert.equal(await phase(), 'companion');
  await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  await expect.poll(async () => (await paintedDogs()).length).toBe(1);
  assert.equal((await widgetWindow()).visible, false);
  await widget.evaluate(() => window.niuma.setDesktopPetMode({ active: false, reducedMotion: true }));
  assert.equal(await phase(), 'companion');
  await restoreByDoubleClick();
  record('sleep/resume preserves companionship and a hidden renderer cannot recall the dog into a hidden card');

  await minimize();
  await widget.evaluate(() => window.niuma.hideWidget());
  await expect.poll(phase).toBe('docked');
  await expect.poll(async () => (await paintedDogs()).length).toBe(0);
  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(async () => (await widgetWindow())?.visible).toBe(true);
  await expect.poll(async () => (await paintedDogs()).length).toBe(1);
  record('explicit hide ends companionship, and showing the widget recovers normally');

  await minimize();
  await main.evaluate(() => window.niuma.restoreMain());
  await expect.poll(async () => (await windows()).find(win => win.url === main.url())?.minimized).toBe(false);
  await expect.poll(async () => (await windows()).find(win => win.url === main.url())?.visible).toBe(true);
  await expect.poll(async () => (await paintedDogs()).length).toBe(0);
  // The public holiday cache may update independently during the smoke test.
  assert.deepEqual(preferences(await main.evaluate(() => window.niuma.getState())), profile);
  assert.equal((await windows()).filter(win => /\/pet\.html(?:[?#]|$)/.test(win.url) && win.visible).length, 0);
  record('returning to the main window ends companionship and preserves salary and app preferences');
  assert.deepEqual(failures, []);
}

try {
  await verify();
} catch (error) {
  failures.push(error.stack || error.message || String(error));
  if (desktop) {
    try { observations.failureWindows = await windows(); } catch { /* Process may have exited. */ }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  if (desktop) {
    const child = desktop.process();
    try {
      await desktop.close();
      await expect.poll(() => child.exitCode !== null || child.signalCode !== null, { timeout: 8_000 }).toBe(true);
      assert.equal(child.exitCode, 0);
      record('isolated Electron process closed cleanly');
    } catch (error) {
      failures.push(error.message);
      process.exitCode = 1;
    }
  }
  fs.writeFileSync(path.join(artifacts, 'desktop-companion-result.json'), JSON.stringify({
    status: failures.length ? 'failed' : 'passed', passed, errors: failures, observations, userData,
    physicalSystemInput: false, platform: process.platform, executablePath: executablePath || null,
  }, null, 2));
}
