import fs from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/salary';
import { savingsLedgerCSV, type SavingsEntry } from '../../shared/savings.mjs';

const oldEntry: SavingsEntry = { month: '2026-11', currency: 'CNY', salaryCents: 1000000, rentCents: 200000, livingCents: 300000 };
const currentEntry: SavingsEntry = { month: '2027-01', currency: 'CNY', salaryCents: 1000000, rentCents: 200000, livingCents: 500000 };
const overspendEntry: SavingsEntry = { month: '2026-12', currency: 'HKD', salaryCents: 100, rentCents: 101, livingCents: 0 };
const ledger = { [oldEntry.month]: oldEntry, [currentEntry.month]: currentEntry, [overspendEntry.month]: overspendEntry };
const board = (page: Page) => page.getByRole('region', { name: '存钱记录板' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2027-01-12T02:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**', route => {
    const year = Number(new URL(route.request().url()).pathname.match(/(\d{4})\.json$/)?.[1]);
    return route.fulfill({ json: { year, days: [{ date: `${year}-01-01`, name: '元旦', isOffDay: true }] } });
  });
  await page.addInitScript(({ settings, savings }) => {
    if (!localStorage.getItem('niuma.payday.v3')) localStorage.setItem('niuma.payday.v3', JSON.stringify({
      version: 3, configured: true, settings, goal: { name: '咖啡', amount: 25 }, privacy: false, calendar: {}, savings,
    }));
  }, { settings: DEFAULT_SETTINGS, savings: ledger });
});

async function openHistory(page: Page) {
  const toggle = board(page).getByRole('button', { name: '月度明细' });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function replaceEntryFromAnotherWindow(page: Page, entry: SavingsEntry) {
  await page.evaluate(entry => {
    const key = 'niuma.payday.v3';
    const latest = JSON.parse(localStorage.getItem(key)!);
    latest.savings[entry.month] = entry;
    const newValue = JSON.stringify(latest);
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  }, entry);
}

test('withdrawal needs confirmation, supports undo, and persists after a reload', async ({ page }) => {
  await page.goto('/');
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥8,000.00');
  await openHistory(page);
  await board(page).getByRole('button', { name: '撤回 2026年11月的记录', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '撤回这笔记录？' });
  await expect(confirm).toContainText('2026年11月');
  await confirm.getByRole('button', { name: '保留记录' }).click();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥8,000.00');

  await board(page).getByRole('button', { name: '撤回 2026年11月的记录', exact: true }).click();
  await confirm.getByRole('button', { name: '确认撤回' }).click();
  await expect(confirm).not.toBeVisible();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥3,000.00');
  await board(page).getByRole('button', { name: '撤销撤回', exact: true }).click();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥8,000.00');
  await expect(board(page).getByRole('button', { name: '撤销撤回', exact: true })).toHaveCount(0);

  await board(page).getByRole('button', { name: '撤回 2026年11月的记录', exact: true }).click();
  await confirm.getByRole('button', { name: '确认撤回' }).click();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥3,000.00');
  await page.reload();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥3,000.00');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).savings);
  expect(saved[oldEntry.month]).toBeUndefined();
  expect(saved[currentEntry.month]).toEqual(currentEntry);
  expect(saved[overspendEntry.month]).toEqual(overspendEntry);
});

test('a stale withdrawal and an undo cannot overwrite another window’s correction', async ({ page }) => {
  await page.goto('/');
  await openHistory(page);
  await board(page).getByRole('button', { name: '撤回 2026年11月的记录', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '撤回这笔记录？' });
  const correction = { ...oldEntry, livingCents: 400000 };
  await replaceEntryFromAnotherWindow(page, correction);
  await confirm.getByRole('button', { name: '确认撤回' }).click();
  await expect(confirm.getByRole('alert')).toContainText(/已更新/);
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥7,000.00');
  await confirm.getByRole('button', { name: '保留记录' }).click();

  await board(page).getByRole('button', { name: '撤回 2026年11月的记录', exact: true }).click();
  await confirm.getByRole('button', { name: '确认撤回' }).click();
  await expect(board(page).getByTestId('savings-total')).toHaveText('¥3,000.00');
  const replacement = { ...oldEntry, livingCents: 600000 };
  await replaceEntryFromAnotherWindow(page, replacement);
  await board(page).getByRole('button', { name: '撤销撤回', exact: true }).click();
  await expect(board(page).getByRole('alert')).toContainText(/已更新/);
  const actual = await page.evaluate(month => JSON.parse(localStorage.getItem('niuma.payday.v3')!).savings[month], oldEntry.month);
  expect(actual).toEqual(replacement);
});

test('CSV downloads exact records; privacy disables export and hides trend values', async ({ page }) => {
  await page.goto('/');
  await openHistory(page);
  const downloadEvent = page.waitForEvent('download');
  await board(page).getByRole('button', { name: '导出 CSV', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('niuma-savings-2027-01.csv');
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await fs.readFile(path!, 'utf8')).toBe(savingsLedgerCSV(ledger, '2027-01'));

  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await expect(board(page).getByRole('button', { name: '导出 CSV', exact: true })).toBeDisabled();
  await expect(board(page).locator('.savings-trend')).toContainText('金额已隐藏');
  await expect(board(page).locator('.savings-trend-bars')).toHaveCount(0);
  await expect(board(page)).not.toContainText(/8,000|3,000|0\.01/);
  await expect(board(page).getByRole('button', { name: /^撤回 / })).toHaveCount(0);
});

test('the selected currency trend keeps overspending below zero and fits a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await board(page).getByLabel('累计币种').selectOption('HKD');
  await expect(board(page).locator('.savings-trend-caption')).toContainText('超支 HK$0.01');
  await expect(board(page).locator('.savings-trend-track .negative')).toHaveCount(1);
  const point = board(page).getByRole('button', { name: '2026年12月存入 −HK$0.01，查看记录' });
  await point.focus();
  await page.keyboard.press('Space');
  await expect(point).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
