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

async function openStoppedClockGame(page: import('@playwright/test').Page) {
  await page.clock.install({ time: new Date('2026-11-09T02:00:00Z') });
  await page.goto('/?play=ping-pong');
  await expect(page.getByRole('heading', { name: '来一局，乒乓。' })).toBeVisible();
  await page.locator('.pong-surface canvas').scrollIntoViewIfNeeded();
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
  const box = await page.locator('.pong-surface canvas').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

test('window-wide pointer tracking continues outside the canvas and reverses immediately at the paddle boundary', async ({ page }) => {
  const box = await openStoppedClockGame(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(() => {
      const trace: { trusted: boolean; x: number; y: number; outsideCanvas: boolean }[] = [];
      (window as unknown as { pongPointerTrace: typeof trace }).pongPointerTrace = trace;
      document.addEventListener('pointermove', event => {
        const canvas = document.querySelector('.pong-surface canvas')!.getBoundingClientRect();
        trace.push({ trusted: event.isTrusted, x: event.clientX, y: event.clientY,
          outsideCanvas: event.clientX < canvas.left || event.clientX > canvas.right || event.clientY < canvas.top || event.clientY > canvas.bottom });
      }, { passive: true });
    });
    const move = async (x: number, y: number, wait = 64) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
      await page.clock.runFor(wait);
    };
    const start = projectPong(0, .28, PADDLE_HEIGHT);
    const surface = page.getByRole('group', { name: '乒乓球操作区' });
    const centerX = box.x + box.width / 2;
    const outsideY = box.y - 12;
    const rightX = Math.min(page.viewportSize()!.width - 10, box.x + box.width + 24);
    expect(outsideY).toBeGreaterThan(0);
    // Replay complete independent gestures and read their real paused saves.
    // A boundary reversal is never interrupted by a pause, and no visual color is assumed.
    const trajectory = async (stage: number) => {
      if (stage > 0) {
        await page.getByRole('button', { name: '重新开始', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '重新开始', exact: true }).click();
      }
      await move(box.x + start.x / PONG_CANVAS.width * box.width, box.y + start.y / PONG_CANVAS.height * box.height, 16);
      await surface.focus();
      await page.keyboard.press('Space');
      await page.clock.runFor(16);
      await move(centerX, outsideY, 160);
      if (stage >= 1) await move(rightX, outsideY, 256);
      if (stage >= 2) await move(rightX - 30, outsideY, 64);
      if (stage >= 3) await move(centerX, outsideY, 384);
      if (stage >= 4) await move(centerX, box.y + 5, 64);
      await expect(surface).toHaveAttribute('data-running', 'true');
      await page.keyboard.press('Space');
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
      return { x: saved.game.playerX as number, y: saved.game.playerY as number };
    };
    const outside = await trajectory(0);
    const observed = await page.evaluate(() => (window as unknown as { pongPointerTrace: { trusted: boolean; outsideCanvas: boolean }[] }).pongPointerTrace);
    expect(observed.some(event => event.trusted && event.outsideCanvas)).toBe(true);
    await test.info().attach('outside-canvas-position', { body: JSON.stringify({ box, outside, outsidePoint: { x: centerX, y: outsideY }, trace: observed }, null, 2), contentType: 'application/json' });
    expect(outside.y, 'trusted movement above the canvas must continue moving the racket forward').toBeGreaterThan(.58);
    const edge = await trajectory(1);
    expect(edge.x).toBeGreaterThan(1.05);
    const reversed = await trajectory(2);
    expect(reversed.x, 'the first reverse movement must take effect while the system pointer is still outside the canvas').toBeLessThan(edge.x - .035);
    const beforeReentry = await trajectory(3);
    const afterReentry = await trajectory(4);
    const beforeScreen = projectPong(beforeReentry.x, beforeReentry.y, PADDLE_HEIGHT);
    const afterScreen = projectPong(afterReentry.x, afterReentry.y, PADDLE_HEIGHT);
    expect(Math.abs(afterScreen.x - beforeScreen.x), `vertical re-entry must not teleport: ${JSON.stringify({ beforeReentry, afterReentry, beforeScreen, afterScreen })}`).toBeLessThan(3);
    expect(afterReentry.y).toBeLessThan(beforeReentry.y - .02);
    const trace = await page.evaluate(() => (window as unknown as { pongPointerTrace: { trusted: boolean; outsideCanvas: boolean }[] }).pongPointerTrace);
    expect(trace.some(event => event.trusted && event.outsideCanvas)).toBe(true);
    expect(trace.every(event => event.trusted)).toBe(true);
    await test.info().attach('window-pointer-reversal', { body: JSON.stringify({ edge, reversed, beforeReentry, afterReentry, trace }, null, 2), contentType: 'application/json' });
  } finally { await cdp.detach(); }
});

