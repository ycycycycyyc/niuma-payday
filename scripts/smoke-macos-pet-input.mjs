import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, expect } from '@playwright/test';

// Setup and observations use Playwright. Every tested click, drag and double
// click is posted through CoreGraphics/WindowServer, never renderer dispatch.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'artifacts');
const resultFile = path.join(artifacts, 'macos-pet-input-result.json');
fs.mkdirSync(artifacts, { recursive: true });
if (process.platform !== 'darwin') {
  fs.writeFileSync(resultFile, JSON.stringify({ status: 'skipped', platform: process.platform,
    reason: 'Requires macOS WindowServer and PostEvent access; no Mac behavior was verified.' }, null, 2));
  console.log('SKIP macOS pet input: requires macOS WindowServer');
  process.exit(0);
}

const run = promisify(execFile);
const fixtures = path.join(root, 'tests', 'macos');
const userData = path.join(process.env.NIUMA_SMOKE_DATA_ROOT || artifacts, `mac-pet-input-${Date.now()}`);
const targetFile = path.join(userData, 'observed-pet-target.json');
const receiverFile = path.join(userData, 'receiver.json');
const executablePath = process.env.NIUMA_SMOKE_EXECUTABLE && path.resolve(process.env.NIUMA_SMOKE_EXECUTABLE);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.VITE_DEV_SERVER_URL;
fs.mkdirSync(userData, { recursive: true });
const passed = [], failures = [], observations = {};
let desktop, main, widget, receiver, originalCursor, area;
let targetObservation = 0;

async function pointer(action, point) {
  const args = ['-l', 'JavaScript', path.join(fixtures, 'quartz-pointer.js'), action];
  if (action.includes('-target-')) args.push(targetFile);
  else args.push(String(Math.round(point.x)), String(Math.round(point.y)));
  const { stdout } = await run('/usr/bin/osascript', args, { timeout: 10_000 });
  return stdout.trim() ? JSON.parse(stdout.trim()) : null;
}

async function owner(page) {
  const handle = await desktop.browserWindow(page);
  try {
    return await handle.evaluate(win => ({ id: win.id, visible: win.isVisible(), zoom: win.webContents.getZoomFactor() }));
  } finally { await handle.dispose(); }
}

async function phase() { return widget.evaluate(async () => (await window.niuma.getDesktopPetState()).phase); }
const receivedClicks = () => JSON.parse(fs.readFileSync(receiverFile, 'utf8')).clicks;

async function screenRect(page, selector) {
  const win = await owner(page);
  assert.ok(win.visible, `Expected a visible native target: ${selector}`);
  return page.locator(selector).evaluate((el, zoom) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error('Native input target has no painted bounds');
    return { x: window.screenX + rect.x * zoom, y: window.screenY + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom };
  }, win.zoom);
}

async function pointAt(page, selector, fraction = .5) {
  const rect = await screenRect(page, selector);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height * fraction };
}

function farCorner(rect) {
  const x = rect.x + rect.width / 2 > area.x + area.width / 2 ? area.x + 32 : area.x + area.width - 32;
  const y = rect.y + rect.height / 2 > area.y + area.height / 2 ? area.y + 32 : area.y + area.height - 32;
  return { x, y };
}

function assertOutside(point, rect) {
  assert.ok(point.x < rect.x || point.y < rect.y || point.x >= rect.x + rect.width || point.y >= rect.y + rect.height,
    `Cursor must begin outside the dog's real screen bounds: ${JSON.stringify({ point, rect })}`);
}

async function moveOffDog(page) {
  const outside = farCorner(await screenRect(page, '#desktop-dog'));
  await pointer('move', outside);
  const cursor = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  const dog = await screenRect(page, '#desktop-dog');
  assert.ok(Math.hypot(cursor.x - outside.x, cursor.y - outside.y) < 2, 'WindowServer moved the cursor to the receiver');
  assertOutside(cursor, dog);
  return { cursor, dog };
}

