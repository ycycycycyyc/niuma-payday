import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { paintBackdrop, paintSample } from './widget-optics';

const appearanceKey = 'niuma.widget-appearance.v1';
const defaults = { scale: 1, tint: '#f9dfeb', opacity: .36 };
const previewFile = path.resolve('artifacts/preview/Niuma-Glass-Preview.html');

async function savedAppearance(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), appearanceKey);
}

async function colorInput(dialog: Locator) {
  await dialog.getByRole('button', { name: '自定义底色', exact: true }).click();
  return dialog.getByLabel('浮窗底色', { exact: true });
}

async function chooseColor(dialog: Locator, color: string) {
  const input = await colorInput(dialog);
  await input.fill(color);
  await input.press('Enter');
  await dialog.getByRole('button', { name: '完成选色', exact: true }).click();
}

async function expectColor(dialog: Locator, color: string) {
  await expect(await colorInput(dialog)).toHaveValue(color);
  await dialog.getByRole('button', { name: '完成选色', exact: true }).click();
}

test('widget settings change the rendered size and tint, survive reload and reset to defaults', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(previewFile).href);
  const widget = page.getByRole('region', { name: '工资悬浮窗' });
  await expect(widget).toBeVisible();
  await expect(widget.getByRole('button', { name: /^(显示|隐藏)金额$/ })).toHaveCount(0);
  await expect(widget.locator('.widget-mascot')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '和狗狗握手', exact: true })).toBeVisible();
  const before = (await widget.boundingBox())!;
  await paintBackdrop(page, 'black');
  const pink = await paintSample(widget, .75, .56);

  await widget.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  const size = dialog.getByLabel('浮窗大小', { exact: true });
  const opacity = dialog.getByLabel('底色不透明度', { exact: true });
  await size.press('End');
  await expect(size).toHaveValue('150');
  await chooseColor(dialog, '#cce7fa');
  await opacity.press('End');
  await expect.poll(() => savedAppearance(page)).toEqual({ scale: 1.5, tint: '#cce7fa', opacity: 1 });
  await dialog.getByRole('button', { name: '返回浮窗', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const enlarged = (await widget.boundingBox())!;
  expect(enlarged.width / before.width).toBeCloseTo(1.5, 1);
  expect(enlarged.height / before.height).toBeCloseTo(1.5, 1);
  const blue = await paintSample(widget, .75, .56);
  expect(blue[2]).toBeGreaterThan(blue[0] + 25);
  expect(blue).not.toEqual(pink);

  await page.reload();
  await widget.getByRole('button', { name: '浮窗设置', exact: true }).click();
  await expect(size).toHaveValue('150');
  await expectColor(dialog, '#cce7fa');
  await expect(opacity).toHaveValue('100');
  await chooseColor(dialog, '#000000');
  await expect.poll(() => savedAppearance(page)).toEqual({ scale: 1.5, tint: '#000000', opacity: 1 });
  await dialog.getByRole('button', { name: '返回浮窗', exact: true }).click();
  const gear = widget.getByRole('button', { name: '浮窗设置', exact: true });
  await gear.hover();
  await expect(gear).toHaveCSS('color', 'rgb(255, 245, 251)');
  await expect(gear.locator('svg')).toHaveCSS('color', 'rgb(255, 245, 251)');
  await gear.click();
  await dialog.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect.poll(() => savedAppearance(page)).toEqual(defaults);
  await expect(size).toHaveValue('100');
  await expectColor(dialog, defaults.tint);
  await expect(opacity).toHaveValue('36');
  await dialog.getByRole('button', { name: '返回浮窗', exact: true }).click();
  expect((await widget.boundingBox())!.width).toBeCloseTo(before.width, 0);
});

test('consecutive appearance edits in one event loop preserve both the chosen tint and opacity', async ({ page }) => {
  await page.goto(pathToFileURL(previewFile).href);
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="浅薰衣草"]')!.click();
    const opacity = document.querySelector<HTMLInputElement>('input[aria-label="底色不透明度"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(opacity, '78');
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    opacity.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => savedAppearance(page)).toEqual({ ...defaults, tint: '#e1d9f3', opacity: .78 });
  await expectColor(dialog, '#e1d9f3');
  await expect(dialog.getByLabel('底色不透明度', { exact: true })).toHaveValue('78');
  await page.reload();
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  await expectColor(dialog, '#e1d9f3');
  await expect(dialog.getByLabel('底色不透明度', { exact: true })).toHaveValue('78');
});

