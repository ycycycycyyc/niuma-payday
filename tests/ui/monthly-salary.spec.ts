import { expect, test } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/salary';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T02:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**', route => {
    const year = Number(new URL(route.request().url()).pathname.match(/(\d{4})\.json$/)?.[1]);
    return route.fulfill({ json: { year, days: [
      { date: `${year}-01-01`, name: '元旦', isOffDay: true },
      { date: `${year}-11-30`, name: '测试月末假日', isOffDay: true },
      { date: `${year}-11-07`, name: '测试调休补班', isOffDay: false },
    ] } });
  });
  await page.route('https://www.1823.gov.hk/**', route => route.fulfill({ json: { vcalendar: [{ vevent: [
    { dtstart: ['20261106'], summary: '测试香港假日' },
    { dtstart: ['20270101'], summary: '一月一日' },
  ] }] } }));
});

test('HKD and mainland holidays are independent, with matching dashboard and widget earnings', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('月薪', { exact: true }).fill('21000');
  await dialog.getByLabel('币种', { exact: true }).selectOption('HKD');
  await expect(dialog.getByLabel('节假日地区')).toHaveValue('CN');
  await expect(dialog.getByLabel('发薪方式')).toHaveValue('last-workday');
  await expect(dialog.locator('.schedule-summary')).toContainText(['本月', '周末（含调休补班）默认不开启']);
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.locator('.chart-footer')).toContainText('20 个本月计薪日');
  await expect(page.locator('.earnings-card .currency')).toHaveText('HK$');
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('116');
  await expect(page.locator('.earnings-card .amount-decimal')).toHaveText('.67');
  await expect(page.locator('.stat-card').filter({ hasText: '下次发薪日' }).locator('strong')).toHaveAttribute('title', /11.*27/);
  await page.getByRole('button', { name: '开启悬浮窗', exact: true }).click();
  await expect(page.locator('.widget .amount-integer')).toHaveText('116');
  await expect(page.locator('.widget .amount-decimal')).toHaveText('.67');
  await page.getByRole('button', { name: '最小化浮窗' }).click();
  await page.reload();
  await page.getByRole('button', { name: '工资与偏好设置' }).click();
  await expect(dialog.getByLabel('币种', { exact: true })).toHaveValue('HKD');
  await expect(dialog.getByLabel('节假日地区')).toHaveValue('CN');
  await dialog.getByLabel('节假日地区').selectOption('HK');
  await expect(dialog.getByLabel('币种', { exact: true })).toHaveValue('HKD');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.locator('.calendar-status')).toContainText('测试香港假日');
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('0');
});

test('fixed first day and custom payday persist independently of the default last workday', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('发薪方式').selectOption('first-day');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  const payday = page.locator('.stat-card').filter({ hasText: '下次发薪日' }).locator('strong');
  await expect(payday).toHaveAttribute('title', /12.*1/);
  await page.getByRole('button', { name: '工资与偏好设置' }).click();
  await expect(dialog.getByLabel('发薪方式')).toHaveValue('first-day');
  await dialog.getByLabel('发薪方式').selectOption('custom');
  await dialog.getByLabel('每月发薪日', { exact: true }).fill('15');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(payday).toHaveAttribute('title', /11.*15/);
  await page.reload();
  await page.getByRole('button', { name: '工资与偏好设置' }).click();
  await expect(dialog.getByLabel('发薪方式')).toHaveValue('custom');
  await expect(dialog.getByLabel('每月发薪日', { exact: true })).toHaveValue('15');
  await dialog.getByLabel('每月发薪日', { exact: true }).fill('');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(dialog.getByLabel('每月发薪日', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByLabel('发薪方式').selectOption('last-workday');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(payday).toHaveAttribute('title', /11.*27/);
});

test('a mainland makeup weekend remains a rest day even when salary is HKD', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-07T02:00:00Z'));
  await page.goto('/');
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  await page.getByLabel('币种', { exact: true }).selectOption('HKD');
  await page.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(page.locator('.calendar-status')).toContainText('调休');
  await expect(page.locator('.earnings-card .amount-integer')).toHaveText('0');
  await expect(page.locator('.chart-footer')).toContainText('20 个本月计薪日');
});

test('switching holiday region during an in-flight calendar update still downloads the new region', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://raw.githubusercontent.com/**', async route => {
    await blocked;
    return route.fulfill({ json: { year: 2026, days: [{ date: '2026-01-01', name: '元旦', isOffDay: true }] } });
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '设置我的月薪' }).click();
    await page.getByLabel('币种', { exact: true }).selectOption('HKD');
    await page.getByRole('button', { name: '保存并开始计薪' }).click();
    await page.getByRole('button', { name: '工资与偏好设置' }).click();
    await page.getByLabel('节假日地区').selectOption('HK');
    await page.getByRole('button', { name: '保存并开始计薪' }).click();
    await expect(page.locator('.calendar-status')).toContainText('测试香港假日');
  } finally { release(); }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).calendar['CN-2026']?.region)).toBe('CN');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!));
  expect(saved.settings).toMatchObject({ currency: 'HKD', region: 'HK' });
  expect(saved.calendar['HK-2026']).toBeTruthy();
});

test('upgrading a daily profile keeps HKD with the mainland calendar and asks for monthly salary', async ({ page }) => {
  await page.addInitScript(defaults => {
    const { monthlySalary: _monthly, paydayMode: _mode, ...oldSettings } = defaults;
    localStorage.setItem('niuma.payday.v2', JSON.stringify({
      version: 2, configured: true,
      settings: { ...oldSettings, dailySalary: 680, currency: 'HKD', region: 'CN', startTime: '08:30', payday: 15 },
      goal: { name: '旧的小目标', amount: 80 }, privacy: true, calendar: {},
    }));
  }, DEFAULT_SETTINGS);
  await page.goto('/');
  await expect(page.getByText('已保留原有偏好，请补填月薪后开始计薪。')).toBeVisible();
  await page.getByRole('button', { name: '设置我的月薪' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('月薪', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('币种', { exact: true })).toHaveValue('HKD');
  await expect(dialog.getByLabel('节假日地区')).toHaveValue('CN');
  await expect(dialog.getByLabel('上班时间', { exact: true })).toHaveValue('08:30');
  await expect(dialog.getByLabel('每月发薪日', { exact: true })).toHaveValue('15');
  await dialog.getByLabel('月薪', { exact: true }).fill('20000');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await page.reload();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!));
  expect(saved).toMatchObject({ version: 3, configured: true, privacy: true, goal: { name: '旧的小目标', amount: 80 },
    settings: { monthlySalary: 20000, currency: 'HKD', region: 'CN', paydayMode: 'fixed-day', payday: 15 } });
});
