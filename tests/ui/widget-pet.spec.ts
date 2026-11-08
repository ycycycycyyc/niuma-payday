import { expect, test, type Locator, type Page } from '@playwright/test';

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Expected a visible widget element');
  return bounds;
}

async function moveCard(page: Page, card: Locator, x: number, y: number) {
  const from = await box(card);
  await page.mouse.move(from.x + 55, from.y + 24);
  await page.mouse.down();
  await page.mouse.move(x + 55, y + 24, { steps: 7 });
  await page.mouse.up();
  await page.clock.runFor(32);
}

async function expectDocked(card: Locator, dog: Locator, roaming: Locator) {
  await expect(roaming).toBeHidden();
  await expect(dog).toBeVisible();
  const [home, bounds] = await Promise.all([box(dog), box(card)]);
  expect(home.x).toBeGreaterThanOrEqual(bounds.x - 1);
  expect(home.x + home.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  expect(Math.abs(home.y + home.height - bounds.y)).toBeLessThan(8);
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T06:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T06:00:01Z'));
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(page.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.clock.runFor(64);
});

test('clicking the moving dog plays a seated handshake and returns to walking', async ({ page }) => {
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const sprite = dog.locator('.pet-sprite');
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const cardBefore = await box(card);
  const dogBefore = await box(dog);
  // A real pointer click, sampled while the application clock is frozen between frames.
  await page.mouse.click(dogBefore.x + dogBefore.width / 2, dogBefore.y + dogBefore.height / 2);
  await expect(dog).not.toBeFocused();
  await expect(dog).toHaveCSS('outline-style', 'none');
  const poses: string[] = [];
  const renderedFrames = new Set<string>();
  for (const ms of [100, 210, 210, 300]) {
    await page.clock.runFor(ms);
    poses.push((await dog.getAttribute('data-pose'))!);
    renderedFrames.add(await sprite.evaluate(el => {
      const css = getComputedStyle(el);
      return css.backgroundImage + ' ' + css.backgroundPosition;
    }));
  }
  expect(poses).toEqual(['crouch', 'sit', 'lift', 'paw']);
  expect(renderedFrames.size).toBeGreaterThan(1);
  const decoded = await sprite.evaluate(async el => {
    const url = getComputedStyle(el).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1];
    if (!url) return false;
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth > 0 && img.naturalHeight > 0;
  });
  expect(decoded).toBe(true);
  expect(await box(card)).toEqual(cardBefore);
  expect(Math.abs((await box(dog)).x - dogBefore.x)).toBeLessThan(2);
  await page.clock.runFor(1750);
  await expect(dog).toHaveAttribute('data-pose', 'walk');
});

