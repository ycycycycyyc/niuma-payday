import { test, expect } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/lib/store';
import { createProfileBackup } from '../../shared/profile-backup.mjs';

const original = { ...structuredClone(DEFAULT_STATE), configured: true, settings: { ...structuredClone(DEFAULT_STATE.settings), monthlySalary: 12_345 } };
const replacement = { ...structuredClone(original), settings: { ...original.settings, monthlySalary: 6_789 },
  savings: { '2026-10': { month: '2026-10', currency: 'CNY' as const, salaryCents: 678_900, rentCents: 100_000, livingCents: 200_000 } } };

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-09T02:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
  await page.addInitScript(value => localStorage.setItem('niuma.payday.v3', JSON.stringify(value)), original);
});

test('backup import previews data, requires explicit confirmation and keeps the replaced profile', async ({ page }) => {
  await page.goto('/');
  await page.locator('.data-backup summary').click();
  const input = page.getByLabel('选择资料备份文件');
  await input.setInputFiles({ name: 'Niuma-Backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createProfileBackup(replacement))) });
  await expect(page.getByRole('region', { name: '待导入资料预览' })).toContainText('6,789.00');
  await expect(page.getByRole('button', { name: '确认导入备份' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '我已核对，将用这份备份替换本机工资、排班和存钱记录。' }).check();
  await page.getByRole('button', { name: '确认导入备份' }).click();
  await expect(page.getByText('已恢复工资设置、排班与月度存钱记录。', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({ current: JSON.parse(localStorage.getItem('niuma.payday.v3')!), before: JSON.parse(localStorage.getItem('niuma.payday.v3.backup.1')!) }));
  expect(saved.current.settings.monthlySalary).toBe(6789);
  expect(saved.current.savings['2026-10'].salaryCents).toBe(678900);
  expect(saved.before.settings.monthlySalary).toBe(12345);
});

test('invalid backups and stale previews cannot overwrite local records', async ({ page }) => {
  await page.goto('/');
  await page.locator('.data-backup summary').click();
  const input = page.getByLabel('选择资料备份文件');
  await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.locator('.data-backup [role=alert]')).toContainText('JSON');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.monthlySalary)).toBe(12345);
  await input.setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createProfileBackup(replacement))) });
  await expect(page.getByRole('region', { name: '待导入资料预览' })).toBeVisible();
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('niuma.payday.v3')!);
    value.goal = { name: '预览后保存的新目标', amount: 88 };
    localStorage.setItem('niuma.payday.v3', JSON.stringify(value));
  });
  await page.getByRole('checkbox', { name: '我已核对，将用这份备份替换本机工资、排班和存钱记录。' }).check();
  await page.getByRole('button', { name: '确认导入备份' }).click();
  await expect(page.locator('.data-backup [role=alert]')).toContainText('本机资料已更新');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).goal.name)).toBe('预览后保存的新目标');
});

test('an original state.json can be previewed and imported through the same confirmation flow', async ({ page }) => {
  await page.goto('/');
  await page.locator('.data-backup summary').click();
  await page.getByLabel('选择资料备份文件').setInputFiles({ name: 'state.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(replacement)) });
  await expect(page.getByRole('region', { name: '待导入资料预览' })).toContainText('旧版资料文件');
  await page.getByRole('checkbox', { name: '我已核对，将用这份备份替换本机工资、排班和存钱记录。' }).check();
  await page.getByRole('button', { name: '确认导入备份' }).click();
  await expect(page.getByText('已恢复工资设置、排班与月度存钱记录。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.monthlySalary)).toBe(6789);
});

test('privacy masks imported wages and exports contain the actual recoverable profile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '隐藏金额', exact: true }).click();
  await page.locator('.data-backup summary').click();
  await page.getByLabel('选择资料备份文件').setInputFiles({ name: 'good.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(createProfileBackup(replacement))) });
  const preview = page.getByRole('region', { name: '待导入资料预览' });
  await expect(preview).toContainText('••••');
  await expect(preview).not.toContainText('6,789');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出资料备份' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Niuma-Backup-2026-11-09.json');
});
