import { expect, test, type Locator } from '@playwright/test';

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('Expected a visible widget element');
  return bounds;
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T06:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T06:00:01Z'));
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(page.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
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

test('the bone follows the pointer, the dog chases along the ledge, and either control puts the bone away', async ({ page }) => {
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  const dog = page.getByRole('button', { name: '和狗狗握手' });
  const takeBone = card.getByRole('button', { name: '拿起骨头' });
  const putAway = card.getByRole('button', { name: '收起骨头' });
  const marker = page.locator('.pet-held-bone');
  const bounds = await box(card);
  await takeBone.click();
  await expect(putAway).toHaveAttribute('aria-pressed', 'true');
  const right = { x: bounds.x + bounds.width - 4, y: bounds.y + 66 };
  await page.mouse.move(right.x, right.y);
  await page.clock.runFor(3500);
  await expect(marker).toBeVisible();
  const held = await box(marker);
  expect(Math.abs(held.x + held.width / 2 - right.x)).toBeLessThan(40);
  expect(Math.abs(held.y + held.height / 2 - right.y)).toBeLessThan(40);
  const rightDog = await box(dog);
  expect(rightDog.x + rightDog.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
  expect(Math.abs(rightDog.y + rightDog.height - bounds.y)).toBeLessThan(6);
  await expect(dog).toHaveAttribute('data-facing', '1');
  await expect(dog).toHaveAttribute('data-pose', 'wag');
  await page.mouse.move(bounds.x - 64, bounds.y + 45);
  await page.clock.runFor(3500);
  const leftDog = await box(dog);
  expect(leftDog.x).toBeGreaterThanOrEqual(bounds.x - 1);
  expect(rightDog.x - leftDog.x).toBeGreaterThan(bounds.width / 2);
  await expect(dog).toHaveAttribute('data-facing', '-1');
  expect(await box(card)).toEqual(bounds);
  await page.keyboard.press('Escape');
  await expect(takeBone).toHaveAttribute('aria-pressed', 'false');
  await expect(marker).toBeHidden();
  await takeBone.click();
  await putAway.click();
  await expect(takeBone).toHaveAttribute('aria-pressed', 'false');
  await expect(marker).toBeHidden();
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
  expect(await box(card)).toMatchObject({ x: 0, width: 320, height: 200 });
  await card.getByRole('button', { name: '返回主窗口' }).click();
  await expect(card).toHaveCount(0);
});