test('the browser dog follows the bone in two dimensions outside the card and either control returns it home', async ({ page }) => {
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const dog = page.locator('.widget-dog');
  const roaming = page.locator('.browser-chasing-dog');
  const takeBone = card.getByRole('button', { name: '拿起骨头' });
  const putAway = card.getByRole('button', { name: '收起骨头' });
  const marker = page.locator('.pet-held-bone');
  await moveCard(page, card, 432, 320);
  const bounds = await box(card);
  await takeBone.click();
  await page.clock.runFor(64);
  await expect(roaming).toBeVisible();
  await expect(putAway).toHaveAttribute('aria-pressed', 'true');
  await expect(dog).toBeHidden();
  await expect(roaming).toHaveAttribute('role', 'img');
  await expect(roaming).toHaveAttribute('aria-label', '追骨头的狗狗');
  expect(await roaming.evaluate(element => element.closest('.widget-shell'))).toBeNull();
  for (const point of [
    { side: 'left', x: bounds.x - 180, y: bounds.y + 60 },
    { side: 'right', x: bounds.x + bounds.width + 180, y: bounds.y + 60 },
    { side: 'above', x: bounds.x + bounds.width / 2, y: bounds.y - 180 },
    { side: 'below', x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 180 },
    { side: 'corner', x: 0, y: 0 },
    { side: 'corner', x: 1239, y: 839 },
  ]) {
    await page.mouse.move(point.x, point.y);
    await page.clock.runFor(4000);
    await expect(roaming).toBeVisible();
    const chased = await box(roaming);
    expect(chased.x).toBeGreaterThanOrEqual(-1);
    expect(chased.y).toBeGreaterThanOrEqual(-1);
    expect(chased.x + chased.width).toBeLessThanOrEqual(1241);
    expect(chased.y + chased.height).toBeLessThanOrEqual(841);
    if (point.side === 'left') expect(chased.x + chased.width).toBeLessThan(bounds.x - 20);
    if (point.side === 'right') expect(chased.x).toBeGreaterThan(bounds.x + bounds.width + 20);
    if (point.side === 'above') expect(chased.y + chased.height).toBeLessThan(bounds.y - 20);
    if (point.side === 'below') expect(chased.y).toBeGreaterThan(bounds.y + bounds.height + 20);
    await expect(marker).toBeVisible();
    const held = await box(marker);
    expect(Math.abs(held.x + held.width / 2 - point.x)).toBeLessThan(40);
    expect(Math.abs(held.y + held.height / 2 - point.y)).toBeLessThan(40);
  }
  expect(await box(card)).toEqual(bounds);
  await page.keyboard.press('Escape');
  await expect(takeBone).toHaveAttribute('aria-pressed', 'false');
  await expect(marker).toBeHidden();
  await page.clock.runFor(5000);
  await expectDocked(card, dog, roaming);
  await takeBone.click();
  await page.clock.runFor(64);
  await page.mouse.move(160, 150);
  await page.clock.runFor(1600);
  await putAway.click();
  await expect(takeBone).toHaveAttribute('aria-pressed', 'false');
  await expect(marker).toBeHidden();
  await page.clock.runFor(5000);
  await expectDocked(card, dog, roaming);

  await takeBone.click();
  await page.clock.runFor(64);
  await card.getByRole('button', { name: '最小化浮窗', exact: true }).click();
  await page.clock.runFor(500);
  await expect(roaming).toHaveCount(0);
  await expect(marker).toHaveCount(0);
  await expect(card).toHaveCount(0);
  const companion = page.getByRole('button', { name: '双击狗狗恢复浮窗', exact: true });
  await expect(companion).toBeVisible();
  await companion.dblclick();
  await page.clock.runFor(64);
  await expect(card).toBeVisible();
  await expect(dog).toBeVisible();
  await expect(page.locator('.browser-chasing-dog:visible')).toHaveCount(0);
  await expect(page.locator('.widget-dog:visible')).toHaveCount(1);
});

