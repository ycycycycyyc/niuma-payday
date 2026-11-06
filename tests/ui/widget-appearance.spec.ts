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

// Native color pickers cannot be driven consistently across headless browser platforms.
// Dispatch the same input/change events after assigning through the native DOM setter.
async function chooseColor(input: Locator, color: string) {
  await input.evaluate((node, value) => {
    const field = node as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, color);
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
  const tint = dialog.getByLabel('浮窗底色', { exact: true });
  await size.press('End');
  await expect(size).toHaveValue('150');
  await chooseColor(tint, '#cce7fa');
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
  await expect(tint).toHaveValue('#cce7fa');
  await expect(opacity).toHaveValue('100');
  await chooseColor(tint, '#000000');
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
  await expect(tint).toHaveValue(defaults.tint);
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
  await expect(dialog.getByLabel('浮窗底色', { exact: true })).toHaveValue('#e1d9f3');
  await expect(dialog.getByLabel('底色不透明度', { exact: true })).toHaveValue('78');
  await page.reload();
  await page.getByRole('button', { name: '浮窗设置', exact: true }).click();
  await expect(dialog.getByLabel('浮窗底色', { exact: true })).toHaveValue('#e1d9f3');
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
    for (const control of [size, dialog.getByLabel('浮窗底色', { exact: true }), dialog.getByLabel('底色不透明度', { exact: true }), dialog.getByRole('button', { name: '返回浮窗', exact: true })]) {
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
