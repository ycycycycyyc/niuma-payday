import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/salary';

const output = path.resolve('artifacts/widget-glass-qa');
const offlinePreview = path.resolve('artifacts/preview/Niuma-Glass-Preview.html');
const platformProfiles = [
  { name: 'windows', platform: 'Windows NT 10.0; Win64; x64', scale: 1 },
  { name: 'mac', platform: 'Macintosh; Intel Mac OS X 10_15_7', scale: 1 },
  { name: 'mac-retina', platform: 'Macintosh; Intel Mac OS X 10_15_7', scale: 2 },
];

async function openWidget(page: Page, dailySalary = 720, currency = 'CNY') {
  const data = {
    version: 2,
    configured: true,
    settings: { ...DEFAULT_SETTINGS, dailySalary, currency },
    goal: { name: '咖啡', amount: 25 },
    privacy: false,
    calendar: {},
  };
  await page.addInitScript(value => localStorage.setItem('niuma.payday.v2', JSON.stringify(value)), data);
  await page.clock.install({ time: new Date('2026-11-06T06:36:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T06:36:12Z'));
  await page.goto('/#/widget');
  await expect(page.locator('.widget-time-value')).toHaveText('03:23:48');
}

async function widgetMetrics(page: Page) {
  return page.locator('.widget-stack').evaluate(stack => {
    function bounds(element: Element) {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }
    const card = stack.querySelector('.widget')!;
    const cow = card.querySelector('.widget-mascot .mascot')!;
    const time = card.querySelector('.widget-time-value')!;
    const amount = card.querySelector('.live-amount')!;
    const text = document.createRange();
    text.selectNodeContents(amount);
    const amountText = text.getBoundingClientRect();
    return {
      card: bounds(card),
      cow: bounds(cow),
      time: bounds(time),
      timeFont: parseFloat(getComputedStyle(time).fontSize),
      amountLeft: amountText.left,
      amountRight: amountText.right,
      amountBottom: amountText.bottom,
      tint: getComputedStyle(card).background,
      screenWidth: innerWidth,
    };
  });
}

// Measure the rasterized card, including its CSS layers and inherited backgrounds.
// Exclude rounded corners and the border so the shape alone cannot pass this check.
async function glassOpacity(page: Page) {
  const png = await page.locator('.widget').screenshot({ omitBackground: true, animations: 'disabled' });
  return page.evaluate(async base64 => {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const image = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(20, 20, canvas.width - 40, canvas.height - 40).data;
    let translucent = 0;
    const histogram = new Array<number>(256).fill(0);
    for (let i = 3; i < pixels.length; i += 4) {
      const alpha = pixels[i];
      histogram[alpha]++;
      if (alpha > 0 && alpha < 252) translucent++;
    }
    const count = pixels.length / 4;
    let cumulative = 0;
    const median = histogram.findIndex(frequency => (cumulative += frequency) >= count / 2);
    return { fractionTranslucent: translucent / count, medianAlpha: median };
  }, png.toString('base64'));
}

test('same widget layout on Windows and Mac profiles, with transparent glass and a live countdown', async ({ browser, baseURL }) => {
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const profile of platformProfiles) {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 376, height: 272 },
      userAgent: `Mozilla/5.0 (${profile.platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36`,
      timezoneId: 'Asia/Shanghai',
      reducedMotion: 'reduce',
      deviceScaleFactor: profile.scale,
    });
    try {
      const page = await context.newPage();
      await openWidget(page);
      const metrics = await widgetMetrics(page);
      expect(metrics.card).toMatchObject({ x: 0, y: 72, width: 376, height: 200 });
      expect(metrics.cow.width).toBeGreaterThanOrEqual(70);
      expect(metrics.cow.height).toBeGreaterThanOrEqual(70);
      expect(metrics.timeFont).toBeGreaterThanOrEqual(23);
      const opacity = await glassOpacity(page);
      expect(opacity.fractionTranslucent).toBeGreaterThan(0.4);
      await page.screenshot({ path: path.join(output, `${profile.name}.png`), omitBackground: true });
      await page.clock.runFor(1000);
      await expect(page.locator('.widget-time-value')).toHaveText('03:23:47');
      results.push({ profile: profile.name, metrics, opacity });
    } finally {
      await context.close();
    }
  }
  for (const result of results.slice(1)) {
    expect(result.metrics).toEqual(results[0].metrics);
  }
  fs.writeFileSync(path.join(output, 'profiles.json'), JSON.stringify(results, null, 2));
});

test('maximum supported HKD salary, mascot, countdown and controls stay inside narrow widget', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 272 });
  await openWidget(page, 1_000_000_000, 'HKD');
  await expect(page.locator('.live-amount .currency')).toHaveText('HK$');
  await expect(page.locator('.amount-integer')).toHaveText(/\d{3},\d{3},\d{3}/);
  for (const width of [320, 376]) {
    await page.setViewportSize({ width, height: 272 });
    const metrics = await widgetMetrics(page);
    expect(metrics.card.width).toBe(width);
    expect(metrics.amountLeft).toBeGreaterThanOrEqual(metrics.card.x);
    expect(metrics.amountRight).toBeLessThanOrEqual(metrics.cow.x);
    expect(metrics.cow.x + metrics.cow.width).toBeLessThanOrEqual(width);
    expect(metrics.time.x + metrics.time.width).toBeLessThanOrEqual(width);
    expect(metrics.amountBottom).toBeLessThanOrEqual(metrics.time.y);
    for (const name of ['返回主窗口', '隐藏浮窗']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
      const bounds = (await button.boundingBox())!;
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
  }
  fs.mkdirSync(output, { recursive: true });
  await page.setViewportSize({ width: 320, height: 272 });
  await page.screenshot({ path: path.join(output, 'narrow-hkd.png'), omitBackground: true });
});

test('standalone HTML runs from file offline, changes wallpaper, ticks and reopens', async ({ page, context }) => {
  test.skip(!fs.existsSync(offlinePreview), 'Build the standalone preview to run this export check.');
  const external: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await context.setOffline(true);
  await page.clock.install({ time: new Date('2026-11-06T06:36:00Z') });
  await page.clock.pauseAt(new Date('2026-11-06T06:36:12Z'));
  await page.goto(pathToFileURL(offlinePreview).href);
  const card = page.getByRole('region', { name: '工资悬浮窗' });
  await expect(card).toBeVisible();
  const clock = page.locator('.widget-time-value');
  const before = await clock.innerText();
  const seconds = (time: string) => time.split(':').reduce((sum, item) => sum * 60 + Number(item), 0);
  expect(before).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  await page.clock.runFor(1000);
  expect(seconds(before) - seconds(await clock.innerText())).toBe(1);
  for (const theme of ['夜色', '日光']) {
    const choice = page.getByRole('button', { name: theme, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    const dark = theme === '夜色';
    await expect(page.locator('.preview-scene')).toHaveAttribute('data-theme', dark ? 'night' : 'day');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, dark ? 'offline-night.png' : 'offline-day.png'), animations: 'disabled' });
  }
  await card.getByRole('button', { name: '隐藏浮窗' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '开启浮窗', exact: true }).click();
  await expect(card).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