test('taking the bone again interrupts the return and dragging or resizing updates the landing ledge', async ({ page }) => {
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const dog = page.locator('.widget-dog');
  const roaming = page.locator('.browser-chasing-dog');
  const takeBone = card.getByRole('button', { name: '拿起骨头', exact: true });
  await moveCard(page, card, 432, 320);
  await takeBone.click();
  await expect(roaming).toBeVisible();
  await page.mouse.move(100, 100);
  await page.clock.runFor(3000);
  await card.getByRole('button', { name: '收起骨头', exact: true }).click();
  await page.clock.runFor(32);
  await expect(roaming).toBeVisible();
  await takeBone.click();
  await page.clock.runFor(64);
  await expect(card.getByRole('button', { name: '收起骨头', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(roaming).toHaveCount(1);
  await expect(dog).toBeHidden();
  await moveCard(page, card, 300, 230);
  await card.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  await settings.getByLabel('浮窗大小', { exact: true }).press('End');
  await settings.getByRole('button', { name: '返回浮窗', exact: true }).click();
  await page.clock.runFor(64);
  expect((await box(card)).width).toBeCloseTo(376 * 1.5, 0);
  await page.keyboard.press('Escape');
  await page.clock.runFor(5000);
  await expectDocked(card, dog, roaming);
  await expect(page.locator('.browser-chasing-dog:visible')).toHaveCount(0);
  await expect(page.locator('.widget-dog:visible')).toHaveCount(1);
});

test('reduced motion places the browser dog at the pointer and returns it immediately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const dog = page.locator('.widget-dog');
  const roaming = page.locator('.browser-chasing-dog');
  await moveCard(page, card, 432, 320);
  await card.getByRole('button', { name: '拿起骨头', exact: true }).click();
  await page.mouse.move(100, 90);
  await page.clock.runFor(32);
  await expect(roaming).toBeVisible();
  await expect(dog).toBeHidden();
  const placed = await box(roaming);
  expect(Math.abs(placed.x + placed.width / 2 - 100)).toBeLessThan(100);
  expect(Math.abs(placed.y + placed.height / 2 - 90)).toBeLessThan(100);
  await page.clock.runFor(1000);
  expect(await box(roaming)).toEqual(placed);
  await page.keyboard.press('Escape');
  await page.clock.runFor(32);
  await expectDocked(card, dog, roaming);
  await expect(page.locator('.pet-held-bone')).toBeHidden();
});

test('hovering pauses the dog and offers image-only food choices that play a full meal', async ({ page }) => {
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const menu = page.locator('.pet-food-menu');
  const eating = page.locator('.pet-feeding-sprite');
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const cardBefore = await box(card);
  await dog.hover();
  await page.clock.runFor(32);
  await expect(menu).toBeVisible();
  expect((await menu.textContent())?.trim()).toBe('');
  const stopped = await box(dog);
  await page.clock.runFor(700);
  expect(await box(dog)).toEqual(stopped);
  for (const [food, label] of [['kibble', '喂狗粮'], ['stick', '喂棒棒']] as const) {
    await page.getByRole('button', { name: label, exact: true }).hover();
    await page.clock.runFor(350);
    await expect(menu).toBeVisible();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.clock.runFor(32);
    await expect(menu).toBeHidden();
    await expect(eating).toBeVisible();
    await expect(eating).toHaveAttribute('data-food', food);
    await expect(dog.locator('.pet-sprite')).toHaveCSS('visibility', 'hidden');
    const frames = new Set<string>();
    for (let i = 0; i < 5; i++) {
      await page.clock.runFor(150);
      frames.add((await eating.getAttribute('data-frame'))!);
      expect(await box(dog)).toEqual(stopped);
    }
    expect(frames.size).toBeGreaterThan(2);
    await page.mouse.move(cardBefore.x + 180, cardBefore.y + 120);
    await page.clock.runFor(3000);
    await expect(eating).toHaveAttribute('data-stage', 'happy');
    await expect(eating).toHaveAttribute('data-portion', '0.00');
    await page.clock.runFor(600);
    await expect(eating).toBeHidden();
    await expect(dog.locator('.pet-sprite')).toHaveCSS('visibility', 'visible');
    await expect(dog).toHaveAttribute('data-pose', 'walk');
    if (food === 'kibble') {
      await dog.hover();
      await page.clock.runFor(32);
      await expect(menu).toBeVisible();
      // Remember the newly paused position after the first meal resumes patrol.
      Object.assign(stopped, await box(dog));
    }
  }
  expect(await box(card)).toEqual(cardBefore);
  await dog.hover();
  await page.clock.runFor(32);
  await expect(menu).toBeVisible();
  await page.mouse.move(cardBefore.x + 180, cardBefore.y + 120);
  expect(await menu.isHidden()).toBe(true);
  await page.clock.runFor(32);
  await expect(menu).toBeHidden();
});

test('leaving the dog dismisses food choices immediately and resumes patrol within the next frames', async ({ page }) => {
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const menu = page.locator('.pet-food-menu');
  const card = await box(page.getByRole('region', { name: '工资悬浮窗' }));
  await dog.hover();
  await page.clock.runFor(32);
  await expect(menu).toBeVisible();
  const stopped = await box(dog);
  await page.mouse.move(card.x + 180, card.y + 120);
  // The paused clock has not advanced a frame or a 240 ms close timer.
  expect(await menu.isHidden()).toBe(true);
  await expect(dog).toHaveAttribute('aria-expanded', 'false');
  await page.clock.runFor(32);
  expect(Number(await dog.getAttribute('data-speed'))).toBeGreaterThan(0);
  await page.clock.runFor(32);
  expect(Math.abs((await box(dog)).x - stopped.x)).toBeGreaterThan(0.1);
});

test('crossing the short gap from the dog to its food menu keeps the choices usable', async ({ page }) => {
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const menu = page.locator('.pet-food-menu');
  await dog.hover();
  await page.clock.runFor(32);
  const paused = await box(dog);
  const choices = await box(menu);
  const gapX = choices.x >= paused.x + paused.width
    ? (paused.x + paused.width + choices.x) / 2
    : (choices.x + choices.width + paused.x) / 2;
  const gapY = (Math.max(paused.y, choices.y) + Math.min(paused.y + paused.height, choices.y + choices.height)) / 2;
  await page.mouse.move(paused.x + paused.width / 2, gapY);
  await page.mouse.move(gapX, gapY);
  await page.clock.runFor(64);
  await expect(menu).toBeVisible();
  expect(await box(dog)).toEqual(paused);
  await page.getByRole('button', { name: '喂棒棒', exact: true }).click();
  await page.clock.runFor(32);
  await expect(menu).toBeHidden();
  await expect(dog).toHaveAttribute('data-feeding', 'true');
  await expect(page.locator('.pet-feeding-sprite')).toHaveAttribute('data-food', 'stick');
});

test('native pointer updates dismiss the menu on the first outside sample and release its reported hit area', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'win32', getState: async () => null, setState: async (value: unknown) => value,
      onStateChanged: () => () => {},
      setWidgetPet(state: { menu: unknown }) { document.body.dataset.reportedMenu = JSON.stringify(state.menu); },
      onWidgetPointer(listener: (point: { x: number; y: number }) => void) {
        const receive = (event: Event) => listener((event as CustomEvent).detail);
        window.addEventListener('test-widget-pointer', receive);
        return () => window.removeEventListener('test-widget-pointer', receive);
      },
    } });
  });
  // A new query forces a full navigation so the native bridge init script runs.
  await page.goto('/?native-pointer-test#/widget');
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const menu = page.locator('.pet-food-menu');
  await dog.hover();
  await page.clock.runFor(32);
  await expect(menu).toBeVisible();
  expect(JSON.parse(await page.locator('body').getAttribute('data-reported-menu') ?? 'null')).toMatchObject({
    left: expect.any(Number), top: expect.any(Number), width: expect.any(Number), height: expect.any(Number),
  });
  const card = await box(page.getByRole('region', { name: '工资悬浮窗' }));
  const stopped = await box(dog);
  for (let sample = 0; sample < 4; sample++) {
    await page.evaluate(point => window.dispatchEvent(new CustomEvent('test-widget-pointer', { detail: point })),
      { x: card.x + 160 + sample * 8, y: card.y + 120 });
    // Continuing 24 ms samples must never defer closure until the pointer rests.
    expect(await menu.isHidden()).toBe(true);
    expect(await page.locator('body').getAttribute('data-reported-menu')).toBe('null');
    await page.clock.runFor(24);
  }
  expect(Math.abs((await box(dog)).x - stopped.x)).toBeGreaterThan(0.1);
});

