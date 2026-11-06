import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(page.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
});

test('dog takes four steps, pauses at the edge, and faces the way it travels', async ({ page }) => {
  const lane = page.locator('.widget-pet-lane');
  const samples = await lane.evaluate(async element => {
    const sprite = element.querySelector('.pet-sprite')!;
    const facing = element.querySelector('.pet-facing')!;
    const card = element.nextElementSibling!.getBoundingClientRect();
    const sheet = new Image();
    const backgroundImage = getComputedStyle(sprite).backgroundImage;
    sheet.src = backgroundImage.slice(5, -2);
    await sheet.decode();

    // Sample the actual CSS timelines without waiting for a full patrol.
    const animations = element.getAnimations({ subtree: true });
    animations.forEach(animation => animation.pause());
    const sample = (time: number) => {
      animations.forEach(animation => { animation.currentTime = time; });
      const rect = sprite.getBoundingClientRect();
      return {
        x: rect.left - card.left,
        rightGap: card.right - rect.right,
        feetAboveCard: card.top - rect.bottom,
        facing: new DOMMatrix(getComputedStyle(facing).transform).a,
        frame: getComputedStyle(sprite).backgroundPositionX,
      };
    };
    return {
      sheetRatio: sheet.naturalWidth / sheet.naturalHeight,
      steps: [50, 250, 450, 650].map(sample),
      arriving: sample(6500), waiting: sample(6850), turning: sample(7600),
      returning: sample(10500), home: sample(14650),
    };
  });

  const { steps, arriving, waiting, turning, returning, home } = samples;
  expect(samples.sheetRatio).toBe(4);
  expect(new Set(steps.map(step => step.frame)).size).toBe(4);
  expect(steps[0].facing).toBe(1);
  expect(steps[0].x).toBeLessThan(steps[3].x);
  expect(arriving.x - steps[0].x).toBeGreaterThan(150);
  expect(waiting).toEqual(arriving);
  expect(turning.x).toBe(arriving.x);
  expect(turning.facing).toBe(-1);
  expect(returning.facing).toBe(-1);
  expect(returning.x).toBeLessThan(turning.x);
  expect(home.x).toBeLessThan(returning.x);
  for (const pose of [...steps, arriving, returning, home]) {
    expect(Math.min(pose.x, pose.rightGap)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(pose.feetAboveCard)).toBeLessThanOrEqual(4);
  }
});

test('quiet dog stays visible while the compact card can be dragged and restored', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 660 });
  const lane = page.locator('.widget-pet-lane');
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  await expect(lane.locator('.pet-sprite')).toBeVisible();
  expect(await lane.evaluate(element => element.getAnimations({ subtree: true }).length)).toBe(0);
  const transparentAreaPassesClicks = await lane.evaluate(element => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.right - 8, box.top + 10);
    return target !== null && !target.closest('.browser-widget-host');
  });
  expect(transparentAreaPassesClicks).toBe(true);

  const bounds = (await card.boundingBox())!;
  await page.mouse.move(bounds.x + 80, bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => lane.boundingBox()).toMatchObject({ x: 0, y: 0 });
  await page.setViewportSize({ width: 320, height: 560 });
  expect(await card.boundingBox()).toMatchObject({ x: 0, width: 320, height: 160 });
  await card.getByRole('button', { name: '返回主窗口' }).click();
  await expect(card).toHaveCount(0);
});
