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
      const win = await native.evaluate(w => ({ ...w.getContentBounds(), zoom:w.webContents.getZoomFactor(), top:w.isAlwaysOnTop(), id:w.getMediaSourceId() }));
      return { x:win.x + frame.x * win.zoom, y:win.y + frame.y * win.zoom, bone:frame.bone, top:win.top, id:win.id };
    } finally { await native.dispose(); }
  }
  return null;
}
export async function verifyDesktopChase(desktop, widget, { click, move, clickThrough, stop, raise, verifyOrder, record }) {
  const button = name => widget.getByRole('button', { name, exact: true });
  const { card, area } = await desktop.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('#/widget'));
    const card = w.getContentBounds();
    return { card, area:screen.getDisplayMatching(card).workArea };
  });
  let target = {
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
  await expect(button('将浮窗置顶')).toBeVisible();
  await expect.poll(() => widget.evaluate(async () => (await window.niuma.getDesktopPetState()).phase)).toBe('chasing');
  const overlay = desktop.windows().find(p => p.url().endsWith('/pet.html'));
  assert.ok(overlay, 'The desktop drawing surface is ready');
  const corners = [75, area.width - 75].flatMap(x => [75, area.height - 75].map(y => ({ x: area.x + x, y: area.y + y })))
    .filter(p => p.x < card.x - 30 || p.x > card.x + card.width + 30 || p.y < card.y - 30 || p.y > card.y + card.height + 30);
  const attempts = [];
  const deadline = Date.now() + 10_000;
  let cadence;
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    if (attempt) {
      const current = await paintedPet(desktop);
      assert.ok(current, 'The dog remains visible before restarting a continuous walking sample');
      target = [...corners].sort((a, b) => Math.hypot(b.x - current.x, b.y - current.y) - Math.hypot(a.x - current.x, a.y - current.y))[0];
      assert.ok(target, 'A distant pointer target exists outside the card');
    }
    await move(target);
    cadence = await overlay.evaluate(timeout => new Promise(resolve => {
      const dog = document.getElementById('desktop-dog');
      const bone = document.getElementById('desktop-bone');
      const menu = document.querySelector('.pet-food-menu');
      const visible = element => Boolean(element && !element.hidden && element.getClientRects().length);
      const requestedAt = performance.now();
      const samples = [];
      let previous;
      let consecutiveMoves = 0;
      let startup;
      let raf;
      let finished = false;
      const finish = (complete, reason) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cancelAnimationFrame(raf);
        const moving = samples.slice(1).filter((s, i) => Math.hypot(s.x - samples[i].x, s.y - samples[i].y) > 0.1);
        const gaps = moving.slice(1).map((s, i) => s.time - moving[i].time).sort((a, b) => a - b);
        resolve({ complete, reason, startup, elapsed: performance.now() - requestedAt,
          moving: moving.length, refreshes: Math.max(0, samples.length - 1), median: gaps[Math.floor(gaps.length / 2)] });
      };
      const timer = setTimeout(() => finish(false, 'walking sample timed out'), timeout);
      function measure(time) {
        const rect = dog.getBoundingClientRect();
        const sample = { time, x: rect.x, y: rect.y };
        const walking = visible(dog) && visible(bone) && !visible(menu) && dog.dataset.feeding !== 'true' && dog.dataset.pose === 'walk';
        if (!walking) {
          // Hovering her now opens a food menu and intentionally pauses pursuit.
          // A pause or arrival ends this sample; try a farther pointer target.
          if (samples.length) { finish(false, 'walking ended at a menu or arrival'); return; }
          consecutiveMoves = 0;
        } else if (!samples.length) {
          consecutiveMoves = previous && Math.hypot(sample.x - previous.x, sample.y - previous.y) > 0.1 ? consecutiveMoves + 1 : 0;
          if (consecutiveMoves >= 2) { startup = performance.now() - requestedAt; samples.push(sample); }
        } else samples.push(sample);
        previous = sample;
        if (samples.length && time - samples[0].time >= 480) { finish(true, 'continuous walking'); return; }
        raf = requestAnimationFrame(measure);
      }
      raf = requestAnimationFrame(measure);
    }), Math.min(2_500, Math.max(1, deadline - Date.now())));
    attempts.push(cadence);
    if (cadence.complete) break;
  }
  assert.ok(cadence?.complete, `No complete continuous walking sample: ${JSON.stringify(attempts)}`);
  assert.ok(cadence.moving >= 3 && cadence.moving >= cadence.refreshes * 0.75, JSON.stringify({ cadence, attempts }));
  record(`after ${cadence.startup.toFixed(1)} ms startup, the desktop dog advanced on ${cadence.moving}/${cadence.refreshes} walking display refreshes, median interval ${cadence.median.toFixed(1)} ms (${attempts.length} sample attempts)`);
  await expect.poll(async () => {
    const pet = await paintedPet(desktop);
    // The visible bone was checked during cadence. At the destination the new
    // feeding menu may legitimately replace it and pause the dog.
    return pet?.top && Math.hypot(pet.x - target.x, pet.y - target.y) < 100;
  }, { timeout:12000 }).toBe(true);
  const outdoors = await paintedPet(desktop);
  if (verifyOrder) await verifyOrder(outdoors);
  assert.ok(outdoors.x < card.x || outdoors.x > card.x + card.width || outdoors.y < card.y || outdoors.y > card.y + card.height);
  await expect(widget.locator('.widget-dog')).toBeHidden();
  const emptyPoint = [-220, 0, 220].flatMap(dx => [-220, 0, 220].map(dy => ({ x: Math.round(outdoors.x + dx), y: Math.round(outdoors.y + dy) })))
    .filter(p => p.x >= area.x + 20 && p.x < area.x + area.width - 20 && p.y >= area.y + 20 && p.y < area.y + area.height - 20)
    .filter(p => Math.hypot(p.x - outdoors.x, p.y - outdoors.y) >= 200)
    .find(p => p.x < card.x - 20 || p.x > card.x + card.width + 20 || p.y < card.y - 20 || p.y > card.y + card.height + 20);
  assert.ok(emptyPoint, 'A transparent point outside the card, dog and food menu exists');
  await clickThrough(emptyPoint);
  record('the dog follows the system pointer beyond the lowered card on a topmost layer; a real click in nearby transparent space outside the dog, food menu and card reaches the other app');

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
  await expect.poll(() => widget.evaluate(async () => (await window.niuma.getDesktopPetState()).phase)).toBe('chasing');
  const control = await button('收起骨头').boundingBox();
  assert.ok(control);
  const controlPoint = await desktop.evaluate(({ BrowserWindow }, box) => {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#/widget'));
    const bounds = win.getContentBounds(), zoom = win.webContents.getZoomFactor();
    return { x: bounds.x + (box.x + box.width / 2) * zoom, y: bounds.y + (box.y + box.height / 2) * zoom };
  }, control);
  await move(controlPoint);
  await expect.poll(async () => {
    const pet = await paintedPet(desktop);
    return pet ? Math.hypot(pet.x - controlPoint.x, pet.y - controlPoint.y) : Infinity;
  }, { timeout: 8000 }).toBeLessThan(35);
  await widget.waitForTimeout(320);
  await click(button('收起骨头'));
  await expect(button('拿起骨头')).toHaveAttribute('aria-pressed', 'false');
  await expect(widget.locator('.widget-dog')).toBeVisible({ timeout:12000 });
  record('the real bone button remains clickable after the feedable desktop dog follows the pointer over the toolbar');
}
