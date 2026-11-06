import { expect, test } from '@playwright/test';

test('the Mac widget reflects the saved layer, its own button and the menu command', async ({ page }) => {
  await page.addInitScript(() => {
    let layer: 'top' | 'bottom' = 'bottom';
    const listeners = new Set<(value: 'top' | 'bottom') => void>();
    const setLayer = async (value: 'top' | 'bottom') => {
      layer = value;
      for (const listener of listeners) listener(layer);
      return layer;
    };
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'darwin',
      getState: async () => null,
      setState: async (state: unknown) => state,
      onStateChanged: () => () => {},
      getWidgetLayer: async () => layer,
      setWidgetLayer: setLayer,
      onWidgetLayerChanged(callback: (value: 'top' | 'bottom') => void) {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    } });
  });
  await page.goto('/#/widget');
  const raise = page.getByRole('button', { name: '将浮窗置顶', exact: true });
  const lower = page.getByRole('button', { name: '将浮窗置底', exact: true });
  await expect(raise).toBeVisible();
  await raise.click();
  await expect(lower).toBeVisible();
  await lower.focus();
  await page.keyboard.press('Enter');
  await expect(raise).toBeVisible();
  expect(await page.evaluate(() => window.niuma!.getWidgetLayer!())).toBe('bottom');
  // The menu changes the native state while the widget has no keyboard focus.
  await page.evaluate(() => window.niuma!.setWidgetLayer!('top'));
  await expect(lower).toBeVisible();
});
