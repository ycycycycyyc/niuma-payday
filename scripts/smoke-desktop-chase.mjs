import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

// Read the painted sprite in desktop DIP, including the actual native window offset.
async function paintedPet(desktop) {
  for (const page of desktop.windows().filter(item => item.url().split('?')[0].endsWith('/pet.html'))) {
    const frame = await page.evaluate(() => {
      const dog = document.getElementById('desktop-dog');
      if (!dog || dog.hidden || !dog.getClientRects().length) return null;
      const r = dog.getBoundingClientRect();
      const bone = document.getElementById('desktop-bone');
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, bone: !!bone && !bone.hidden && !!bone.getClientRects().length };
    }).catch(error => { if (!page.isClosed()) throw error; return null; });
    if (!frame || page.isClosed()) continue;
    const native = await desktop.browserWindow(page);
    try {
      const win = await native.evaluate(w => w.isVisible() ? { ...w.getContentBounds(), zoom:w.webContents.getZoomFactor(), top:w.isAlwaysOnTop() } : null);
      if (win) return { x:win.x + frame.x * win.zoom, y:win.y + frame.y * win.zoom, bone:frame.bone, top:win.top };
    } finally { await native.dispose(); }
  }
  return null;
}
export async function verifyDesktopChase(desktop, widget, { click, move, clickThrough, stop, raise, record }) {
  const button = name => widget.getByRole('button', { name, exact: true });
  const { card, area } = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
    const card = w.getContentBounds();
    return { card, area:screen.getDisplayMatching(card).workArea };
  });
  const target = {
    x: card.x + card.width / 2 > area.x + area.width / 2 ? area.x + 75 : area.x + area.width - 75,
    y: card.y + card.height / 2 > area.y + area.height / 2 ? area.y + 75 : area.y + area.height - 75,
  };
  await widget.evaluate(() => {
    window.__chasePhases = [];
    window.niuma.onDesktopPetState(state => window.__chasePhases.push(state.phase));
  });
  await click(button('拿起骨头'));
  await expect(button('收起骨头')).toHaveAttribute('aria-pressed', 'true');
  await click(button('将浮窗置底'));
  await move(target);
  await expect.poll(async () => {
    const pet = await paintedPet(desktop);
    return pet?.top && pet.bone && Math.hypot(pet.x - target.x, pet.y - target.y) < 100;
  }, { timeout:12000 }).toBe(true);
  const outdoors = await paintedPet(desktop);
  assert.ok(outdoors.x < card.x || outdoors.x > card.x + card.width || outdoors.y < card.y || outdoors.y > card.y + card.height);
  await expect(widget.locator('.widget-dog')).toBeHidden();
  await clickThrough({ x:Math.round(outdoors.x), y:Math.round(outdoors.y) });
  record('the dog follows the system pointer beyond the lowered card on a topmost layer and a click on her reaches the other app');

  await stop();
  await expect.poll(() => widget.evaluate(() => window.__chasePhases.includes('returning'))).toBe(true);
  await expect.poll(async () => {
    const pet = await paintedPet(desktop);
    return !!pet && !pet.bone && pet.top && Math.hypot(pet.x - outdoors.x, pet.y - outdoors.y) > 12;
  }, { intervals:[20, 40, 60] }).toBe(true);
  const moveCard = point => desktop.evaluate(({ BrowserWindow }, { x, y }) => {
    BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget')).setPosition(x, y);
  }, point);
  await moveCard({
    x: card.x + (card.x - area.x > 90 ? -80 : 80),
    y: card.y + (card.y - area.y > 80 ? -65 : 65),
  });
  await expect(widget.locator('.widget-dog')).toBeVisible({ timeout:12000 });
  await expect.poll(() => paintedPet(desktop)).toBe(null);
  assert.equal(await widget.evaluate(() => window.niuma.getWidgetLayer()), 'bottom');
  await expect.poll(() => widget.evaluate(() => window.__chasePhases.at(-1))).toBe('docked');
  record('putting the bone away removes it immediately, the dog runs back on top and rejoins the moved, still-lowered card');
  await moveCard(card);
  await raise();
  await expect(button('将浮窗置底')).toBeVisible();
  await click(button('拿起骨头'));
  await expect(button('收起骨头')).toHaveAttribute('aria-pressed', 'true');
  await click(button('收起骨头'));
  await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
  await expect(widget.locator('.widget-dog')).toBeVisible({ timeout:12000 });
}
