import { test, expect } from '@playwright/test';
import { DEFAULT_STATE } from '../../src/lib/store';

test('Saturday morning controls name and change the active Friday night shift', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-06T17:00:00Z'));
  await page.route('https://raw.githubusercontent.com/**', route => route.abort());
  await page.addInitScript(value => localStorage.setItem('niuma.payday.v3', JSON.stringify(value)), {
    ...structuredClone(DEFAULT_STATE), configured: true,
    settings: { ...structuredClone(DEFAULT_STATE.settings), startTime: '22:00', endTime: '06:00' },
  });
  await page.goto('/');
  await expect(page.locator('.calendar-status')).toContainText('11月6日夜班');
  await expect(page.locator('.calendar-status')).not.toContainText('周末休息');
  await expect(page.locator('.earnings-caption')).toContainText('11月6日夜班');
  await expect(page.locator('.earnings-card .section-label')).toContainText('正在赚钱');
  await page.getByRole('button', { name: '本班休息', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('niuma.payday.v3')!).settings.dayOverrides)).toEqual({ '2026-11-06': 'rest' });
  await expect(page.locator('.calendar-status')).toContainText('周末休息');
  await page.locator('.work-calendar-disclosure').click();
  await page.screenshot({ path: 'artifacts/preview-v16/work-calendar.png', fullPage: true });
});
