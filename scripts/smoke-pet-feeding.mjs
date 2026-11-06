import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect } from '@playwright/test';
import koffi from 'koffi';

// This smoke test owns a separate Electron profile. On Windows it saves and
// restores the physical cursor, and clicks only a verified visible food button.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const userData = path.join(artifacts, `pet-feeding-test-${Date.now()}`);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
fs.mkdirSync(userData, { recursive: true });

const passed = [], errors = [], observations = {};
const record = message => { passed.push(message); console.log(`PASS ${message}`); };
const user32 = process.platform === 'win32' ? koffi.load('user32.dll') : null;
const setCursorPos = user32?.func('bool __stdcall SetCursorPos(int, int)');
const mouseEvent = user32?.func('void __stdcall mouse_event(uint32_t, uint32_t, uint32_t, uint32_t, uintptr_t)');
const setThreadDpiAwareness = user32?.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t)');
const getPhysicalCursorPos = user32?.func('bool __stdcall GetPhysicalCursorPos(void *)');
const previousDpiContext = setThreadDpiAwareness?.(-4);
function physicalCursor() {
  const point = Buffer.alloc(8);
  assert.ok(getPhysicalCursorPos(point));
  return { x: point.readInt32LE(0), y: point.readInt32LE(4) };
}
let desktop, widget, originalCursor;

async function windows() {
  return desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({
    id: win.id, url: win.webContents.getURL(), visible: win.isVisible(),
    bounds: win.getContentBounds(), zoom: win.webContents.getZoomFactor(), ignoresMouse: win.__feedingSmokeIgnoresMouse,
  })));
}

async function nativeWindow(page) {
  return (await windows()).find(win => win.url === page.url());
}

