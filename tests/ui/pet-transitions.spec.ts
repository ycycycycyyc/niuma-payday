import { expect, test, type Page } from '@playwright/test';

const logicalBox = { x: 100, y: 90, width: 76, height: 76 };
const margin = 28;
const captureBox = {
  x: logicalBox.x - margin, y: logicalBox.y - margin,
  width: logicalBox.width + margin * 2, height: logicalBox.height + margin * 2,
};

type Pose = { pose: string; frame: number };
const bridgePoses = ['bridge-lick', 'bridge-sleep', 'bridge-side', 'bridge-belly', 'bridge-play', 'bridge-turn'];
const samples: Pose[] = [
  ...[0, 3].map(frame => ({ pose: 'walk', frame })),
  ...[0, 2].map(frame => ({ pose: 'lick', frame })),
  ...[0, 1, 3].map(frame => ({ pose: 'roll', frame })),
  ...['sleep', 'sleep-side', 'sleep-belly'].flatMap(pose => [0, 5].map(frame => ({ pose, frame }))),
  ...[0, 6, 11].map(frame => ({ pose: 'play', frame })),
  ...bridgePoses.flatMap(pose => [0, 3, 7].map(frame => ({ pose, frame }))),
];

async function openSurface(page: Page) {
  await page.setViewportSize({ width: 320, height: 260 });
  await page.addInitScript(() => {
    window.petOverlay = {
      onFrame(listener) {
        const forward = (event: Event) => listener((event as CustomEvent).detail);
        window.addEventListener('pet-frame', forward);
        return () => window.removeEventListener('pet-frame', forward);
      },
      firstFramePainted() {}, onPrepare() {}, surfaceReady() {},
      setRestoreTarget(rect) {
        if (rect) document.body.dataset.firstHit = JSON.stringify(rect);
        document.body.dataset.restoreTarget = rect ? 'active' : 'cleared';
      },
      restoreWidget() { document.body.dataset.restores = String(Number(document.body.dataset.restores ?? 0) + 1); },
      setReducedMotion(value) { document.body.dataset.motionPreference = String(value); },
    };
  });
  await page.goto('/pet.html');
  // Decode the actual generated artwork before rasterizing; a missing atlas
  // fails here instead of masquerading as a transparent but aligned sprite.
  await page.evaluate(async () => {
    const sources = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="image"]'));
    await Promise.all(sources.map(async link => {
      const image = new Image();
      image.src = link.href;
      await image.decode();
    }));
  });
}

async function drawFrame(page: Page, value: Pose & { facing?: -1 | 1; interactive?: boolean; reducedMotion?: boolean }) {
  await page.evaluate(({ value, box }) => {
    window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
      sampleTime: performance.now(),
      dog: {
        x: box.x, y: box.y, size: box.width, facing: value.facing ?? 1,
        pose: value.pose, frame: value.frame, vx: 0, vy: 0,
        interactive: value.interactive ?? true, reducedMotion: value.reducedMotion ?? false, feedable: false,
      },
      bone: null, feeding: null, menuOpen: false,
    } }));
    (document.getElementById('desktop-dog') as HTMLButtonElement).blur();
  }, { value, box: logicalBox });
  await expect(page.locator('#desktop-dog')).toHaveAttribute('data-pose', value.pose);
  await expect(page.locator('#desktop-dog')).toHaveAttribute('data-frame', String(value.frame));
}

async function opaqueBounds(page: Page, png: Buffer) {
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), value => value.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    image.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1, count = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] < 128) continue;
      count++;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { left, right, top, bottom, count };
  }, png.toString('base64'));
}

