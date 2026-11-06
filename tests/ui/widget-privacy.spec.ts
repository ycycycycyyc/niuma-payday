import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('dashboard privacy controls the eye-free widget and survives reload', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T06:30:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T06:30:01Z'));
  await page.goto('/');

  const openWidget = page.getByRole('button', { name: '开启悬浮窗', exact: true });
  const widget = page.getByRole('region', { name: '工资悬浮窗' });
  const widgetAmount = widget.locator('.amount-integer');
  const dashboardAmount = page.locator('.earnings-card .amount-integer');
  await openWidget.click();
  await expect(widgetAmount).toHaveText(/\d/);
  const countdown = widget.locator('.widget-time-value');
  await expect(countdown).toHaveText(/\d{2}:\d{2}:\d{2}/);
  const previousTime = await countdown.innerText();

  await expect(widget.getByRole('button', { name: /^(显示|隐藏)金额$/ })).toHaveCount(0);
  await page.locator('.topbar').getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(widgetAmount).toHaveText('••••');
  await expect(dashboardAmount).toHaveText('••••');
  await expect(widget.locator('.live-amount')).toHaveAttribute('aria-label', '金额已隐藏');
  await page.clock.runFor(1000);
  await expect(countdown).toBeVisible();
  await expect(countdown).toHaveText(/\d{2}:\d{2}:\d{2}/);
  await expect(countdown).not.toHaveText(previousTime);

  await page.reload();
  await expect(dashboardAmount).toHaveText('••••');
  await openWidget.click();
  await expect(widgetAmount).toHaveText('••••');
  await page.locator('.topbar').getByRole('button', { name: '显示金额', exact: true }).click();
  await expect(widgetAmount).toHaveText(/\d/);
  await expect(dashboardAmount).toHaveText(/\d/);
});

test('offline preview reflects privacy changed in the dashboard without an eye button in the widget', async ({ page }) => {
  const previewFile = path.resolve('artifacts/preview/Niuma-Glass-Preview.html');
  await page.goto(pathToFileURL(previewFile).href);
  const widget = page.getByRole('region', { name: '工资悬浮窗' });
  const dashboard = page.frameLocator('iframe[title="主界面演示"]');
  const dashboardAmount = dashboard.locator('.earnings-card .amount-integer');

  await expect(widget.getByRole('button', { name: /^(显示|隐藏)金额$/ })).toHaveCount(0);
  await widget.getByRole('button', { name: '返回主窗口' }).click();
  await dashboard.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await dashboard.getByRole('button', { name: '开启悬浮窗' }).click();
  await expect(widget.locator('.amount-integer')).toHaveText('••••');
  await widget.getByRole('button', { name: '返回主窗口' }).click();
  await expect(dashboardAmount).toHaveText('••••');
  await dashboard.getByRole('button', { name: '显示金额', exact: true }).click();
  await expect(dashboardAmount).toHaveText(/\d/);
  await dashboard.getByRole('button', { name: '开启悬浮窗' }).click();
  await expect(widget.locator('.amount-integer')).toHaveText(/\d/);

  await widget.getByRole('button', { name: '返回主窗口' }).click();
  await dashboard.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await dashboard.getByRole('button', { name: '开启悬浮窗' }).click();
  await expect(widget.locator('.amount-integer')).toHaveText('••••');
  await widget.getByRole('button', { name: '返回主窗口' }).click();
  await expect(dashboardAmount).toHaveText('••••');
});
