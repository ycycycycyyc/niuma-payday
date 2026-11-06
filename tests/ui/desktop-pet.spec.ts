import { expect, test } from '@playwright/test';
import type { DesktopPetState } from '../../src/lib/store';

test('the widget adopts an active chase, accepts a tray recall, and shows just one dog at the landing point', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const listeners = new Set<(state: DesktopPetState) => void>();
    const replies: Array<(value: DesktopPetState) => void> = [];
    window.addEventListener('pet-broadcast', event => {
      for (const cb of listeners) cb((event as CustomEvent<DesktopPetState>).detail);
    });
    window.addEventListener('pet-reply', event => replies.shift()?.((event as CustomEvent<DesktopPetState>).detail));
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'darwin',
      getState: async () => null,
      setState: async (value: unknown) => value,
      onStateChanged: () => () => {},
      getDesktopPetState: async () => ({ phase: 'chasing' }),
      onDesktopPetState(cb: (value: DesktopPetState) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      setDesktopPetMode: () => new Promise<DesktopPetState>(resolve => replies.push(resolve)),
    } });
  });
  await page.goto('/#/widget');
  const lane = page.locator('.widget-pet-lane');
  const dog = lane.locator('.widget-dog');
  const take = page.getByRole('button', { name: '拿起骨头', exact: true });
  const drop = page.getByRole('button', { name: '收起骨头', exact: true });
  const broadcast = (state: DesktopPetState) =>
    page.evaluate(value => window.dispatchEvent(new CustomEvent('pet-broadcast', { detail: value })), state);

  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await expect(lane).toHaveAttribute('data-pet-phase', 'chasing');
  await expect(dog).toBeHidden();
  await expect(page.locator('.pet-held-bone')).toHaveCount(0);

  await broadcast({ phase: 'returning' });
  await expect(take).toHaveAttribute('aria-pressed', 'false');
  await expect(lane).toHaveAttribute('data-pet-phase', 'returning');
  await expect(dog).toBeHidden();
  await take.click();
  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await broadcast({ phase: 'chasing' });
  await drop.click();
  await broadcast({ phase: 'returning' });
  // Replies to the two button presses may arrive later than the tray broadcast.
  await page.evaluate(() => {
    for (const phase of ['chasing', 'returning']) window.dispatchEvent(new CustomEvent('pet-reply', { detail: { phase } }));
  });
  await expect(take).toHaveAttribute('aria-pressed', 'false');
  await expect(lane).toHaveAttribute('data-pet-phase', 'returning');
  await expect(dog).toBeHidden();

  await broadcast({ phase: 'docked', dockX: 216, facing: -1 });
  await expect(dog).toBeVisible();
  await expect(dog).toHaveAttribute('data-facing', '-1');
  await expect.poll(() => dog.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.left + rect.width / 2;
  })).toBe(216);
});

test('the transparent desktop surface draws only the sprites included in its current frame', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = { firstFramePainted() { window.dispatchEvent(new Event('painted')); }, onFrame(cb) {
      const forward = (event: Event) => cb((event as CustomEvent).detail);
      window.addEventListener('pet-frame', forward);
      return () => window.removeEventListener('pet-frame', forward);
    } };
  });
  await page.goto('/pet.html');
  const dog = page.locator('#desktop-dog');
  const bone = page.locator('#desktop-bone');
  await expect(dog).toBeHidden();
  await expect(bone).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    sampleTime: performance.now(), dog: { x: 620, y: 314, size: 76, facing: -1, frame: 3, pose: 'walk', vx: 0, vy: 0 }, bone: { x: 800, y: 550 },
  } })));
  await expect(dog).toHaveAttribute('data-frame', '3');
  await expect(dog).toHaveCSS('pointer-events', 'none');
  expect(await dog.boundingBox()).toEqual({ x: 620, y: 314, width: 76, height: 76 });
  expect(await bone.boundingBox()).toMatchObject({ x: 800, y: 550 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: { dog: null, bone: null } })));
  await expect(dog).toBeHidden();
  await expect(bone).toBeHidden();
});

