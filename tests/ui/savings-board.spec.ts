import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/salary';
import type { SavingsEntry } from '../../shared/savings.mjs';

const currentMonth = '2027-01';
const board = (page: Page) => page.getByRole('region', { name: '存钱记录板' });
const total = (page: Page) => board(page).getByTestId('savings-total');

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-01-12T02:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**', route => {
    const year = Number(new URL(route.request().url()).pathname.match(/(\d{4})\.json$/)?.[1]);
    return route.fulfill({ json: { year, days: [{ date: `${year}-01-01`, name: '元旦', isOffDay: true }] } });
  });
});

async function configureSalary(page: Page, amount: string, currency: 'CNY' | 'HKD' = 'CNY') {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('月薪', { exact: true }).fill(amount);
  await dialog.getByLabel('币种', { exact: true }).selectOption(currency);
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(dialog).not.toBeVisible();
}

async function openHistory(page: Page) {
  const toggle = board(page).getByRole('button', { name: /月度明细/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function storedLedger(page: Page): Promise<Record<string, SavingsEntry>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).savings ?? {});
}

test('跨年补记后沿用预算，记入、更正和重新打开都只统计一次', async ({ page }) => {
  await page.goto('/');
  await board(page).getByRole('button', { name: '前往工资设置' }).click();
  await configureSalary(page, '10000');
  await expect(total(page)).toContainText('0');

  await openHistory(page);
  await board(page).getByRole('button', { name: '补记月份' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('月份', { exact: true }).fill('2026-12');
  await dialog.getByLabel('月薪', { exact: true }).fill('9500');
  await dialog.getByLabel('房租', { exact: true }).fill('2500');
  await dialog.getByLabel('生活费', { exact: true }).fill('3000');
  await dialog.getByRole('button', { name: '确认记入' }).click();
  await expect(total(page)).toContainText('4,000');

  await board(page).getByRole('button', { name: '记入本月' }).click();
  await expect(dialog.getByLabel('月份', { exact: true })).toHaveValue(currentMonth);
  await expect(dialog.getByLabel('房租', { exact: true })).toHaveValue(/^2500(?:\.00)?$/);
  await expect(dialog.getByLabel('生活费', { exact: true })).toHaveValue(/^3000(?:\.00)?$/);
  await dialog.getByLabel('生活费', { exact: true }).fill('2999.99');
  await dialog.getByRole('button', { name: '确认记入' }).click();
  await expect(total(page)).toContainText('8,500.01');

  await board(page).getByRole('button', { name: '更正本月' }).click();
  await dialog.getByLabel('生活费', { exact: true }).fill('8000');
  await dialog.getByRole('button', { name: '保存更正' }).click();
  await expect(total(page)).toContainText('3,500');
  await expect(board(page)).toContainText('超支');
  await page.reload();
  await expect(total(page)).toContainText('3,500');
  const ledger = await storedLedger(page);
  expect(Object.keys(ledger).sort()).toEqual(['2026-12', currentMonth]);
  expect(ledger['2026-12']).toMatchObject({ salaryCents: 950000, rentCents: 250000, livingCents: 300000 });
  expect(ledger[currentMonth]).toMatchObject({ salaryCents: 1000000, rentCents: 250000, livingCents: 800000 });
});

test('旧工资配置升级为空账本，换币后两种币种各自累计，隐藏金额覆盖明细', async ({ page }) => {
  await page.addInitScript(settings => {
    if (localStorage.getItem('niuma.payday.v3')) return;
    localStorage.setItem('niuma.payday.v3', JSON.stringify({
      version: 3, configured: true, settings: { ...settings, monthlySalary: 12000 },
      goal: { name: '周末电影', amount: 120 }, privacy: false, calendar: {},
    }));
  }, DEFAULT_SETTINGS);
  await page.goto('/');
  await expect(total(page)).toContainText('0');
  expect(await storedLedger(page)).toEqual({});

  await openHistory(page);
  await board(page).getByRole('button', { name: '补记月份' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('月份', { exact: true }).fill('2026-11');
  await dialog.getByLabel('月薪', { exact: true }).fill('12000');
  await dialog.getByLabel('房租', { exact: true }).fill('0');
  await dialog.getByLabel('生活费', { exact: true }).fill('5000');
  await dialog.getByRole('button', { name: '确认记入' }).click();
  await expect(total(page)).toContainText('7,000');

  await page.getByRole('button', { name: '工资与偏好设置' }).click();
  await configureSalary(page, '18000', 'HKD');
  await board(page).getByRole('button', { name: '记入本月' }).click();
  await dialog.getByLabel('房租', { exact: true }).fill('6000');
  await dialog.getByLabel('生活费', { exact: true }).fill('4000');
  await dialog.getByRole('button', { name: '确认记入' }).click();
  const currency = board(page).getByLabel('累计币种');
  await currency.selectOption('HKD');
  await expect(total(page)).toContainText('8,000');
  await currency.selectOption('CNY');
  await expect(total(page)).toContainText('7,000');
  await openHistory(page);
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(total(page)).toContainText('••');
  await expect(board(page)).not.toContainText(/(?:12,?000|18,?000|[45678],?000)/);
  await expect(board(page).getByRole('button', { name: '更正本月', disabled: false })).toHaveCount(0);
  await page.reload();
  await expect(total(page)).toContainText('••');
  await page.getByRole('button', { name: '显示金额', exact: true }).click();
  await board(page).getByLabel('累计币种').selectOption('HKD');
  await expect(total(page)).toContainText('8,000');
  expect((await storedLedger(page))['2026-11']).toMatchObject({ currency: 'CNY', salaryCents: 1200000, rentCents: 0 });
});
