import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const preview = path.resolve('artifacts/preview/Niuma-Glass-Preview.html');
const floatingCard = (page: Page) => page.getByRole('region', { name: '工资悬浮窗', exact: true });
const companionDog = (page: Page) => page.getByRole('button', { name: '双击狗狗恢复浮窗', exact: true });

async function position(dog: Locator) {
  const bounds = await dog.boundingBox();
  expect(bounds).not.toBeNull();
  return bounds!;
}

async function minimize(page: Page) {
  await page.getByRole('button', { name: '最小化浮窗', exact: true }).click();
  await expect(floatingCard(page)).toHaveCount(0);
  await expect(companionDog(page)).toBeVisible();
  await expect(page.locator('.widget-dog')).toHaveCount(0);
  await expect(companionDog(page)).toHaveCount(1);
}

async function walkingSegment(page: Page, dog: Locator) {
  let previous = await position(dog);
  let settled = false;
  for (let index = 0; index < 80; index++) {
    await page.clock.runFor(100);
    const current = await position(dog);
    const walking = await dog.getAttribute('data-pose') === 'walk';
    if (!walking) settled = true;
    if (settled && walking && Math.abs(current.x - previous.x) > 2) return { previous, current };
    previous = current;
  }
  throw new Error('The companion did not begin a moving walking segment');
}

test('browser companion keeps moving under the pointer and after a single click, and restores only on double click', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.addInitScript(() => { Math.random = () => 0.6; });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(floatingCard(page)).toBeVisible();
  const cardBefore = await floatingCard(page).boundingBox();
  await minimize(page);
  await page.mouse.move(0, 0);
  const dog = companionDog(page);
  const { previous, current: moving } = await walkingSegment(page, dog);
  expect(Math.hypot(moving.x - previous.x, moving.y - previous.y)).toBeGreaterThan(2);

  // Use live coordinates: a moving dog should not need a locator stability wait.
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
  await page.clock.runFor(160);
  const hovered = await position(dog);
  expect(Math.hypot(hovered.x - moving.x, hovered.y - moving.y)).toBeGreaterThan(2);
  await page.mouse.click(hovered.x + hovered.width / 2, hovered.y + hovered.height / 2);
  await page.clock.runFor(120);
  const clicked = await position(dog);
  expect(Math.hypot(clicked.x - hovered.x, clicked.y - hovered.y)).toBeGreaterThan(1);
  await expect(dog).toBeVisible();
  await expect(floatingCard(page)).toHaveCount(0);
  await page.clock.runFor(700);
  const current = await position(dog);
  await page.mouse.dblclick(current.x + current.width / 2, current.y + current.height / 2);
  await expect(floatingCard(page)).toBeVisible();
  await expect(dog).toHaveCount(0);
  await expect(page.locator('.widget-dog')).toHaveCount(1);
  expect(await floatingCard(page).boundingBox()).toEqual(cardBefore);
  expect(errors).toEqual([]);
});

test('after a drag, a moving companion accepts both clicks at its first trailing-edge position without pausing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.install();
  await page.addInitScript(() => { Math.random = () => 0.6; });
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  const before = await floatingCard(page).boundingBox();
  await minimize(page);
  const dog = companionDog(page);
  const take = await position(dog);
  await page.mouse.move(take.x + take.width / 2, take.y + take.height / 2);
  await page.mouse.down();
  await page.mouse.move(420, 300);
  const held = await position(dog);
  await page.clock.runFor(300);
  expect(await position(dog)).toEqual(held);
  await page.mouse.up();
  expect(held.x + held.width / 2).toBeCloseTo(420, 0);
  expect(held.y + held.height / 2).toBeCloseTo(300, 0);
  const { previous, current } = await walkingSegment(page, dog);
  const point = {
    x: current.x + (current.x > previous.x ? 2 : current.width - 2),
    y: current.y + current.height / 2,
  };
  await page.mouse.click(point.x, point.y);
  await page.clock.runFor(250);
  const moved = await position(dog);
  expect(Math.abs(moved.x - current.x)).toBeGreaterThan(2);
  expect(point.x < moved.x || point.x > moved.x + moved.width).toBe(true);
  await expect(floatingCard(page)).toHaveCount(0);
  await page.mouse.click(point.x, point.y, { clickCount: 2 });
  await expect(floatingCard(page)).toBeVisible();
  expect(await floatingCard(page).boundingBox()).toEqual(before);
  await expect(dog).toHaveCount(0);
  await expect(page.locator('.widget-dog')).toHaveCount(1);
});

