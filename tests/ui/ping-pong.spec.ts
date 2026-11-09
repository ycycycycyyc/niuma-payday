import { test, expect } from '@playwright/test';
import { newPongGame, normalizePongSave, PADDLE_HEIGHT, PONG_CANVAS, projectPong, servePong, stepPong } from '../../src/lib/ping-pong';

const GAME_KEY = 'niuma.ping-pong.v1';

async function openGame(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '快乐实验室', exact: true }).click();
  await page.getByRole('button', { name: '来打乒乓球', exact: true }).click();
  await expect(page.getByRole('heading', { name: '来一局，乒乓。' })).toBeVisible();
}

test('a missed rally scores, pauses, saves and resumes without touching salary records', async ({ page }) => {
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
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(page.locator('.pong-stats')).toContainText('••••');
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

/** A fixed, legal incoming ball; scores and successful hits are always zero until real browser input changes them. */
function incomingSave() {
  const saved = normalizePongSave(null);
  saved.game = { ...newPongGame('easy'), phase: 'rally', playerX: 0, playerY: .16,
    ball: { x: 0, y: .5, z: PADDLE_HEIGHT, vx: 0, vy: -1.5, vz: .2,
      bounces: 1, hitter: 'computer', serveStage: 'in-play' } };
  return { version: 1, ...saved };
}

async function prepareIncomingBall(page: import('@playwright/test').Page) {
  const initial = new Date('2026-11-09T02:00:00Z');
  await page.clock.install({ time: initial });
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key: GAME_KEY, saved: incomingSave() });
  await openGame(page);
  await page.locator('.pong-surface canvas').scrollIntoViewIfNeeded();
  // React's lazy boundary must reveal the game before virtual timers stop.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-rally', '0');
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-hitter', 'computer');
}

async function mouseAtPaddle(page: import('@playwright/test').Page, x: number, y: number) {
  const box = await page.locator('.pong-surface canvas').boundingBox();
  expect(box).not.toBeNull();
  const point = projectPong(x, y, PADDLE_HEIGHT);
  // Only mouse events drive the paddle; the projection maps its visible painted position to viewport coordinates.
  await page.mouse.move(box!.x + point.x / PONG_CANVAS.width * box!.width,
    box!.y + point.y / PONG_CANVAS.height * box!.height);
}

async function startIncomingBall(page: import('@playwright/test').Page, x = 0) {
  const surface = page.getByRole('group', { name: '乒乓球操作区' });
  await mouseAtPaddle(page, x, .16);
  await surface.focus();
  await page.keyboard.press('Space');
  await expect(surface).toHaveAttribute('data-running', 'true');
  await page.clock.runFor(16);
}

test('a stationary paddle cannot auto-return a legal incoming ball', async ({ page }) => {
  await prepareIncomingBall(page);
  await startIncomingBall(page);
  await page.clock.runFor(1000);
  await expect(page.getByTestId('pong-computer-score')).toHaveText('1');
  await expect(page.getByTestId('pong-player-score')).toHaveText('0');
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-rally', '0');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
  expect(saved.game.ball.hitter).toBe('computer');
  expect(saved.game.rally).toBe(0);
});

test('a real forward mouse stroke contacts the incoming ball and launches a return', async ({ page }) => {
  await prepareIncomingBall(page);
  const payroll = await page.evaluate(() => localStorage.getItem('niuma.payday.v3'));
  await startIncomingBall(page);
  for (const y of [.22, .30, .38, .46]) {
    await mouseAtPaddle(page, 0, y);
    await page.clock.runFor(16);
    if (await page.locator('.pong-surface').getAttribute('data-hitter') === 'player') break;
  }
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-hitter', 'player');
  await expect(page.locator('.pong-surface')).toHaveAttribute('data-rally', '1');
  await page.keyboard.press('Space');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
  expect(saved.game.ball.hitter).toBe('player');
  expect(saved.game.ball.vy).toBeGreaterThan(0);
  expect(saved.game.rally).toBe(1);
  expect(saved.game.player).toBe(0);
  expect(saved.game.computer).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('niuma.payday.v3'))).toBe(payroll);
});

test('a normal computer opening serve can be returned by an actual mouse stroke without a saved-game fixture', async ({ page }) => {
  const initial = new Date('2026-11-09T02:00:00Z');
  await page.clock.install({ time: initial });
  await page.goto('/?play=ping-pong');
  await expect(page.getByRole('heading', { name: '来一局，乒乓。' })).toBeVisible();
  await page.getByRole('combobox', { name: '乒乓球电脑难度' }).selectOption('easy');
  await page.locator('.pong-surface canvas').scrollIntoViewIfNeeded();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  const surface = page.getByRole('group', { name: '乒乓球操作区' });
  await mouseAtPaddle(page, 0, .16);
  await surface.focus();
  await page.keyboard.press('Space');
  await expect(surface).toHaveAttribute('data-running', 'true');

  // Predict only the timing of the deterministic first serve; no product state is injected or replaced.
  let forecast = servePong({ ...newPongGame('easy'), playerY: .16 });
  let frames = 0;
  while (frames < 200 && forecast.phase === 'rally') {
    const ball = forecast.ball;
    if (ball.hitter === 'computer' && ball.serveStage === 'in-play' && ball.bounces === 1 && ball.vy < 0 && ball.y < .8 && ball.y > .5) break;
    forecast = stepPong(forecast, .016, { x: 0, y: .16 });
    frames++;
  }
  expect(forecast.phase).toBe('rally');
  expect(frames).toBeLessThan(200);
  expect(forecast.ball.bounces).toBe(1);
  await page.clock.runFor(frames * 16);
  const interceptX = forecast.ball.x;
  for (const y of [.24, .34, .46, .58, .70]) {
    await mouseAtPaddle(page, interceptX, y);
    await page.clock.runFor(16);
    if (await surface.getAttribute('data-hitter') === 'player') break;
  }
  await expect(surface).toHaveAttribute('data-hitter', 'player');
  await expect(surface).toHaveAttribute('data-rally', '1');
  await page.keyboard.press('Space');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
  expect(saved.game.ball.hitter).toBe('player');
  expect(saved.game.ball.vy).toBeGreaterThan(0);
  expect(saved.game.rally).toBe(1);
  expect(saved.game.player + saved.game.computer).toBe(0);
});