test('the first desktop pose is drawn before handoff and movement continues between native cursor samples', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        window.addEventListener('pet-frame', e => listener((e as CustomEvent).detail));
        return () => {};
      },
      onPrepare(listener) { window.addEventListener('prepare', listener); },
      surfaceReady() { document.body.dataset.surface = 'ready'; },
      firstFramePainted() {
        const dog = document.getElementById('desktop-dog')!;
        document.body.dataset.handoff = dog.hidden ? 'hidden' : dog.dataset.pose;
      },
    };
  });
  await page.goto('/pet.html');
  await page.evaluate(() => window.dispatchEvent(new Event('prepare')));
  await expect(page.locator('body')).toHaveAttribute('data-surface', 'ready');
  await expect(page.locator('#desktop-dog')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    sampleTime: 0, handoff: true, dog: { x: 50, y: 100, size: 76, facing: 1, frame: 5, pose: 'paw', vx: 0, vy: 0 }, bone: null,
  } })));
  await expect(page.locator('body')).toHaveAttribute('data-handoff', 'paw');
  await expect(page.locator('#desktop-dog')).toHaveAttribute('data-frame', '5');
  // A stalled native sampler must still produce intermediate positions, then
  // stop after a short, bounded extrapolation instead of drifting forever.
  await page.clock.install({ time: new Date('2026-11-06T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T12:00:01Z'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    sampleTime: 1000, dog: { x: 50, y: 100, size: 76, facing: 1, frame: 1, pose: 'walk', vx: 500, vy: 0 }, bone: null,
  } })));
  const x = async () => (await page.locator('#desktop-dog').boundingBox())!.x;
  await page.clock.runFor(32);
  const intermediate = await x();
  await page.clock.runFor(80);
  expect(intermediate).toBeGreaterThan(50);
  expect(intermediate).toBeLessThan(await x());
  expect(await x()).toBeCloseTo(64);
  await page.clock.runFor(1000);
  expect(await x()).toBeCloseTo(64);
});

test('only the companion dog accepts double-clicks and keyboard restoration', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        window.addEventListener('pet-frame', event => listener((event as CustomEvent).detail));
        return () => {};
      },
      firstFramePainted() {},
      onPrepare() {},
      surfaceReady() {},
      hold() { document.body.dataset.holds = String(Number(document.body.dataset.holds ?? 0) + 1); },
      restoreWidget() { document.body.dataset.restores = String(Number(document.body.dataset.restores ?? 0) + 1); },
    };
  });
  await page.goto('/pet.html');
  const dog = page.getByRole('button', { name: '双击狗狗恢复浮窗' });
  const frame = (interactive: boolean) => page.evaluate(value => window.dispatchEvent(new CustomEvent('pet-frame', {
    detail: { sampleTime: performance.now(), dog: { x: 220, y: 250, size: 76, facing: 1, frame: 3, pose: 'sit', vx: 0, vy: 0, interactive: value }, bone: null },
  })), interactive);

  await frame(true);
  await expect(dog).toHaveCSS('pointer-events', 'auto');
  await expect(page.locator('body')).toHaveCSS('pointer-events', 'none');
  await dog.click();
  await expect(page.locator('body')).toHaveAttribute('data-holds', '1');
  expect(await page.locator('body').getAttribute('data-restores')).toBeNull();
  await dog.dblclick();
  await expect(page.locator('body')).toHaveAttribute('data-holds', '3');
  await expect(page.locator('body')).toHaveAttribute('data-restores', '1');
  await dog.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(page.locator('body')).toHaveAttribute('data-restores', '3');

  await frame(false);
  await expect(page.locator('#desktop-dog')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('#desktop-dog')).toBeDisabled();
  await expect(dog).toHaveCount(0);
  await page.locator('#desktop-dog').dispatchEvent('dblclick');
  await expect(page.locator('body')).toHaveAttribute('data-restores', '3');
});

