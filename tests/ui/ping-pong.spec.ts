import { test, expect } from '@playwright/test';
import { newPongGame, normalizePongSave, PADDLE_HEIGHT, PONG_CANVAS, PONG_PLAYER_BOUNDS, projectPong, servePong, stepPong } from '../../src/lib/ping-pong';

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
  await page.getByRole('button', { name: '继续比赛', exact: false }).first().press('Enter');
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

test('an unlocked mouse can leave the viewport and re-enter during a rally without pausing or jumping', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Element.prototype, 'requestPointerLock', { value: undefined }));
  const box = await openStoppedClockGame(page);
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.evaluate(() => {
      document.documentElement.addEventListener('pointerleave', event => {
        document.documentElement.dataset.focusedPointerLeave = String(event.isTrusted && document.hasFocus());
      }, { once: true });
    });
    const move = async (x: number, y: number) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
      await page.clock.runFor(48);
    };
    const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
    const surface = page.getByRole('group', { name: '乒乓球操作区' });
    await page.getByRole('button', { name: '开始比赛', exact: true }).click();
    await expect(surface).toHaveAttribute('data-running', 'true');
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
    await page.clock.runFor(32);
    await page.keyboard.press('Space');
    const baseline = await saved();
    await page.keyboard.press('Space');

    await move(-20, -20);
    await expect(page.locator('html')).toHaveAttribute('data-focused-pointer-leave', 'true');
    await expect(surface).toHaveAttribute('data-running', 'true');
    const reentry = { x: box.x + box.width * .84, y: box.y + box.height * .72 };
    await move(reentry.x, reentry.y);
    await expect(surface).toHaveAttribute('data-running', 'true');
    await page.keyboard.press('Space');
    const reentered = await saved();
    expect(reentered.playerX).toBeCloseTo(baseline.playerX, 6);
    expect(reentered.playerY).toBeCloseTo(baseline.playerY, 6);

    await page.keyboard.press('Space');
    const direction = reentered.playerX > 0 ? -1 : 1;
    await move(reentry.x + direction * 10, reentry.y);
    await move(reentry.x + direction * 65, reentry.y);
    await expect(surface).toHaveAttribute('data-running', 'true');
    // Playwright ordinarily emulates focus in all headless tabs. Let Chrome deliver an actual blur.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    const otherTab = await page.context().newPage();
    await otherTab.bringToFront();
    await expect(surface).toHaveAttribute('data-running', 'false');
    expect(await page.evaluate(() => document.hasFocus())).toBe(false);
    const afterStroke = await saved();
    expect((afterStroke.playerX - reentered.playerX) * direction).toBeGreaterThan(.05);
    expect(afterStroke.phase).toBe('rally');
    await otherTab.close();
  } finally { await cdp.detach(); }
});

test('a short window has room below the court and the first move back from the bottom edge raises the racket', async ({ page }) => {
  const height = 700;
  await page.setViewportSize({ width: 720, height });
  await openStoppedClockGame(page);
  const surface = page.locator('.pong-surface');
  await surface.focus();
  await page.keyboard.press('Space');
  await expect(surface).toHaveAttribute('data-running', 'true');
  const box = (await surface.locator('canvas').boundingBox())!;
  const bottom = box.y + box.height;
  expect(height - bottom, 'leave space to swing down before the pointer leaves the page').toBeGreaterThanOrEqual(64);
  const x = Math.round(box.x + box.width / 2);
  const move = async (y: number) => {
    await page.mouse.move(x, Math.round(y));
    await page.clock.runFor(96);
  };
  const pauseAndReadY = async () => {
    await expect(surface).toHaveAttribute('data-running', 'true');
    await page.keyboard.press('Space');
    return page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game.playerY as number, GAME_KEY);
  };
  await move(bottom - 180);
  await move(bottom + 28);
  await page.clock.runFor(96);
  const backEdge = await pauseAndReadY();
  expect(backEdge).toBeCloseTo(PONG_PLAYER_BOUNDS.yMin, 5);
  await page.keyboard.press('Space');
  await move(bottom + 8);
  const toolbarReverse = await pauseAndReadY();
  expect(toolbarReverse).toBeGreaterThan(backEdge + .03);

  await page.keyboard.press('Space');
  await move(height - 4);
  await move(height + 40);
  await expect(surface).toHaveAttribute('data-running', 'true');
  await move(height - 20);
  const firstMoveBack = await pauseAndReadY();
  expect(firstMoveBack).toBeGreaterThan(backEdge + .03);
  // Only the 20 pixels inside the window count. Time spent outside is not a stroke.
  const projected = projectPong(0, firstMoveBack, PADDLE_HEIGHT);
  const edge = projectPong(0, backEdge, PADDLE_HEIGHT);
  expect((edge.y - projected.y) * box.height / PONG_CANVAS.height).toBeLessThan(24);
});