test('leaving the browser viewport pauses trusted pointer play and normal controls remain available', async ({ page }) => {
  const box = await openStoppedClockGame(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    const center = projectPong(0, .28, PADDLE_HEIGHT);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + center.x / PONG_CANVAS.width * box.width,
      y: box.y + center.y / PONG_CANVAS.height * box.height, buttons: 0, pointerType: 'mouse' });
    const surface = page.getByRole('group', { name: '乒乓球操作区' });
    await surface.focus();
    await page.keyboard.press('Space');
    await page.clock.runFor(32);
    await expect(surface).toHaveAttribute('data-running', 'true');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -20, y: -20, buttons: 0, pointerType: 'mouse' });
    await page.clock.runFor(32);
    await expect(surface).toHaveAttribute('data-running', 'false');
    const left = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: page.viewportSize()!.width - 15, y: 25, buttons: 0, pointerType: 'mouse' });
    await surface.focus();
    await page.keyboard.press('Space');
    await page.clock.runFor(16);
    await page.keyboard.press('Space');
    const reentered = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    expect(reentered.playerX).toBeCloseTo(left.playerX, 6);
    expect(reentered.playerY).toBeCloseTo(left.playerY, 6);
    await page.getByRole('button', { name: '继续比赛', exact: false }).first().click();
    await expect(surface).toHaveAttribute('data-running', 'true');
    await page.getByRole('button', { name: '重新开始', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: '继续这局', exact: true }).click();
    const baseline = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    const horizontal = baseline.playerX > 0 ? 'ArrowLeft' : 'ArrowRight';
    const vertical = baseline.playerY > .35 ? 'ArrowDown' : 'ArrowUp';
    await surface.focus();
    await page.keyboard.press('Space');
    await page.keyboard.down(horizontal);
    await page.keyboard.down(vertical);
    await page.clock.runFor(48);
    await page.keyboard.up(horizontal);
    await page.keyboard.up(vertical);
    await page.keyboard.press('Space');
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
    expect((saved.game.playerX - baseline.playerX) * (horizontal === 'ArrowRight' ? 1 : -1)).toBeGreaterThan(.05);
    expect((saved.game.playerY - baseline.playerY) * (vertical === 'ArrowUp' ? 1 : -1)).toBeGreaterThan(.05);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '今日薪动' })).toBeVisible();
    await expect(page).not.toHaveURL(/play=ping-pong/);
  } finally { await cdp.detach(); }
});