test('companion artwork includes sleeping poses, all play frames and six transition rows', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        window.addEventListener('pet-frame', event => listener((event as CustomEvent).detail));
        return () => {};
      },
      firstFramePainted() {}, onPrepare() {}, surfaceReady() {},
    };
  });
  await page.goto('/pet.html');
  const dog = page.locator('#desktop-dog');
  const sprite = page.locator('#desktop-dog-sprite');
  const cases = [
    { pose: 'lick', frame: 2, sheet: 'companion', size: '400% 400%', x: 200 / 3, y: 0, asset: 'widget-dog-companion' },
    { pose: 'roll', frame: 2, sheet: 'companion', size: '400% 400%', x: 200 / 3, y: 100, asset: 'widget-dog-companion' },
    { pose: 'sleep', frame: 5, sheet: 'sleep', size: '600% 300%', x: 100, y: 0, asset: 'widget-dog-sleep' },
    { pose: 'sleep-side', frame: 2, sheet: 'sleep', size: '600% 300%', x: 40, y: 50, asset: 'widget-dog-sleep' },
    { pose: 'sleep-belly', frame: 4, sheet: 'sleep', size: '600% 300%', x: 80, y: 100, asset: 'widget-dog-sleep' },
    ...Array.from({ length: 12 }, (_, frame) => ({
      pose: 'play', frame, sheet: 'play', size: '400% 300%', x: frame % 4 * 100 / 3, y: Math.floor(frame / 4) * 50, asset: 'widget-dog-play',
    })),
    ...['bridge-lick', 'bridge-sleep', 'bridge-side', 'bridge-belly', 'bridge-play', 'bridge-turn'].flatMap((pose, row) =>
      [0, 3, 7].map(frame => ({ pose, frame, sheet: 'transitions', size: '800% 600%', x: frame * 100 / 7, y: row * 20, asset: 'widget-dog-transitions' }))),
  ];
  for (const item of cases) {
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
      sampleTime: performance.now(), dog: { x: 220, y: 250, size: 76, facing: 1, frame: value.frame, pose: value.pose, vx: 0, vy: 0, interactive: true }, bone: null,
    } })), { pose: item.pose, frame: item.frame });
    await expect(dog).toHaveAttribute('data-sheet', item.sheet);
    await expect(dog).toHaveAttribute('data-pose', item.pose);
    await expect(dog).toHaveAttribute('data-frame', String(item.frame));
    await expect(sprite).toHaveCSS('background-size', item.size);
    const position = await sprite.evaluate(element => {
      const css = getComputedStyle(element);
      return { x: parseFloat(css.backgroundPositionX), y: parseFloat(css.backgroundPositionY), image: css.backgroundImage };
    });
    expect(position.x).toBeCloseTo(item.x, 3);
    expect(position.y).toBeCloseTo(item.y, 3);
    expect(position.image).toContain(item.asset);
    await expect(page.locator('#desktop-bone')).toBeHidden();
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    sampleTime: performance.now(), dog: { x: 220, y: 250, size: 76, facing: -1, frame: 5, pose: 'paw', vx: 0, vy: 0 }, bone: null,
  } })));
  await expect(dog).toHaveAttribute('data-sheet', 'actions');
  await expect(sprite).toHaveCSS('background-size', '700% 100%');
  await expect(sprite).toHaveCSS('background-position-y', '50%');
  expect(await sprite.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('widget-dog-actions');
});

test('visible companion artwork keeps its feet and center anchored without changing its hit target', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        window.addEventListener('pet-frame', event => listener((event as CustomEvent).detail));
        return () => {};
      },
      firstFramePainted() {}, onPrepare() {}, surfaceReady() {},
    };
  });
  await page.goto('/pet.html');
  const dog = page.locator('#desktop-dog');
  const cases = [
    { pose: 'walk', frame: 2, columns: 4, rows: 1, column: 2, row: 0 },
    { pose: 'sit', frame: 3, columns: 7, rows: 1, column: 3, row: 0 },
    { pose: 'lick', frame: 2, columns: 4, rows: 4, column: 2, row: 0 },
    { pose: 'roll', frame: 3, columns: 4, rows: 4, column: 3, row: 3 },
    { pose: 'sleep', frame: 5, columns: 6, rows: 3, column: 5, row: 0 },
    { pose: 'sleep-side', frame: 3, columns: 6, rows: 3, column: 3, row: 1 },
    { pose: 'sleep-belly', frame: 0, columns: 6, rows: 3, column: 0, row: 2 },
    { pose: 'play', frame: 11, columns: 4, rows: 3, column: 3, row: 2 },
    ...['bridge-lick', 'bridge-sleep', 'bridge-side', 'bridge-belly', 'bridge-play', 'bridge-turn'].flatMap((pose, row) =>
      [0, 7].map(frame => ({ pose, frame, columns: 8, rows: 6, column: frame, row }))),
  ];
  for (const item of cases) for (const facing of [1, -1]) {
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
      sampleTime: performance.now(), dog: { x: 220, y: 250, size: 76, facing: value.facing, frame: value.frame, pose: value.pose, vx: 0, vy: 0, interactive: true }, bone: null,
    } })), { pose: item.pose, frame: item.frame, facing });
    await expect(dog).toHaveAttribute('data-pose', item.pose);
    await expect(dog).toHaveAttribute('data-frame', String(item.frame));
    await expect(dog).toHaveAttribute('data-facing', String(facing));
    expect(await dog.boundingBox()).toEqual({ x: 220, y: 250, width: 76, height: 76 });
    const visible = await page.locator('#desktop-dog-sprite').evaluate(async (element, cell) => {
      const css = getComputedStyle(element);
      const image = new Image();
      image.src = css.backgroundImage.slice(5, -2);
      await image.decode();
      const cropLeft = Math.round(cell.column * image.naturalWidth / cell.columns);
      const cropRight = Math.round((cell.column + 1) * image.naturalWidth / cell.columns);
      const cropTop = Math.round(cell.row * image.naturalHeight / cell.rows);
      const cropBottom = Math.round((cell.row + 1) * image.naturalHeight / cell.rows);
      const width = cropRight - cropLeft;
      const height = cropBottom - cropTop;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, cropLeft, cropTop, width, height, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      let left = width;
      let right = 0;
      let bottom = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4 + 3] >= 128) {
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
      const transform = new DOMMatrix(css.transform);
      return {
        bottom: 38 + transform.d * (bottom / height * 76 - 38) + transform.f,
        center: 38 + transform.a * ((left + right) / 2 / width * 76 - 38) + transform.e,
      };
    }, item);
    expect(Math.abs(visible.bottom - 76 * .98), `${item.pose}/${item.frame} facing ${facing}`).toBeLessThanOrEqual(1);
    expect(Math.abs(visible.center - 38), `${item.pose}/${item.frame} facing ${facing}`).toBeLessThanOrEqual(1);
  }
  // The original chase stays pixel-compatible with its card-to-desktop handoff.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    sampleTime: performance.now(), dog: { x: 220, y: 250, size: 76, facing: -1, frame: 5, pose: 'paw', vx: 0, vy: 0 }, bone: null,
  } })));
  await expect(page.locator('#desktop-dog-sprite')).toHaveAttribute('data-grounded', 'false');
  await expect(page.locator('#desktop-dog-sprite')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
});

