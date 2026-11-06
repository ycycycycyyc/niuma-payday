import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-06T02:00:00Z') });
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { year: 2026, days: [{ date: '2026-01-01', name: '元旦', isOffDay: true }] } }));
});

test('first setup, ticking earnings, privacy, goals, and reload persistence', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('体验模式 · 演示数据')).toBeVisible();
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  await page.getByLabel('月薪', { exact: true }).fill('15120');
  await page.getByLabel('上班时间', { exact: true }).fill('09:00');
  await page.getByLabel('下班时间', { exact: true }).fill('18:00');
  await page.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('80');
  await page.clock.fastForward(60_000);
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('81');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('••••');
  await page.getByRole('button', { name: '编辑小目标' }).click();
  await page.getByLabel('目标名称').fill('电影自由');
  await page.getByLabel('目标金额').fill('99');
  await page.getByRole('button', { name: '就决定是它了' }).click();
  await page.reload();
  await expect(page.getByText('电影自由')).toBeVisible();
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('••••');
  await expect(page.getByText('体验模式 · 演示数据')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a holiday stays off, manual work overrides it, and restoring the calendar turns it off', async ({ page }) => {
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { year: 2026, days: [{ date: '2026-11-06', name: '测试假日', isOffDay: true }] } }));
  await page.goto('/');
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  await page.getByLabel('月薪', { exact: true }).fill('15120');
  await page.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.locator('.calendar-status')).toContainText('测试假日');
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('0');
  await page.getByRole('button', { name: '今天上班', exact: true }).click();
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('80');
  await expect(page.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
  await page.getByRole('button', { name: '隐藏浮窗' }).click();
  await page.getByRole('button', { name: '恢复日历', exact: true }).click();
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('0');
});

test('narrow screen and invalid settings remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  await page.getByLabel('月薪', { exact: true }).fill('-1');
  await page.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.getByLabel('月薪', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '开启悬浮窗' }).click();
  await expect(page.getByRole('region', { name: '工资悬浮窗' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