test('a minimized companion can be dragged by its feet, dropped and double-clicked at the new location', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  const cardBefore = await position(floatingCard(page));
  await minimize(page);
  const dog = companionDog(page);
  const before = await position(dog);
  const grip = { x: before.width * .7, y: before.height * .9 };
  const destination = { x: 260, y: 210 };
  await page.mouse.move(before.x + grip.x, before.y + grip.y);
  await page.mouse.down();
  await page.mouse.move(destination.x + grip.x, destination.y + grip.y);
  await expect(dog).toHaveAttribute('data-dragging', 'true');
  const held = await position(dog);
  expect(held.x).toBeCloseTo(destination.x, 0);
  expect(held.y).toBeCloseTo(destination.y, 0);
  await page.mouse.up();
  await expect(dog).not.toHaveAttribute('data-dragging', 'true');
  await expect(floatingCard(page)).toHaveCount(0);
  expect(await position(dog)).toEqual(held);
  await dog.dblclick();
  await expect(floatingCard(page)).toBeVisible();
  expect(await position(floatingCard(page))).toEqual(cardBefore);
});

test('offline preview keeps its companion through wallpaper changes and restores the original card position', async ({ page }) => {
  expect(fs.existsSync(preview), 'Build the offline preview before running UI checks').toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(preview).href);
  const card = floatingCard(page);
  await expect(card).toBeVisible();
  const before = await card.boundingBox();
  await minimize(page);
  await expect(page.locator('.preview-scene')).toHaveAttribute('data-view', 'companion');
  await page.getByRole('button', { name: '夜色', exact: true }).click();
  await expect(page.locator('.preview-scene')).toHaveAttribute('data-theme', 'night');
  await expect(companionDog(page)).toBeVisible();
  await page.getByRole('button', { name: '日光', exact: true }).click();
  await expect(page.locator('.preview-scene')).toHaveAttribute('data-theme', 'day');
  await expect(companionDog(page)).toBeVisible();
  await companionDog(page).dblclick();
  await expect(card).toBeVisible();
  expect(await card.boundingBox()).toEqual(before);
  await expect(companionDog(page)).toHaveCount(0);
  await expect(page.locator('.widget-dog')).toHaveCount(1);
});

test('reduced-motion companion stays within a narrow viewport and remains double-click accessible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-11-06T06:00:00Z') });
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await minimize(page);
  const dog = companionDog(page);
  await expect(dog).toHaveAttribute('data-reduced-motion', 'true');
  const before = await position(dog);
  expect(before.x).toBeGreaterThanOrEqual(0);
  expect(before.y).toBeGreaterThanOrEqual(0);
  expect(before.x + before.width).toBeLessThanOrEqual(390);
  expect(before.y + before.height).toBeLessThanOrEqual(700);
  await page.mouse.move(0, 0);
  await page.clock.runFor(5_000);
  expect(await position(dog)).toEqual(before);
  await dog.dblclick();
  await expect(floatingCard(page)).toBeVisible();
  await expect(dog).toHaveCount(0);
  await expect(page.locator('.widget-dog')).toHaveCount(1);
});

test('failed desktop minimization keeps the card and its dog visible and offers a retry', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'win32',
      getState: async () => null,
      setState: async (value: unknown) => value,
      onStateChanged: () => () => {},
      minimizeWidget: async () => {
        calls++;
        document.body.dataset.minimizeCalls = String(calls);
        throw new Error('Desktop surface could not be painted');
      },
    } });
  });
  await page.goto('/#/widget');
  const card = floatingCard(page);
  await expect(card).toBeVisible();
  await page.getByRole('button', { name: '最小化浮窗', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('最小化失败，请重试');
  await expect(card).toBeVisible();
  await expect(page.locator('.widget-dog')).toBeVisible();
  await expect(companionDog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '最小化浮窗', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '最小化浮窗', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-minimize-calls', '2');
  await expect(card).toBeVisible();
  await expect(page.locator('.widget-dog')).toBeVisible();
});