async function petPage() {
  for (const page of desktop.windows()) {
    if (!/\/pet\.html(?:[?#]|$)/.test(page.url()) || page.isClosed()) continue;
    const owner = await nativeWindow(page);
    if (owner?.visible && await page.locator('#desktop-dog').isVisible()) return page;
  }
  return null;
}

async function phase() {
  return widget.evaluate(async () => (await window.niuma.getDesktopPetState()).phase);
}

async function moveCursor(point) {
  assert.ok(setCursorPos, 'Physical cursor testing requires Windows');
  const physical = await desktop.evaluate(({ screen }, point) => screen.dipToScreenPoint(point), {
    x: Math.round(point.x), y: Math.round(point.y),
  });
  assert.equal(setCursorPos(physical.x, physical.y), true);
  const actual = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  assert.ok(Math.hypot(actual.x - point.x, actual.y - point.y) < 3,
    `Physical cursor reaches requested DIP point: ${JSON.stringify({ point, actual })}`);
}

async function pointAt(page, selector) {
  const owner = await nativeWindow(page);
  assert.ok(owner?.visible);
  const box = await page.locator(selector).boundingBox();
  assert.ok(box, `Expected visible ${selector}`);
  return { x: owner.bounds.x + (box.x + box.width / 2) * owner.zoom,
    y: owner.bounds.y + (box.y + box.height / 2) * owner.zoom };
}

async function dogPosition(page, selector = '#desktop-dog') {
  const owner = await nativeWindow(page);
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect);
  return { x: owner.bounds.x + rect.x * owner.zoom, y: owner.bounds.y + rect.y * owner.zoom };
}

async function openMenu(page, selector = '#desktop-dog') {
  const target = await pointAt(page, selector);
  await moveCursor(target);
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(false);
  if (selector === '.widget-dog') await moveCursor({ x: target.x + 1, y: target.y });
  observations.hover = { target,
    cursor: await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint()),
    dog: await dogPosition(page, selector), native: await nativeWindow(page),
    frame: await page.locator(selector).evaluate(element => ({ ...element.dataset })),
  };
  await expect(page.locator('.pet-food-menu')).toBeVisible({ timeout: 5000 });
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(false);
  const menu = await page.locator('.pet-food-menu').boundingBox();
  const owner = await nativeWindow(page);
  assert.ok(menu.x >= -1 && menu.y >= -1 && menu.x + menu.width <= owner.bounds.width + 1 &&
    menu.y + menu.height <= owner.bounds.height + 1, 'Food menu stays within its display surface');
  assert.equal((await page.locator('.pet-food-menu').textContent()).trim(), '');
}

async function clickFood(page, food, dogSelector = '#desktop-dog') {
  const selector = `.pet-food-option[data-food="${food}"]`;
  await moveCursor(await pointAt(page, selector));
  await expect(page.locator('.pet-food-menu')).toBeVisible();
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(false);
  const expectedPoint = await pointAt(page, selector);
  const cursor = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  assert.ok(Math.hypot(cursor.x - expectedPoint.x, cursor.y - expectedPoint.y) < 3,
    'Physical click is restricted to the verified food button');
  mouseEvent(0x0002, 0, 0, 0, 0);
  mouseEvent(0x0004, 0, 0, 0, 0);
  await expect(page.locator(dogSelector)).toHaveAttribute('data-feeding', 'true');
  await expect(page.locator('.pet-feeding-sprite')).toHaveAttribute('data-food', food);
}

async function verifyWidgetMeal(page) {
  const selector = '.widget-dog';
  await openMenu(page, selector);
  await page.screenshot({ path: path.join(artifacts, 'pet-feeding-widget-menu.png') });
  const origin = await dogPosition(page, selector);
  await clickFood(page, 'kibble', selector);
  const owner = await nativeWindow(page);
  const lane = await page.locator('.widget-pet-lane').boundingBox();
  const clearLane = { x: owner.bounds.x + (lane.x + lane.width - 2) * owner.zoom,
    y: owner.bounds.y + (lane.y + 2) * owner.zoom };
  await moveCursor(clearLane);
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(true);
  await page.waitForTimeout(280);
  const eatingPosition = await dogPosition(page, selector);
  assert.ok(Math.hypot(eatingPosition.x - origin.x, eatingPosition.y - origin.y) < 1,
    'Widget dog does not walk away while eating');
  await page.screenshot({ path: path.join(artifacts, 'pet-feeding-widget-eating.png') });
  await expect(page.locator(selector)).toHaveAttribute('data-feeding', 'false', { timeout: 6500 });
  await expect(page.locator('.pet-feeding-sprite')).toBeHidden();
  await expect.poll(async () => Math.abs((await dogPosition(page, selector)).x - origin.x)).toBeGreaterThan(3);
  await openMenu(page, selector);
  await moveCursor(clearLane);
  await expect(page.locator('.pet-food-menu')).toBeHidden({ timeout: 2500 });
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(true);
  record('widget food menu accepts a physical click, eating completes, transparent lane passes clicks and leaving closes the menu');
}

async function verifyMeal(page, food, away) {
  await openMenu(page);
  await page.screenshot({ path: path.join(artifacts, `pet-feeding-${food}-menu.png`) });
  const origin = await dogPosition(page);
  await clickFood(page, food);
  await moveCursor(away);
  await expect.poll(async () => (await nativeWindow(page)).ignoresMouse).toBe(true);
  await page.waitForTimeout(260);
  assert.ok(Math.hypot((await dogPosition(page)).x - origin.x, (await dogPosition(page)).y - origin.y) < 1,
    'The dog stays in place while eating');
  const firstFrame = await page.locator('.pet-feeding-sprite').getAttribute('data-frame');
  await expect.poll(() => page.locator('.pet-feeding-sprite').getAttribute('data-frame')).not.toBe(firstFrame);
  await page.evaluate(() => window.petOverlay.feed('invalid'));
  await page.evaluate(() => window.petOverlay.feed('stick'));
  await expect(page.locator('.pet-feeding-sprite')).toHaveAttribute('data-food', food);
  await page.screenshot({ path: path.join(artifacts, `pet-feeding-${food}-eating.png`) });
  if (food === 'kibble') {
    await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('lock-screen'));
    await expect.poll(async () => (await nativeWindow(page)).visible).toBe(false);
    await page.waitForTimeout(4500);
    await desktop.evaluate(({ powerMonitor }) => powerMonitor.emit('unlock-screen'));
    await expect.poll(async () => (await nativeWindow(page)).visible).toBe(true);
    await expect(page.locator('#desktop-dog')).toHaveAttribute('data-feeding', 'true');
    await expect(page.locator('.pet-feeding-sprite')).toHaveAttribute('data-stage', 'eat');
    record('companion feeding pauses across simulated screen lock and resumes without skipping the meal');
  }
  await expect(page.locator('#desktop-dog')).toHaveAttribute('data-feeding', 'false', { timeout: 6500 });
  await expect(page.locator('.pet-feeding-sprite')).toBeHidden();
  await expect.poll(async () => {
    const current = await dogPosition(page);
    return Math.hypot(current.x - origin.x, current.y - origin.y);
  }, { timeout: 6500 }).toBeGreaterThan(3);
}

