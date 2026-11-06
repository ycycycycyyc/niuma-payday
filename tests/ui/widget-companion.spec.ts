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

test('browser widget leaves one autonomous dog, pauses on hover, and restores only on double click', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(floatingCard(page)).toBeVisible();
  const cardBefore = await floatingCard(page).boundingBox();
  await minimize(page);
  await page.mouse.move(0, 0);
  const dog = companionDog(page);
  const origin = await position(dog);
  await expect.poll(async () => {
    const current = await position(dog);
    return Math.hypot(current.x - origin.x, current.y - origin.y);
  }, { timeout: 5_000 }).toBeGreaterThan(8);

  // Move straight to the live coordinates; a moving dog need not satisfy a
  // locator's pre-hover stability check before it can be paused by the pointer.
  const moving = await position(dog);
  await page.mouse.move(moving.x + moving.width / 2, moving.y + moving.height / 2);
  await page.waitForTimeout(80);
  const held = await position(dog);
  await page.waitForTimeout(220);
  const still = await position(dog);
  expect(Math.hypot(still.x - held.x, still.y - held.y)).toBeLessThan(2);
  await dog.click();
  await expect(dog).toBeVisible();
  await expect(floatingCard(page)).toHaveCount(0);
  await dog.dblclick();
  await expect(floatingCard(page)).toBeVisible();
  await expect(dog).toHaveCount(0);
  await expect(page.locator('.widget-dog')).toHaveCount(1);
  expect(await floatingCard(page).boundingBox()).toEqual(cardBefore);
  expect(errors).toEqual([]);
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
