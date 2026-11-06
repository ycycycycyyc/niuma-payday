import { expect, test } from '@playwright/test';

test('a failed desktop save explains why, retains the form, and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    let saved: unknown = null;
    let first = true;
    const calendarStatus = async () => ({ status: 'idle', message: '', calendar: {} });
    Object.defineProperty(window, 'niuma', { value: {
      platform: 'win32', getState: async () => saved,
      setState: async (state: unknown) => {
        if (first) {
          first = false;
          throw new Error("Error invoking remote method 'niuma:set-state': Error: [SAVE_PERMISSION] 数据目录不可写");
        }
        saved = structuredClone(state);
        return saved;
      },
      onStateChanged: () => () => {}, onWindowState: () => () => {}, onCalendarStatus: () => () => {},
      refreshCalendar: calendarStatus, getCalendarStatus: calendarStatus,
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '设置我的日薪' }).click();
  const dialog = page.getByRole('dialog');
  const daily = dialog.getByLabel('日薪', { exact: true });
  await daily.fill('680');
  await dialog.getByLabel('上班时间', { exact: true }).fill('08:30');
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(dialog.getByRole('alert')).toContainText('读写权限');
  await expect(dialog.getByRole('alert')).toContainText('输入已保留');
  await expect(daily).toHaveValue('680');
  await expect(dialog.getByLabel('上班时间', { exact: true })).toHaveValue('08:30');
  expect(await page.evaluate(() => localStorage.getItem('niuma.payday.v2'))).toBeNull();
  await dialog.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await page.evaluate(() => window.niuma!.getState()) as { configured: boolean; settings: { dailySalary: number; startTime: string } };
  expect(saved).toMatchObject({ configured: true, settings: { dailySalary: 680, startTime: '08:30' } });
});