test('settings stay usable at scale limits and Escape restores focus to the gear', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(previewFile).href);
  const gear = page.getByRole('button', { name: '浮窗设置', exact: true });
  await gear.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  const size = dialog.getByLabel('浮窗大小', { exact: true });
  for (const key of ['Home', 'End']) {
    await size.press(key);
    for (const control of [size, dialog.getByRole('button', { name: '自定义底色', exact: true }), dialog.getByLabel('底色不透明度', { exact: true }), dialog.getByRole('button', { name: '返回浮窗', exact: true })]) {
      await expect(control).toBeVisible();
      const bounds = (await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(375);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(667);
    }
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(gear).toBeFocused();
});

test('the full color wheel supports pointer dragging, keyboard selection and validated hex input', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(previewFile).href);
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  const hex = await colorInput(dialog);
  const wheel = dialog.getByRole('slider', { name: '全色色轮', exact: true });
  await hex.fill('#ff0000');
  await hex.press('Enter');
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe('#ff0000');
  const bounds = (await wheel.boundingBox())!;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  await page.mouse.move(center.x + bounds.width * .3, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x, center.y - bounds.height * .4, { steps: 5 });
  await page.mouse.up();
  const dragged = await hex.inputValue();
  expect(dragged).toMatch(/^#[0-9a-f]{6}$/);
  expect(dragged).not.toBe('#ff0000');
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe(dragged);

  await wheel.focus();
  await page.keyboard.press('ArrowRight');
  const byKey = await hex.inputValue();
  expect(byKey).not.toBe(dragged);
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe(byKey);
  await page.keyboard.press('ArrowDown');
  await expect(hex).not.toHaveValue(byKey);

  await hex.fill('#336699');
  await hex.press('Enter');
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe('#336699');
  await hex.fill('#zzzzzz');
  await hex.press('Enter');
  expect((await savedAppearance(page)).tint).toBe('#336699');
  await hex.fill('#336699');
  await hex.press('Enter');
  await dialog.getByRole('button', { name: '完成选色', exact: true }).click();
  await expect(wheel).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  await expectColor(dialog, '#336699');
});

test('brightness and white-center selection preserve a usable color after black and white', async ({ page }) => {
  await page.goto(pathToFileURL(previewFile).href);
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  const hex = await colorInput(dialog);
  const wheel = dialog.getByRole('slider', { name: '全色色轮', exact: true });
  const brightness = dialog.getByLabel('颜色明暗', { exact: true });
  await hex.fill('#7f3fd4');
  await hex.press('Enter');
  await brightness.press('Home');
  await expect(hex).toHaveValue('#000000');
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe('#000000');
  await brightness.press('End');
  const colorful = await hex.inputValue();
  const [red, green, blue] = [1, 3, 5].map(index => parseInt(colorful.slice(index, index + 2), 16));
  expect(blue).toBeGreaterThan(red + 30);
  expect(red).toBeGreaterThan(green + 30);
  await wheel.press('Home');
  await expect(hex).toHaveValue('#ffffff');
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe('#ffffff');
  await wheel.press('End');
  const restored = await hex.inputValue();
  expect(restored).not.toBe('#ffffff');
  expect(parseInt(restored.slice(5, 7), 16)).toBeGreaterThan(parseInt(restored.slice(1, 3), 16));
  await expect.poll(async () => (await savedAppearance(page))?.tint).toBe(restored);
  await dialog.getByRole('button', { name: '完成选色', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '自定义底色', exact: true })).toBeVisible();
});

test('desktop appearance reports a failed save without browser fallback and accepts a retry', async ({ page }) => {
  await page.addInitScript(value => {
    let appearance = value;
    let requests = 0;
    const listeners = new Set<(value: typeof appearance) => void>();
    Object.defineProperty(window, '__qaWidgetAppearance', { value: { read: () => appearance, requests: () => requests } });
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'darwin',
      getState: async () => null,
      setState: async (state: unknown) => state,
      onStateChanged: () => () => {},
      getWidgetAppearance: async () => appearance,
      setWidgetAppearance: async (next: typeof appearance) => {
        requests++;
        if (requests === 1) throw new Error('[SAVE_FAILED] ENOSPC');
        appearance = next;
        for (const callback of listeners) callback(appearance);
        return appearance;
      },
      onWidgetAppearanceChanged(callback: (value: typeof appearance) => void) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    } });
  }, defaults);
  await page.goto('/#/widget');
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '浮窗设置', exact: true });
  const opacity = dialog.getByLabel('底色不透明度', { exact: true });
  await opacity.press('Home');
  await expect(dialog.getByRole('alert')).toContainText(/未保存|失败/);
  const nativeAppearance = () => page.evaluate(() => (window as Window & { __qaWidgetAppearance: { read(): unknown } }).__qaWidgetAppearance.read());
  await expect.poll(nativeAppearance).toEqual(defaults);
  expect(await savedAppearance(page)).toBeNull();
  await opacity.press('End');
  await expect.poll(nativeAppearance).toEqual({ ...defaults, opacity: 1 });
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await savedAppearance(page)).toBeNull();
});
