import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';

const run = promisify(execFile);
const source = fileURLToPath(new URL('../tests/windows/widget-input.cs', import.meta.url));

export async function prepareWindowsDesktop() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.NIUMA_WINDOWS_NATIVE_INPUT, '1');
  // Leave the desktop exposed before launching either package: the runner's
  // own console can legitimately cover a bottom-layer window.
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep -Milliseconds 350"], { windowsHide: true });
}

async function nativePoint(desktop, point) {
  return desktop.evaluate(({ BrowserWindow, screen }, point) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
    const { x, y } = win.getContentBounds();
    const zoom = win.webContents.getZoomFactor();
    return screen.dipToScreenPoint({ x: Math.round(x + point.x * zoom), y: Math.round(y + point.y * zoom) });
  }, point);
}

async function center(locator) {
  const box = await locator.boundingBox();
  assert.ok(box, 'The requested widget control is visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function verifyWindowsWidget(desktop, widget, scratch, record, baseline) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Only run real system input in the isolated CI desktop');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.NIUMA_WINDOWS_NATIVE_INPUT, '1');
  const version = await desktop.evaluate(({ app }) => app.getVersion());
  if (baseline) assert.equal(version, '1.1.0');
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const tool = path.join(scratch, 'window-input.exe');
  const references = ['WindowsBase.dll', 'UIAutomationClient.dll', 'UIAutomationTypes.dll'].map(name => '/r:' + path.join(path.dirname(compiler), 'WPF', name));
  await run(compiler, ['/nologo', '/target:exe', '/platform:x64', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', ...references, '/out:' + tool, source], { windowsHide: true });
  const invoke = async (action, point, hwnd) => {
    const args = [action, ...(point ? [point.x, point.y] : []), ...(hwnd ? [hwnd] : [])].map(String);
    return (await run(tool, args, { windowsHide: true, timeout: 5000 })).stdout.trim();
  };
  const state = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = w.getBounds();
    w.setPosition(Math.round(area.x + (area.width - bounds.width) / 2), Math.round(area.y + (area.height - bounds.height) / 2));
    return { hwnd: Number(w.getNativeWindowHandle().readBigUInt64LE()), width: bounds.width, height: bounds.height };
  });
  const origin = await nativePoint(desktop, { x: 0, y: 0 });
  const end = await nativePoint(desktop, { x: state.width, y: state.height });
  const cover = spawn(tool, ['cover', origin.x - 20, origin.y - 20, end.x - origin.x + 40, end.y - origin.y + 40].map(String), { windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] });
  let receiver = 0;
  let clicks = 0;
  const reports = createInterface({ input: cover.stdout });
  reports.on('line', line => {
    if (/^READY \d+$/.test(line)) receiver = Number(line.slice(6));
    if (line === 'CLICK') clicks++;
  });
  async function closeCover() {
    if (cover.exitCode === null && cover.signalCode === null) {
      const exited = once(cover, 'exit');
      cover.kill();
      await exited;
    }
    reports.close();
  }
  const button = name => widget.getByRole('button', { name, exact: true });
  const click = async locator => invoke('click', await nativePoint(desktop, await center(locator)), state.hwnd);
  const windowState = () => desktop.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const w = all.find(win => win.webContents.getURL().endsWith('#/widget'));
    const main = all.find(win => win !== w);
    return { visible: w.isVisible(), bounds: w.getBounds(), mainRestored: main?.isVisible() && !main.isMinimized() };
  });
  const observations = [];
  async function check(label, action) {
    try {
      await action();
      record(label);
      observations.push({ check: label, passed: true });
    } catch (error) {
      if (!baseline) throw error;
      observations.push({ check: label, passed: false, error: error.message });
      console.log('BASELINE', label, error.message);
    }
  }
  try {
    await expect.poll(() => receiver).toBeGreaterThan(0);
    // This point lies strictly outside the widget. Its delivery proves that this
    // VM has a usable input desktop, independently of the Electron application.
    await invoke('click', { x: origin.x - 8, y: origin.y + 25 }, receiver);
    await expect.poll(() => clicks).toBe(1);
    record('an independent ordinary Win32 window receives a real system click on the isolated desktop');
    await invoke('click', await nativePoint(desktop, { x: 2, y: 6 }), receiver);
    await expect.poll(() => clicks).toBe(2);
    record('transparent pet lane passes a real click to the ordinary application behind it');
    const dog = button('和狗狗握手');
    await widget.emulateMedia({ reducedMotion: 'reduce' });
    await check('real click shakes the dog’s paw without a mouse-focus ring', async () => {
      await click(dog);
      await expect(dog).toHaveAttribute('data-pose', 'paw');
      assert.deepEqual(await dog.evaluate(el => [getComputedStyle(el).outlineStyle, el.matches(':focus-visible')]), ['none', false]);
    });
    await widget.emulateMedia({ reducedMotion: 'no-preference' });
    await check('real bone button picks up the bone, follows both screen positions and puts it away', async () => {
      await click(button('拿起骨头'));
      await expect(button('收起骨头')).toHaveAttribute('aria-pressed', 'true');
      await expect(widget.locator('.pet-held-bone')).toBeVisible();
      const centerX = () => dog.evaluate(el => el.getBoundingClientRect().left + el.offsetWidth / 2);
      await invoke('move', await nativePoint(desktop, { x: 45, y: 140 }));
      await expect.poll(centerX, { timeout: 8500 }).toBeLessThan(75);
      await invoke('move', await nativePoint(desktop, { x: state.width - 42, y: 140 }));
      await expect.poll(centerX, { timeout: 8500 }).toBeGreaterThan(state.width - 75);
      await click(button('收起骨头'));
      await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
      await click(button('拿起骨头'));
      await invoke('escape');
      await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
    });

    const main = desktop.windows().find(page => !page.url().includes('#/widget'));
    await check('real return button restores the main window', async () => {
      await click(button('返回主窗口'));
      await expect.poll(async () => (await windowState()).mainRestored).toBe(true);
      await expect.poll(async () => (await windowState()).visible).toBe(false);
    });
    await main.evaluate(() => window.niuma.showWidget());
    await check('real hide button hides the native widget', async () => {
      await click(button('隐藏浮窗'));
      await expect.poll(async () => (await windowState()).visible).toBe(false);
    });
    if (!baseline) {
      await main.evaluate(() => window.niuma.showWidget());
      const overlap = await nativePoint(desktop, await center(widget.locator('.widget-middle')));
      await click(button('将浮窗置底'));
      await expect.poll(() => invoke('hit', overlap)).toBe(String(receiver));
      await invoke('click', overlap, receiver);
      await expect.poll(() => clicks).toBe(3);
      record('a normal application immediately covers the lowered widget and receives the system click');
      let trayError;
      try {
        const pid = await desktop.evaluate(({ app }) => { app.setAccessibilitySupportEnabled(true); return process.pid; });
        const { stdout } = await run(tool, ['tray', String(pid), String(receiver)], { windowsHide: true, timeout: 25000 });
        await expect.poll(() => invoke('hit', overlap)).toBe(String(state.hwnd));
        await expect(button('将浮窗置底')).toBeVisible();
        record(stdout.trim() + ' restored topmost order over the independent application');
        await click(button('将浮窗置底'));
        await expect.poll(() => invoke('hit', overlap)).toBe(String(receiver));
      } catch (error) {
        // Collect the exposed-button result independently, but require BOTH to pass.
        console.error('Tray recovery:', error);
        trayError = error;
        await invoke('escape');
      }
      const coverAction = action => run(tool, [action, String(receiver), String(cover.pid)], { windowsHide: true });
      await coverAction('hide-cover');
      await click(button('将浮窗置顶'));
      await expect(button('将浮窗置底')).toBeVisible();
      record('a real click on the exposed bottom widget brings it back to the top');
      const before = (await windowState()).bounds;
      await invoke('drag', await nativePoint(desktop, await center(widget.locator('.widget-middle'))), state.hwnd);
      await expect.poll(async () => {
        const after = (await windowState()).bounds;
        return before.x - after.x > 10 && before.y - after.y > 5;
      }).toBe(true);
      record('dragging the native card body moves the desktop widget');

      if (trayError) throw trayError;
    }
  } finally {
    await closeCover();
  }
  return { click, version, observations };
}
