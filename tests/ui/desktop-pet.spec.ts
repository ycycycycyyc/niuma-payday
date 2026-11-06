import { expect, test } from '@playwright/test';
import type { DesktopPetState } from '../../src/lib/store';

test('the widget adopts an active chase, accepts a tray recall, and shows just one dog at the landing point', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const listeners = new Set<(state: DesktopPetState) => void>();
    const replies: Array<(value: DesktopPetState) => void> = [];
    window.addEventListener('pet-broadcast', event => {
      for (const cb of listeners) cb((event as CustomEvent<DesktopPetState>).detail);
    });
    window.addEventListener('pet-reply', event => replies.shift()?.((event as CustomEvent<DesktopPetState>).detail));
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'darwin',
      getState: async () => null,
      setState: async (value: unknown) => value,
      onStateChanged: () => () => {},
      getDesktopPetState: async () => ({ phase: 'chasing' }),
      onDesktopPetState(cb: (value: DesktopPetState) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      setDesktopPetMode: () => new Promise<DesktopPetState>(resolve => replies.push(resolve)),
    } });
  });
  await page.goto('/#/widget');
  const lane = page.locator('.widget-pet-lane');
  const dog = lane.locator('.widget-dog');
  const take = page.getByRole('button', { name: '拿起骨头', exact: true });
  const drop = page.getByRole('button', { name: '收起骨头', exact: true });
  const broadcast = (state: DesktopPetState) =>
    page.evaluate(value => window.dispatchEvent(new CustomEvent('pet-broadcast', { detail: value })), state);

  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await expect(lane).toHaveAttribute('data-pet-phase', 'chasing');
  await expect(dog).toBeHidden();
  await expect(page.locator('.pet-held-bone')).toHaveCount(0);

  await broadcast({ phase: 'returning' });
  await expect(take).toHaveAttribute('aria-pressed', 'false');
  await expect(lane).toHaveAttribute('data-pet-phase', 'returning');
  await expect(dog).toBeHidden();
  await take.click();
  await expect(drop).toHaveAttribute('aria-pressed', 'true');
  await broadcast({ phase: 'chasing' });
  await drop.click();
  await broadcast({ phase: 'returning' });
  // Replies to the two button presses may arrive later than the tray broadcast.
  await page.evaluate(() => {
    for (const phase of ['chasing', 'returning']) window.dispatchEvent(new CustomEvent('pet-reply', { detail: { phase } }));
  });
  await expect(take).toHaveAttribute('aria-pressed', 'false');
  await expect(lane).toHaveAttribute('data-pet-phase', 'returning');
  await expect(dog).toBeHidden();

  await broadcast({ phase: 'docked', dockX: 216, facing: -1 });
  await expect(dog).toBeVisible();
  await expect(dog).toHaveAttribute('data-facing', '-1');
  await expect.poll(() => dog.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.left + rect.width / 2;
  })).toBe(216);
});

test('the transparent desktop surface draws only the sprites included in its current frame', async ({ page }) => {
  await page.addInitScript(() => {
    window.petOverlay = { onFrame(cb) {
      const forward = (event: Event) => cb((event as CustomEvent).detail);
      window.addEventListener('pet-frame', forward);
      return () => window.removeEventListener('pet-frame', forward);
    } };
  });
  await page.goto('/pet.html');
  const dog = page.locator('#desktop-dog');
  const bone = page.locator('#desktop-bone');
  await expect(dog).toBeHidden();
  await expect(bone).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: {
    dog: { x: 620, y: 314, size: 76, facing: -1, frame: 3, pose: 'walk' }, bone: { x: 800, y: 550 },
  } })));
  await expect(dog).toHaveAttribute('data-frame', '3');
  await expect(dog).toHaveCSS('pointer-events', 'none');
  expect(await dog.boundingBox()).toEqual({ x: 620, y: 314, width: 76, height: 76 });
  expect(await bone.boundingBox()).toMatchObject({ x: 800, y: 550 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pet-frame', { detail: { dog: null, bone: null } })));
  await expect(dog).toBeHidden();
  await expect(bone).toBeHidden();
});
