import { expect, test } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/lib/store';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T10:00:00+08:00'));
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({
    json: { year: 2026, days: [{ date: '2026-01-01', name: '元旦', isOffDay: true }] },
  }));
  await page.addInitScript(value => localStorage.setItem('niuma.payday.v3', JSON.stringify(value)), {
    ...DEFAULT_STATE,
    configured: true,
    settings: { ...DEFAULT_STATE.settings, monthlySalary: 10000 },
  });
});

test('future month edits preview the divisor, save only changed dates, and remain visible after reopening', async ({ page }) => {
  await page.goto('/');
  await page.locator('.work-calendar-disclosure').click();
  const calendar = page.locator('.work-calendar');
  await calendar.getByRole('button', { name: '下个月', exact: true }).click();
  await expect(calendar.locator('.work-calendar-month h3')).toHaveText('2026年12月');
  await expect(calendar.locator('.work-calendar-summary')).toContainText('23 个计薪日');
  await calendar.getByRole('button', { name: /^2026年12月5日/ }).click();
  await calendar.getByRole('button', { name: '这天上班', exact: true }).click();
  await expect(calendar.locator('.work-calendar-summary')).toContainText('24 个计薪日');
  await expect(calendar.locator('.work-calendar-footer')).toContainText('已修改 1 天');
  await calendar.getByRole('button', { name: '保存排班', exact: true }).click();
  await expect(calendar.getByRole('status')).toContainText('已保存 1 天');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.dayOverrides)).toEqual({ '2026-12-05': 'work' });
  await calendar.locator('.work-calendar-disclosure').click();
  await calendar.getByRole('button', { name: '下个月', exact: true }).click();
  await expect(calendar.getByRole('button', { name: /^2026年12月5日/ })).toHaveAccessibleName(/手动上班/);
  await calendar.getByRole('button', { name: /^2026年12月5日/ }).click();
  await calendar.getByRole('button', { name: '恢复日历', exact: true }).click();
  await expect(calendar.locator('.work-calendar-summary')).toContainText('23 个计薪日');
  await calendar.getByRole('button', { name: '取消修改', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.dayOverrides['2026-12-05'])).toBe('work');
});

test('a concurrent edit to another date survives saving and a same-date conflict preserves the draft', async ({ page }) => {
  await page.goto('/');
  await page.locator('.work-calendar-disclosure').click();
  const calendar = page.locator('.work-calendar');
  await calendar.getByRole('button', { name: /^2026年11月7日/ }).click();
  await calendar.getByRole('button', { name: '这天上班', exact: true }).click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('niuma.payday.v3')!);
    state.settings.dayOverrides['2026-11-08'] = 'work';
    localStorage.setItem('niuma.payday.v3', JSON.stringify(state));
  });
  await calendar.getByRole('button', { name: '保存排班', exact: true }).click();
  await expect(calendar.getByRole('status')).toContainText('已保存 1 天');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.dayOverrides)).toEqual({ '2026-11-07': 'work', '2026-11-08': 'work' });
  await calendar.locator('.work-calendar-disclosure').click();
  await calendar.getByRole('button', { name: /^2026年11月7日/ }).click();
  await calendar.getByRole('button', { name: '恢复日历', exact: true }).click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('niuma.payday.v3')!);
    state.settings.dayOverrides['2026-11-07'] = 'rest';
    localStorage.setItem('niuma.payday.v3', JSON.stringify(state));
  });
  await calendar.getByRole('button', { name: '保存排班', exact: true }).click();
  await expect(calendar.getByRole('alert')).toContainText('其他窗口更新');
  await expect(calendar.locator('.work-calendar-footer')).toContainText('已修改 1 天');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.dayOverrides['2026-11-07'])).toBe('rest');
});

test('the month grid remains within a narrow screen and supports arrow-key date selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('.work-calendar-disclosure').click();
  const calendar = page.locator('.work-calendar');
  const day = calendar.getByRole('button', { name: /^2026年11月6日/ });
  await day.focus();
  await page.keyboard.press('ArrowRight');
  await expect(calendar.getByRole('button', { name: /^2026年11月7日/ })).toBeFocused();
  await expect(calendar.locator('.work-calendar-selected-date')).toContainText('11月7日');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