test('food options work with the keyboard, reduced motion and a narrow window edge', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 560 });
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const menu = page.locator('.pet-food-menu');
  await dog.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: '喂狗粮', exact: true })).toBeFocused();
  const bounds = await box(menu);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await page.clock.runFor(32);
  await expect(menu).toBeHidden();
  await expect(dog).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '喂棒棒', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.clock.runFor(800);
  const eating = page.locator('.pet-feeding-sprite');
  const frame = await eating.getAttribute('data-frame');
  await page.clock.runFor(800);
  await expect(eating).toHaveAttribute('data-frame', frame!);
  await page.clock.runFor(2800);
  await expect(eating).toBeHidden();
  await expect(dog).toHaveAttribute('data-pose', 'stand');
  await dog.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: '喂狗粮', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '喂棒棒', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await menu.isHidden()).toBe(true);
});

test('reduced motion keeps the dog steady, keyboard handshake works and dragging still respects the narrow screen', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 660 });
  const lane = page.locator('.widget-pet-lane');
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  await page.clock.runFor(80);
  const resting = await box(dog);
  await page.clock.runFor(1200);
  expect(await box(dog)).toEqual(resting);
  await dog.focus();
  await page.keyboard.press('Enter');
  expect(await dog.evaluate(el => getComputedStyle(el, '::after').height)).toBe('5px');
  await page.clock.runFor(800);
  await expect(dog).toHaveAttribute('data-pose', 'paw');
  expect(await box(dog)).toEqual(resting);
  const transparentAreaPassesClicks = await lane.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const target = document.elementFromPoint(bounds.left + 2, bounds.top + 1);
    return target !== null && !target.closest('.browser-widget-host');
  });
  expect(transparentAreaPassesClicks).toBe(true);

  const bounds = await box(card);
  const button = await box(card.getByRole('button', { name: '拿起骨头' }));
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2);
  await page.mouse.down();
  await page.mouse.move(button.x - 45, button.y - 35, { steps: 3 });
  await page.mouse.up();
  expect(await box(card)).toEqual(bounds);
  await page.mouse.move(bounds.x + 80, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => lane.boundingBox()).toMatchObject({ x: 0, y: 0 });
  await page.setViewportSize({ width: 320, height: 560 });
  expect(await box(card)).toMatchObject({ x: 0, width: 320 });
  expect((await box(card)).height).toBeCloseTo(200 * 320 / 376, 1);
  await card.getByRole('button', { name: '返回主窗口' }).click();
  await expect(card).toHaveCount(0);
});
