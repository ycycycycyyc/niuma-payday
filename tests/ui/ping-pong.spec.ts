import { test, expect } from '@playwright/test';

async function openGame(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '快乐实验室', exact: true }).click();
  await page.getByRole('button', { name: '来打乒乓球', exact: true }).click();
  await expect(page.getByRole('heading', { name: '来一局，乒乓。' })).toBeVisible();
}

test('a real rally scores, pauses, saves and resumes without touching salary records', async ({ page }) => {
  await openGame(page);
  const payroll = await page.evaluate(() => localStorage.getItem('niuma.payday.v3'));
  await page.screenshot({ path: 'artifacts/preview-v16/ping-pong-desktop.png', fullPage: true });
  const surface = page.getByRole('group', { name: '乒乓球操作区' });
  await page.getByRole('button', { name: '开始比赛', exact: false }).first().click();
  await expect(surface).toHaveAttribute('data-running', 'true');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  await page.keyboard.press('Space');
  await expect(surface).toHaveAttribute('data-running', 'false');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.ping-pong.v1')!));
  expect(saved.game.phase).toBe('rally');
  expect(saved.playedMs).toBeGreaterThan(0);
  const ball = saved.game.ball;
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.ping-pong.v1')!).game.ball)).toEqual(ball);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '今日薪动' })).toBeVisible();
  await openGame(page);
  await expect(surface).toHaveAttribute('data-running', 'false');
  await page.getByRole('button', { name: '继续比赛', exact: false }).first().click();
  const canvas = page.locator('.pong-surface canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds!.x + bounds!.width * .92, bounds!.y + bounds!.height * .8);
  // The normal solver, with a deliberately missed return, must award a point.
  await expect.poll(async () => Number(await page.getByTestId('pong-player-score').textContent()) + Number(await page.getByTestId('pong-computer-score').textContent()), { timeout: 9000 }).toBeGreaterThan(0);
  await expect(surface).toHaveAttribute('data-running', 'false');
  await page.reload();
  await page.getByRole('button', { name: '快乐实验室', exact: true }).click();
  await page.getByRole('button', { name: '来打乒乓球', exact: true }).click();
  expect(Number(await page.getByTestId('pong-player-score').textContent()) + Number(await page.getByTestId('pong-computer-score').textContent())).toBeGreaterThan(0);
  expect(await page.evaluate(() => localStorage.getItem('niuma.payday.v3'))).toBe(payroll);
});

test('backgrounding, opening settings and hiding the game stop active play', async ({ page }) => {
  await openGame(page);
  await page.getByRole('button', { name: '开始比赛', exact: false }).first().click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-running', 'false');
  await page.getByRole('button', { name: '继续比赛', exact: false }).first().click();
  await page.getByRole('button', { name: '工资与偏好设置', exact: true }).click();
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-running', 'false');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '来一局，乒乓。' })).toBeVisible();
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '继续这局', exact: true }).click();
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-phase', 'rally');
});

test('narrow reduced-motion play remains usable and corrupt saves recover safely', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('niuma.ping-pong.v1', '{broken'));
  await page.getByRole('button', { name: '快乐实验室', exact: true }).click();
  await page.getByRole('button', { name: '来打乒乓球', exact: true }).click();
  await expect(page.getByTestId('pong-player-score')).toHaveText('0');
  await page.getByRole('combobox', { name: '乒乓球电脑难度' }).selectOption('easy');
  await expect(page.getByRole('combobox', { name: '乒乓球电脑难度' })).toHaveValue('easy');
  await page.screenshot({ path: 'artifacts/preview-v16/ping-pong-narrow.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '开始比赛', exact: false }).first().click();
  await page.keyboard.press('Space');
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-running', 'false');
});