test('optional mouse lock accepts relative movement and releases on pause or Escape', async ({ page }) => {
  const box = await openStoppedClockGame(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(() => {
      const trace: { locked: boolean; trusted: boolean; dx: number; dy: number }[] = [];
      (window as unknown as { pongLockedTrace: typeof trace }).pongLockedTrace = trace;
      document.addEventListener('pointermove', event => trace.push({ locked: Boolean(document.pointerLockElement), trusted: event.isTrusted, dx: event.movementX, dy: event.movementY }), { passive: true });
    });
    const point = projectPong(0, .28, PADDLE_HEIGHT);
    const anchor = { x: box.x + point.x / PONG_CANVAS.width * box.width, y: box.y + point.y / PONG_CANVAS.height * box.height };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...anchor, buttons: 0, pointerType: 'mouse' });
    const surface = page.getByRole('group', { name: '乒乓球操作区' });
    await surface.focus();
    await page.keyboard.press('Space');
    await page.clock.runFor(16);
    await page.keyboard.press('Space');
    const baseline = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    await page.keyboard.press('Space');
    // Keyboard activation provides a real user gesture without moving the racket to the toolbar first.
    await page.getByRole('button', { name: '锁定鼠标', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => page.evaluate(() => Boolean(document.pointerLockElement)
      || document.body.textContent!.includes('当前窗口不能锁定鼠标'))).toBe(true);
    const acquired = await page.evaluate(() => Boolean(document.pointerLockElement));
    if (!acquired) {
      test.info().annotations.push({ type: 'pointer-lock', description: 'Chrome declined pointer lock; the visible whole-window fallback was verified.' });
      await expect(page.getByText('当前窗口不能锁定鼠标，仍可在整页滑动挥拍。', { exact: true })).toBeVisible();
    } else await expect(page.getByRole('button', { name: '鼠标已锁定', exact: true })).toBeDisabled();

    for (const offset of [{ x: 40, y: -15 }, { x: 90, y: -35 }]) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: anchor.x + offset.x, y: anchor.y + offset.y, buttons: 0, pointerType: 'mouse' });
      await page.clock.runFor(32);
    }
    await surface.focus();
    await page.keyboard.press('Space');
    await expect(surface).toHaveAttribute('data-running', 'false');
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    const moved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    const motion = await page.evaluate(() => (window as unknown as { pongLockedTrace: { locked: boolean; trusted: boolean; dx: number; dy: number }[] }).pongLockedTrace);
    expect(Math.hypot(moved.playerX - baseline.playerX, moved.playerY - baseline.playerY), `actual pointer-lock motion: ${JSON.stringify({ acquired, motion })}`).toBeGreaterThan(.05);

    await surface.focus();
    await page.keyboard.press('Space');
    if (acquired) {
      await page.getByRole('button', { name: '锁定鼠标', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(() => Boolean(document.pointerLockElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: '今日薪动' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    const trace = await page.evaluate(() => (window as unknown as { pongLockedTrace: { locked: boolean; trusted: boolean; dx: number; dy: number }[] }).pongLockedTrace);
    await test.info().attach('mouse-lock-result', { body: JSON.stringify({ acquired, baseline: { x: baseline.playerX, y: baseline.playerY }, moved: { x: moved.playerX, y: moved.playerY }, trace }), contentType: 'application/json' });
  } finally { await cdp.detach(); }
});

test.describe('touch strokes', () => {
  test.use({ hasTouch: true });
  test('a real touch stroke returns the ball and lifting a finger keeps the game running', async ({ page }) => {
    await prepareIncomingBall(page);
    const box = await page.locator('.pong-surface canvas').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const point = (y: number) => {
      const projected = projectPong(0, y, PADDLE_HEIGHT);
      return { x: box!.x + projected.x / PONG_CANVAS.width * box!.width, y: box!.y + projected.y / PONG_CANVAS.height * box!.height, id: 1 };
    };
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(.16)] });
      const surface = page.getByRole('group', { name: '乒乓球操作区' });
      await surface.focus();
      await page.keyboard.press('Space');
      await page.clock.runFor(16);
      for (const y of [.22, .30, .38, .46]) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(y)] });
        await page.clock.runFor(16);
        if (await surface.getAttribute('data-hitter') === 'player') break;
      }
      await expect(surface).toHaveAttribute('data-hitter', 'player');
      await expect(surface).toHaveAttribute('data-rally', '1');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(surface).toHaveAttribute('data-running', 'true');
      await page.keyboard.press('Space');
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), GAME_KEY);
      expect(saved.game.ball.hitter).toBe('player');
      expect(saved.game.ball.vy).toBeGreaterThan(0);
    } finally { await cdp.detach(); }
  });
});