test('the desktop surface forwards initial and changed reduced-motion preferences', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame() { return () => {}; },
      firstFramePainted() {}, onPrepare() {}, surfaceReady() {},
      setReducedMotion(reduced) { document.body.dataset.motionPreference = String(reduced); },
    };
  });
  await page.goto('/pet.html');
  await expect(page.locator('body')).toHaveAttribute('data-motion-preference', 'true');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('body')).toHaveAttribute('data-motion-preference', 'false');
});

test('desktop food options are images and both food choices reach only the pet bridge', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        window.addEventListener('pet-frame', event => listener((event as CustomEvent).detail));
        return () => {};
      },
      firstFramePainted() {}, onPrepare() {}, surfaceReady() {},
      feed(food) { document.body.dataset.foodChoice = food; },
    };
  });
  await page.goto('/pet.html');
  const frame = (food: 'kibble' | 'stick' | null, elapsedMs = 0) => page.evaluate(({ food, elapsedMs }) => {
    window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
      sampleTime: performance.now(),
      dog: { x: 1110, y: 8, size: 76, facing: -1, frame: 0, pose: 'stand', vx: 0, vy: 0, feedable: true },
      bone: null, menuOpen: food === null, feeding: food ? { food, elapsedMs } : null,
    } }));
  }, { food, elapsedMs });
  const menu = page.locator('.pet-food-menu');
  await frame(null);
  await expect(menu).toBeVisible();
  expect((await menu.textContent())?.trim()).toBe('');
  const menuBounds = await menu.boundingBox();
  expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(1240);
  await page.getByRole('button', { name: '喂狗粮', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-food-choice', 'kibble');
  await frame('kibble', 800);
  await expect(menu).toBeHidden();
  await expect(page.locator('#desktop-dog')).toHaveAttribute('data-feeding', 'true');
  await expect(page.locator('#desktop-dog')).toHaveCSS('background-image', 'none');
  const eating = page.locator('.pet-feeding-sprite');
  await expect(eating).toBeVisible();
  const firstFrame = await eating.evaluate(element => getComputedStyle(element).backgroundPosition);
  await frame('kibble', 1100);
  await expect.poll(() => eating.evaluate(element => getComputedStyle(element).backgroundPosition)).not.toBe(firstFrame);
  await frame(null);
  await expect(eating).toBeHidden();
  await page.getByRole('button', { name: '喂棒棒', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-food-choice', 'stick');
  await frame('stick', 1000);
  await expect(eating).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: { dog: null, bone: null } })));
  await expect(menu).toBeHidden();
  await expect(eating).toBeHidden();
});
