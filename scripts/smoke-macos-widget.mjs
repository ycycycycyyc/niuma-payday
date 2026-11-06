import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';

const run = promisify(execFile);
const fixtures = fileURLToPath(new URL('../tests/macos/', import.meta.url));

async function pointer(action, point) {
  await run('/usr/bin/osascript', ['-l', 'JavaScript', path.join(fixtures, 'quartz-pointer.js'),
    action, String(Math.round(point.x)), String(Math.round(point.y))]);
}

async function nativeWidget(desktop) {
  return desktop.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
    return { ...win.getContentBounds(), scale: win.webContents.getZoomFactor(), id: Number(win.getMediaSourceId().split(':')[1]) };
  });
}

export async function macClick(desktop, locator) {
  const win = await nativeWidget(desktop);
  const box = await locator.boundingBox();
  assert.ok(box, 'Expected a visible widget control');
  await pointer('click', { x: win.x + (box.x + box.width / 2) * win.scale, y: win.y + (box.y + box.height / 2) * win.scale });
}

export async function verifyMacWidget(desktop, widget, scratch, record) {
  const tool = path.join(scratch, 'window-probe');
  const reportFile = path.join(scratch, 'window-probe.json');
  await run('/usr/bin/xcrun', ['swiftc', path.join(fixtures, 'window-probe.swift'), '-o', tool], { timeout: 90000 });
  const previousPointer = await desktop.evaluate(({ screen }) => screen.getCursorScreenPoint());
  const win = await nativeWidget(desktop);
  const cover = spawn(tool, ['cover', ...[win.x, win.y, win.width, win.height].map(String), reportFile], { stdio: 'inherit' });
  const readReceiver = async () => JSON.parse(await fs.readFile(reportFile, 'utf8'));
  const button = name => widget.getByRole('button', { name, exact: true });
  try {
    await expect.poll(() => fs.access(reportFile).then(() => true, () => false)).toBe(true);
    const receiverId = (await readReceiver()).window;
    async function order() {
      const { stdout } = await run(tool, ['order', String(win.id), String(receiverId)]);
      const visible = JSON.parse(stdout);
      const panel = visible.find(item => item.id === win.id);
      const receiver = visible.find(item => item.id === receiverId);
      if (!panel || !receiver) return 'missing: ' + stdout;
      if (panel.order < receiver.order && panel.level > receiver.level) return 'top';
      if (panel.order > receiver.order && panel.level < receiver.level) return 'bottom';
      return stdout;
    }
    await expect.poll(order).toBe('top');
    // The first clicks happen while the other application is active. A transparent
    // corner near either end of the lane stays outside the dog's bounds.
    await pointer('click', { x: win.x + 2, y: win.y + 6 });
    await expect.poll(async () => (await readReceiver()).clicks).toBe(1);
    const dog = button('和狗狗握手');
    await macClick(desktop, dog);
    await expect(dog).toHaveAttribute('data-pose', 'paw');
    assert.equal(await dog.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    record('WindowServer click reaches the app behind transparent padding and the moving dog shakes paws without a pointer outline');

    await macClick(desktop, button('拿起骨头'));
    await expect(button('收起骨头')).toHaveAttribute('aria-pressed', 'true');
    await expect(widget.locator('.pet-held-bone')).toBeVisible();
    const centerX = () => dog.evaluate(el => el.getBoundingClientRect().left + el.offsetWidth / 2);
    await pointer('move', { x: win.x + 45, y: win.y + 140 });
    await expect.poll(centerX, { timeout: 8500 }).toBeLessThan(75);
    await pointer('move', { x: win.x + win.width - 42, y: win.y + 140 });
    await expect.poll(centerX, { timeout: 8500 }).toBeGreaterThan(win.width - 75);
    await macClick(desktop, button('收起骨头'));
    await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
    await macClick(desktop, button('拿起骨头'));
    await expect(button('收起骨头')).toHaveAttribute('aria-pressed', 'true');
    await pointer('escape', previousPointer);
    await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
    record('WindowServer clicks toggle the bone, the dog follows the real cursor to both ends and Escape puts it away');

    await macClick(desktop, button('将浮窗置底'));
    await expect.poll(order).toBe('bottom');
    const before = (await readReceiver()).clicks;
    await pointer('click', { x: win.x + win.width / 2, y: win.y + win.height / 2 });
    await expect.poll(async () => (await readReceiver()).clicks).toBe(before + 1);
    // Dispatch the application menu command without bringing the covered panel
    // forward first. All ordering assertions are WindowServer observations.
    const restored = await desktop.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu()?.items.find(item => item.label === '窗口');
      const command = menu?.submenu?.items.find(item => item.label === '将浮窗置顶');
      if (!command?.enabled) return false;
      command.click();
      return true;
    });
    assert.equal(restored, true);
    await expect.poll(order).toBe('top');
    await expect(button('将浮窗置底')).toBeVisible();
    await macClick(desktop, button('将浮窗置底'));
    await expect.poll(order).toBe('bottom');
    record('Panel switches below a normal application that receives the click, and its native Window menu restores topmost order');
  } finally {
    if (cover.exitCode === null && cover.signalCode === null) {
      const exited = once(cover, 'exit');
      cover.kill();
      await exited;
    }
  }
  // The panel is now exposed on the desktop, and its own button should recover it.
  await macClick(desktop, button('将浮窗置顶'));
  await expect(button('将浮窗置底')).toBeVisible();
  record('The exposed desktop widget can also be brought to the top by a WindowServer click on its own toggle');
  const dragArea = await widget.locator('.widget-middle').boundingBox();
  assert.ok(dragArea);
  await pointer('drag', { x: win.x + (dragArea.x + dragArea.width / 2) * win.scale,
    y: win.y + (dragArea.y + dragArea.height / 2) * win.scale });
  await expect.poll(async () => {
    const moved = await nativeWidget(desktop);
    return Math.abs(moved.x - (win.x - 40)) <= 3 && Math.abs(moved.y - (win.y - 32)) <= 3;
  }).toBe(true);
  await pointer('move', previousPointer);
  record('Dragging the card body through WindowServer moves the native window to the pointer destination');
}