async function verify() {
  assert.equal(process.platform, 'win32', 'This test exercises Windows native pointer hit testing');
  desktop = await electron.launch({ args: [root, `--user-data-dir=${userData}`], cwd: root,
    env: environment, timeout: 30000 });
  desktop.on('window', page => page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`)));
  desktop.process().stderr?.on('data', data => {
    const line = data.toString();
    if (/Uncaught|UnhandledPromiseRejection|Unable to load main window/.test(line)) errors.push(line);
  });
  const main = await desktop.firstWindow();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 });
  const setup = await desktop.evaluate(({ app, screen }) => {
    // Electron exposes no ignore-mouse getter. Record calls on test-owned
    // windows, and also prove the active rectangle with a real OS click.
    app.on('browser-window-created', (_event, win) => {
      win.__feedingSmokeIgnoresMouse = false;
      const original = win.setIgnoreMouseEvents.bind(win);
      win.setIgnoreMouseEvents = (ignore, options) => {
        win.__feedingSmokeIgnoresMouse = ignore;
        return original(ignore, options);
      };
    });
    return { userData: app.getPath('userData'), cursor: screen.dipToScreenPoint(screen.getCursorScreenPoint()),
      area: screen.getPrimaryDisplay().workArea, displays: screen.getAllDisplays().map(display => display.workArea) };
  });
  originalCursor = physicalCursor();
  observations.originalCursor = originalCursor;
  assert.equal(fs.realpathSync.native(setup.userData), fs.realpathSync.native(userData));
  observations.displays = setup.displays;
  const away = { x: setup.area.x + 24, y: setup.area.y + 24 };
  await moveCursor(away);
  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(() => desktop.windows().some(page => page.url().endsWith('#/widget'))).toBe(true);
  widget = desktop.windows().find(page => page.url().endsWith('#/widget'));
  await expect(widget.locator('.widget-dog')).toBeVisible({ timeout: 10000 });
  await desktop.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
    const area = screen.getPrimaryDisplay().workArea;
    win.setPosition(Math.round(area.x + area.width / 2 - win.getBounds().width / 2),
      Math.round(area.y + area.height / 2));
  });
  await verifyWidgetMeal(widget);
  await widget.evaluate(() => window.niuma.minimizeWidget({ reducedMotion: false }));
  await expect.poll(phase, { timeout: 10000 }).toBe('companion');
  await expect.poll(async () => Boolean(await petPage())).toBe(true);
  let pet = await petPage();
  await openMenu(pet);
  await desktop.evaluate(async ({ BrowserWindow }, preload) => {
    const rogue = new BrowserWindow({ show: false,
      webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
    try {
      await rogue.loadURL('about:blank');
      await rogue.webContents.executeJavaScript('window.petOverlay.feed("kibble")');
      await new Promise(resolve => setTimeout(resolve, 100));
    } finally { rogue.destroy(); }
  }, path.join(root, 'electron', 'desktop-pet-preload.cjs'));
  await expect(pet.locator('#desktop-dog')).toHaveAttribute('data-feeding', 'false');
  await pet.evaluate(() => window.petOverlay.feed('invalid'));
  await expect(pet.locator('#desktop-dog')).toHaveAttribute('data-feeding', 'false');
  record('foreign surfaces and invalid food cannot start a meal');
  await verifyMeal(pet, 'kibble', away);
  assert.equal(await phase(), 'companion');
  record('physical hover and click feed kibble; companion pauses, animates and resumes');
  record('menu accepts mouse clicks and the surrounding desktop remains click-through');

  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(phase).toBe('docked');
  const edge = { x: setup.area.x + setup.area.width - 20, y: setup.area.y + 110 };
  await moveCursor(edge);
  await widget.evaluate(() => window.niuma.setDesktopPetMode({ active: true, reducedMotion: false }));
  await expect.poll(phase).toBe('chasing');
  await expect.poll(async () => Boolean(await petPage())).toBe(true);
  pet = await petPage();
  await expect(pet.locator('.pet-food-menu')).toBeVisible({ timeout: 10000 });
  await verifyMeal(pet, 'stick', away);
  assert.equal(await phase(), 'chasing');
  record('physical stick feeding also works during a chase at the screen edge, then chasing resumes');
  await widget.evaluate(() => window.niuma.setDesktopPetMode({ active: false, reducedMotion: false }));
  await expect.poll(phase, { timeout: 10000 }).toBe('docked');
  record('recalling the dog after feeding returns cleanly to the widget');
  assert.deepEqual(errors, []);
}

try {
  await verify();
} catch (error) {
  errors.push(error.stack || String(error));
  console.error(error);
  process.exitCode = 1;
  if (desktop) {
    try { observations.failureWindows = await windows(); } catch { /* Test process may have exited. */ }
    try { observations.failureCursor = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint()); } catch { /* Exited. */ }
    try {
      const pet = await petPage();
      if (pet) {
        observations.failureDog = await dogPosition(pet);
        await pet.screenshot({ path: path.join(artifacts, 'pet-feeding-native-failure.png') });
      }
    } catch { /* Preserve original failure. */ }
  }
} finally {
  if (desktop) {
    try { await desktop.close(); record('isolated Electron application closed'); }
    catch (error) { errors.push(error.message); process.exitCode = 1; }
  }
  if (originalCursor && setCursorPos) {
    setCursorPos(originalCursor.x, originalCursor.y);
    observations.restoredCursor = physicalCursor();
    try { assert.deepEqual(observations.restoredCursor, originalCursor); }
    catch (error) { errors.push(error.message); process.exitCode = 1; }
  }
  if (previousDpiContext && setThreadDpiAwareness) setThreadDpiAwareness(previousDpiContext);
  fs.writeFileSync(path.join(artifacts, 'pet-feeding-native-result.json'), JSON.stringify({
    status: errors.length ? 'failed' : 'passed', passed, errors, observations, userData,
    physicalSystemInput: true, cursorRestored: Boolean(originalCursor),
  }, null, 2));
}