test('painted companion and transition frames share one ground line in both directions', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSurface(page);
  const groundLines: number[] = [];
  let lowest: { ground: number; label: string; png: Buffer } | undefined;
  let highest: { ground: number; label: string; png: Buffer } | undefined;
  for (const facing of [1, -1] as const) {
    for (const sample of samples) {
      const label = `${sample.pose}-${sample.frame}-${facing === 1 ? 'right' : 'left'}`;
      await drawFrame(page, { ...sample, facing, reducedMotion: true });
      // Include transparent space around the logical button. Clipping to the
      // 76px button would hide a sprite that actually extends below its feet.
      const png = await page.screenshot({ clip: captureBox, omitBackground: true, scale: 'css' });
      const pixels = await opaqueBounds(page, png);
      const ground = pixels.bottom - margin;
      try {
        expect(pixels.count, `${label} must contain visible dog pixels`).toBeGreaterThan(150);
        expect(ground, `${label} feet relative to the logical 76px square`).toBeGreaterThanOrEqual(73);
        expect(ground, `${label} feet relative to the logical 76px square`).toBeLessThanOrEqual(76);
        expect(await page.locator('#desktop-dog').boundingBox(), `${label} must retain its logical hit box`).toEqual(logicalBox);
      } catch (error) {
        // Keep successful sampling in memory; retain only a failing frame.
        await testInfo.attach(label, { body: png, contentType: 'image/png' });
        throw error;
      }
      groundLines.push(ground);
      if (!lowest || ground < lowest.ground) lowest = { ground, label, png };
      if (!highest || ground > highest.ground) highest = { ground, label, png };
    }
  }
  try {
    expect(Math.max(...groundLines) - Math.min(...groundLines), 'poses must not move the visible ground line').toBeLessThanOrEqual(2);
  } catch (error) {
    for (const sample of [lowest!, highest!]) await testInfo.attach(sample.label, { body: sample.png, contentType: 'image/png' });
    throw error;
  }
  await expect(page.locator('body')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('#desktop-dog-sprite')).toHaveCSS('pointer-events', 'none');
  const outsideHits = await page.evaluate(box => [
    [box.x - 5, box.y + box.height / 2], [box.x + box.width + 5, box.y + box.height / 2],
    [box.x + box.width / 2, box.y - 5], [box.x + box.width / 2, box.y + box.height + 5],
  ].map(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('#desktop-dog, .pet-food-menu'))), logicalBox);
  expect(outsideHits, 'grounding must not add a transparent input rectangle around the dog').toEqual([false, false, false, false]);
});

test('transition poses remain restorable with reduced motion while legacy chasing stays click-through', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSurface(page);
  const dog = page.locator('#desktop-dog');
  await drawFrame(page, { pose: 'bridge-sleep', frame: 3, reducedMotion: true });
  await expect(dog).toHaveCSS('pointer-events', 'auto');
  await expect(dog).toHaveAttribute('data-reduced-motion', 'true');
  const before = await page.screenshot({ clip: captureBox, omitBackground: true, scale: 'css' });
  await page.waitForTimeout(180);
  const after = await page.screenshot({ clip: captureBox, omitBackground: true, scale: 'css' });
  expect(after.equals(before), 'a reduced-motion bridge frame must not animate without a new state frame').toBe(true);
  const runningEffects = await dog.evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation.playState === 'running' || animation.pending).length);
  expect(runningEffects).toBe(0);
  for (const element of [dog, page.locator('#desktop-dog-sprite')]) {
    const duration = await element.evaluate(node => {
      const css = getComputedStyle(node);
      return {
        animations: css.animationDuration.split(',').map(value => parseFloat(value)),
        transitions: css.transitionDuration.split(',').map(value => parseFloat(value)),
      };
    });
    expect(duration.animations.every(value => value === 0)).toBe(true);
    expect(duration.transitions.every(value => value === 0)).toBe(true);
  }
  await dog.dblclick();
  await expect(page.locator('body')).toHaveAttribute('data-restores', '1');
  await expect(page.locator('body')).toHaveAttribute('data-first-hit', JSON.stringify(logicalBox));
  await expect(page.locator('body')).toHaveAttribute('data-restore-target', 'cleared');
  expect(await dog.boundingBox()).toEqual(logicalBox);

  await drawFrame(page, { pose: 'walk', frame: 2, facing: -1, interactive: false, reducedMotion: false });
  await expect(dog).toHaveCSS('pointer-events', 'none');
  await expect(dog).toBeDisabled();
  expect(await dog.boundingBox()).toEqual(logicalBox);
  const insideHit = await page.evaluate(box => Boolean(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    ?.closest('#desktop-dog')), logicalBox);
  expect(insideHit, 'a legacy chasing dog must let clicks pass through its center').toBe(false);
  await dog.dispatchEvent('dblclick');
  await expect(page.locator('body')).toHaveAttribute('data-restores', '1');
});