test('a held mouse swings back below a lock-denied embedded game and releasing outside keeps play active', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 840 });
  await page.clock.install();
  await page.route('**/__pong_frame__', route => route.fulfill({
    contentType: 'text/html',
    body: '<iframe title="game" sandbox="allow-scripts allow-same-origin" style="display:block;width:900px;height:580px;border:0" src="/?play=ping-pong"></iframe>',
  }));
  await page.goto('/__pong_frame__');
  const host = page.frameLocator('iframe');
  await host.getByRole('button', { name: '开始比赛', exact: true }).click();
  const surface = host.locator('.pong-surface');
  await expect(surface).toHaveAttribute('data-running', 'true');
  await expect(host.getByRole('status').filter({ hasText: /不能锁定鼠标/ })).toBeVisible();
  const canvas = surface.locator('canvas');
  const frame = page.frames().find(item => item.url().includes('play=ping-pong'))!;
  const frameBox = (await page.locator('iframe').boundingBox())!;
  const box = (await canvas.boundingBox())!;
  const x = box.x + box.width / 2;
  const frameBottom = frameBox.y + frameBox.height;
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 150));
  await canvas.evaluate(el => (el as HTMLCanvasElement).addEventListener('pointermove', event => {
    if (event.isTrusted && event.buttons === 1 && event.clientY > innerHeight)
      el.setAttribute('data-trusted-outside-drag', 'true');
  }));
  const move = async (y: number) => {
    await page.mouse.move(x, y);
    await page.clock.runFor(96);
  };
  await move(box.y + box.height / 2);
  await page.mouse.down();
  await move(frameBottom - 4);
  await move(frameBottom + 80);
  await move(frameBottom + 36);
  await expect(canvas).toHaveAttribute('data-trusted-outside-drag', 'true');
  await page.mouse.up();
  await expect(surface).toHaveAttribute('data-running', 'true');
  await expect(host.getByRole('dialog')).toHaveCount(0);
  await surface.focus();
  await page.keyboard.press('Space');
  const game = await frame.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY);
  expect(game.phase).toBe('rally');
  expect(game.playerY, '44 pixels of upward movement entirely outside must pull the racket off the back edge').toBeGreaterThan(PONG_PLAYER_BOUNDS.yMin + .06);
});

test('restart, keyboard steering and quick exit still work with free pointer input', async ({ page }) => {
  await openStoppedClockGame(page);
  const surface = page.getByRole('group', { name: '乒乓球操作区' });
  await surface.focus();
  await page.keyboard.press('Space');
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
});

test('mouse-started and resumed rallies lock the cursor before a wide stroke reaches the window edge', async ({ page }) => {
  const box = await openStoppedClockGame(page);
  const surface = page.locator('.pong-surface');
  const cdp = await page.context().newCDPSession(page);
  try {
    const snapshots = [];
    for (const label of ['开始比赛', '继续比赛']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect.poll(() => page.evaluate(() =>
        document.pointerLockElement === document.querySelector('.pong-surface canvas'))).toBe(true);
      if (label === '继续比赛') {
        const y = box.y + box.height * .7;
        for (const x of [box.x + box.width / 2, -24, box.x + box.width * .8]) {
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0, pointerType: 'mouse' });
          await page.clock.runFor(240);
          await expect(surface).toHaveAttribute('data-running', 'true');
        }
      }
      await page.keyboard.press('Space');
      await expect(surface).toHaveAttribute('data-running', 'false');
      await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
      snapshots.push(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).game, GAME_KEY));
    }
    expect(Math.abs(snapshots[1].playerX - snapshots[0].playerX)).toBeGreaterThan(.05);
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
      await expect(page.getByRole('status').filter({ hasText: /不能锁定鼠标/ })).toBeVisible();
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