async function petPage() {
  for (const page of desktop.windows()) {
    if (page.isClosed() || !/\/pet\.html(?:[?#]|$)/.test(page.url())) continue;
    if ((await owner(page))?.visible && await page.locator('#desktop-dog').isVisible()) return page;
  }
  return null;
}

async function companion(reducedMotion) {
  await widget.evaluate(() => window.niuma.showWidget());
  await expect.poll(phase).toBe('docked');
  await pointer('move', { x: area.x + 12, y: area.y + area.height / 2 });
  await widget.evaluate(reducedMotion => window.niuma.minimizeWidget({ reducedMotion }), reducedMotion);
  await expect.poll(phase, { timeout: 10_000 }).toBe('companion');
  await expect.poll(async () => Boolean(await petPage())).toBe(true);
  return petPage();
}

async function observeTarget(page, fraction = .92, destination) {
  const win = await owner(page);
  const observation = ++targetObservation;
  const name = '__writeMacPetTarget';
  if (!await page.evaluate(() => Boolean(window.__macPetTargetWriter))) {
    await page.exposeFunction(name, value => {
      if (value.observation !== targetObservation) return;
      const temporary = `${targetFile}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(value));
      fs.renameSync(temporary, targetFile);
    });
    await page.evaluate(() => { window.__macPetTargetWriter = true; });
  }
  await page.evaluate(({ zoom, fraction, destination, observation }) => {
    cancelAnimationFrame(window.__macPetTargetTimer);
    const sample = () => {
      window.__macPetTargetTimer = requestAnimationFrame(sample);
      const dog = document.getElementById('desktop-dog');
      if (!dog || dog.hidden) return;
      const rect = dog.getBoundingClientRect();
      // The borderless window moves with the dog. Sample its screen origin
      // and the painted CSS rectangle in the same frame, in Quartz points.
      void window.__writeMacPetTarget({ x: window.screenX + (rect.x + rect.width / 2) * zoom,
        y: window.screenY + (rect.y + rect.height * fraction) * zoom, capturedAt: Date.now(), observation, destination });
    };
    sample();
    window.__macPetEvents = [];
    if (!window.__macPetEventsInstalled) {
      for (const type of ['pointerdown', 'pointerup', 'dblclick']) document.addEventListener(type, event => {
        if (!event.target.closest?.('#desktop-dog')) return;
        const rect = document.getElementById('desktop-dog').getBoundingClientRect();
        window.__macPetEvents.push({ type, trusted: event.isTrusted, x: event.clientX, y: event.clientY,
          screenX: event.screenX, screenY: event.screenY, zoom, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          dogCenter: { x: window.screenX + (rect.x + rect.width / 2) * zoom, y: window.screenY + (rect.y + rect.height / 2) * zoom } });
      }, true);
      window.__macPetEventsInstalled = true;
    }
  }, { zoom: win.zoom, fraction, destination, observation });
  await expect.poll(() => fs.existsSync(targetFile) && JSON.parse(fs.readFileSync(targetFile, 'utf8')).observation === observation).toBe(true);
  return () => page.evaluate(() => cancelAnimationFrame(window.__macPetTargetTimer)).catch(() => {});
}

async function check(name, operation) {
  try { await operation(); passed.push(name); console.log(`PASS ${name}`); }
  catch (error) {
    failures.push({ check: name, message: error.stack || String(error) });
    console.error(`FAIL ${name}: ${error.message}`);
    await widget?.screenshot({ path: path.join(artifacts, 'macos-pet-input-error.png') }).catch(() => {});
  }
}

async function verify() {
  desktop = await electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${userData}`],
    cwd: root, env: environment, timeout: 30_000 });
  main = await desktop.firstWindow();
  await expect(main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  const actualData = await desktop.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(fs.realpathSync.native(actualData), fs.realpathSync.native(userData));
  originalCursor = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  area = await desktop.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  await main.evaluate(() => window.niuma.showWidget());
  await expect.poll(() => desktop.windows().some(page => page.url().endsWith('#/widget'))).toBe(true);
  widget = desktop.windows().find(page => page.url().endsWith('#/widget'));
  await expect(widget.locator('.widget-dog')).toBeVisible();
  await desktop.evaluate(({ BrowserWindow, screen }) => {
    const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = win.getBounds();
    win.setPosition(Math.round(area.x + area.width / 2 - bounds.width / 2),
      Math.round(area.y + area.height - bounds.height - 90));
  });

  const receiverTool = path.join(userData, 'window-probe');
  await run('/usr/bin/xcrun', ['swiftc', path.join(fixtures, 'window-probe.swift'), '-o', receiverTool], { timeout: 90_000 });
  receiver = spawn(receiverTool, ['cover', ...[area.x, area.y, area.width, area.height].map(String), receiverFile], { stdio: 'inherit' });
  await expect.poll(() => fs.existsSync(receiverFile)).toBe(true);
  observations.receiverWindow = JSON.parse(fs.readFileSync(receiverFile, 'utf8')).window;
  observations.primaryWorkArea = area;

  await check('zero-wait first press at stationary companion feet reaches the dog, not the receiver', async () => {
    const page = await companion(true);
    const stop = await observeTarget(page);
    try {
      observations.firstPressApproach = await moveOffDog(page);
      await page.waitForTimeout(100);
      const before = receivedClicks();
      const input = await pointer('click-target-now');
      await page.waitForTimeout(100);
      observations.firstPress = { input, events: await page.evaluate(() => window.__macPetEvents),
        receiverBefore: before, receiverAfter: receivedClicks() };
      assert.equal(input.moveToDownWaitMs, 0);
      await expect.poll(async () => page.evaluate(() => window.__macPetEvents.filter(event => event.type === 'pointerdown').length)).toBe(1);
      const events = await page.evaluate(() => window.__macPetEvents);
      assert.ok(events.every(event => event.trusted), 'Only real WindowServer events count');
      assert.equal(receivedClicks(), before, 'The first press cannot leak into the background application');
      observations.firstPress = { input, events, receiverBefore: before, receiverAfter: receivedClicks() };
    } finally { await stop(); }
  });

  await check('zero-wait feet drag on a moving companion captures the press and release', async () => {
    const page = await companion(false);
    const start = await pointAt(page, '#desktop-dog', .92);
    const destination = { x: Math.min(area.x + area.width - 100, start.x + 110), y: Math.max(area.y + 100, start.y - 75) };
    const stop = await observeTarget(page, .92, destination);
    try {
      observations.dragApproach = await moveOffDog(page);
      const before = receivedClicks();
      const input = await pointer('drag-target-now');
      observations.drag = { input, events: await page.evaluate(() => window.__macPetEvents),
        receiverBefore: before, receiverAfter: receivedClicks() };
      await expect.poll(async () => page.evaluate(() => window.__macPetEvents.some(event => event.type === 'pointerup'))).toBe(true);
      const events = await page.evaluate(() => window.__macPetEvents);
      const down = events.find(event => event.type === 'pointerdown');
      const up = events.find(event => event.type === 'pointerup');
      assert.ok(down?.trusted && up?.trusted);
      assert.ok(Math.hypot(up.screenX - down.screenX, up.screenY - down.screenY) > 60, 'The held pointer really moved');
      assert.ok(Math.hypot(up.screenX - input.end.x, up.screenY - input.end.y) < 2, 'WindowServer released at the commanded destination');
      const expected = { x: input.end.x + (down.rect.x + down.rect.width / 2 - down.x) * down.zoom,
        y: input.end.y + (down.rect.y + down.rect.height / 2 - down.y) * down.zoom };
      const current = up.dogCenter;
      assert.ok(Math.hypot(current.x - expected.x, current.y - expected.y) < 18,
        `Dog follows the grab offset at release: ${JSON.stringify({ current, expected })}`);
      assert.equal(receivedClicks(), before);
      observations.drag = { input, events, current, expected };
      await page.screenshot({ path: path.join(artifacts, 'macos-pet-input-companion.png') });

      const dog = await screenRect(page, '#desktop-dog');
      const clear = farCorner(dog);
      assertOutside(clear, dog);
      await pointer('click-now', clear);
      await expect.poll(receivedClicks).toBe(before + 1);
      observations.transparentDesktop = { point: clear, dog, clicksBefore: before, clicksAfter: receivedClicks() };
    } finally { await stop(); }
  });

  await check('WindowServer double-click restores a moving companion without synthetic clicks', async () => {
    const page = await companion(false);
    const stop = await observeTarget(page, .5);
    try {
      observations.doubleClickApproach = await moveOffDog(page);
      const before = receivedClicks();
      const input = await pointer('double-click-target-now');
      await page.waitForTimeout(100);
      observations.doubleClick = { input, events: await page.evaluate(() => window.__macPetEvents),
        receiverBefore: before, receiverAfter: receivedClicks() };
      await expect.poll(phase, { timeout: 10_000 }).toBe('docked');
      await expect.poll(async () => (await owner(widget)).visible).toBe(true);
      const events = await page.evaluate(() => window.__macPetEvents);
      assert.ok(events.some(event => event.type === 'dblclick' && event.trusted));
      assert.equal(receivedClicks(), before);
      observations.doubleClick = { input, events };
    } finally { await stop(); }
  });

  for (const food of ['kibble', 'stick']) await check(`WindowServer feeds ${food} through the widget menu`, async () => {
    await widget.evaluate(() => window.niuma.showWidget());
    await expect.poll(phase).toBe('docked');
    await pointer('move', await pointAt(widget, '.widget-dog'));
    await expect(widget.locator('.pet-food-menu')).toBeVisible({ timeout: 5000 });
    const item = `.pet-food-option[data-food="${food}"]`;
    const location = await pointAt(widget, item);
    await pointer('move', location);
    await expect(widget.locator(item)).toBeVisible();
    const before = receivedClicks();
    const input = await pointer('click-now', location);
    observations[`feeding-${food}`] = { input, receiverBefore: before, receiverAfter: receivedClicks() };
    await expect(widget.locator('.widget-dog')).toHaveAttribute('data-feeding', 'true');
    await expect(widget.locator('.pet-feeding-sprite')).toHaveAttribute('data-food', food);
    assert.equal(receivedClicks(), before);
    observations[`feeding-${food}`] = { input, receiverBefore: before, receiverAfter: receivedClicks() };
    await widget.screenshot({ path: path.join(artifacts, `macos-pet-input-${food}.png`) });
    await pointer('move', { x: area.x + 12, y: area.y + area.height / 2 });
    await expect(widget.locator('.widget-dog')).toHaveAttribute('data-feeding', 'false', { timeout: 7000 });
  });
}

try { await verify(); }
catch (error) { failures.push({ check: 'setup', message: error.stack || String(error) }); }
finally {
  if (originalCursor) await pointer('move', originalCursor).catch(error => failures.push({ check: 'restore cursor', message: error.message }));
  if (receiver && receiver.exitCode === null && receiver.signalCode === null) {
    const ended = once(receiver, 'exit'); receiver.kill(); await ended;
  }
  await desktop?.close().catch(error => failures.push({ check: 'close isolated app', message: error.message }));
  fs.writeFileSync(resultFile, JSON.stringify({ status: failures.length ? 'failed' : 'passed', platform: process.platform,
    physicalSystemInput: passed.length > 0, inputMechanism: 'CoreGraphics WindowServer',
    moveToDownWaitMs: 0, userData, passed, failures, observations }, null, 2));
}
if (failures.length) { console.error(JSON.stringify(failures, null, 2)); process.exitCode = 1; }
