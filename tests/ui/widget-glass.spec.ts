import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/lib/salary';
import { backgroundGain, compareImages, paintBackdrop, paintSample, textContrast } from './widget-optics';

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

async function widgetContrast(card: Locator) {
  const restore = card.getByRole('button', { name: '返回主窗口' }).locator('svg');
  const hide = card.getByRole('button', { name: '隐藏浮窗' }).locator('svg');
  const result = {
    time: await textContrast(card.locator('.widget-time-value')),
    amount: await textContrast(card.locator('.amount-integer')),
    restoreIcon: await textContrast(restore),
    hideIcon: await textContrast(hide),
  };
  for (const ink of Object.values(result)) expect(ink.tenthPercentile).toBeGreaterThanOrEqual(3);
  return result;
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
    const clearCenter = context.getImageData(
      Math.floor(canvas.width * .54), Math.floor(canvas.height * .35),
      Math.floor(canvas.width * .09), Math.floor(canvas.height * .23),
    ).data;
    const centerAlphas: number[] = [];
    for (let i = 3; i < clearCenter.length; i += 4) centerAlphas.push(clearCenter[i]);
    centerAlphas.sort((a, b) => a - b);
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
    return {
      fractionTranslucent: translucent / count,
      medianAlpha: median,
      centerAlpha: centerAlphas[Math.floor(centerAlphas.length / 2)],
    };
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

test('dashboard and floating glass paint coordinated pinks and keep salary and controls legible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const hero = page.locator('.earnings-card');
  await expect(hero).toBeVisible();
  const sample = await paintSample(hero, .58, .44);
  await expect(hero).toHaveCSS('background-color', 'rgb(253, 237, 244)');
  expect(sample).toEqual([253, 237, 244]);
  const mainInk = {
    amount: await textContrast(hero.locator('.amount-integer')),
    decimal: await textContrast(hero.locator('.amount-decimal')),
    privacyIcon: await textContrast(hero.locator('.earnings-caption button svg')),
    openButton: await textContrast(hero.locator('.hero-footer button')),
  };
  expect(mainInk.amount.tenthPercentile).toBeGreaterThanOrEqual(3);
  expect(mainInk.decimal.tenthPercentile).toBeGreaterThanOrEqual(3);
  expect(mainInk.privacyIcon.tenthPercentile).toBeGreaterThanOrEqual(3);
  expect(mainInk.openButton.tenthPercentile).toBeGreaterThanOrEqual(4.5);

  await hero.locator('.hero-footer button').click();
  const card = page.locator('.widget');
  await expect(card).toBeVisible();
  await paintBackdrop(page, 'white');
  const onWhite = await paintSample(card, .60, .44);
  await paintBackdrop(page, 'black');
  const onBlack = await paintSample(card, .60, .44);
  // The fuller blush softens the wallpaper while still transmitting most of its texture.
  const blush = [249, 223, 235];
  for (let channel = 0; channel < sample.length; channel++) {
    const transmission = (onWhite[channel] - onBlack[channel]) / 255;
    expect(transmission).toBeGreaterThan(.55);
    expect(transmission).toBeLessThan(.7);
    expect(Math.abs(onBlack[channel] - blush[channel] * (1 - transmission))).toBeLessThanOrEqual(1.5);
  }

  // A token change must repaint both surfaces. This catches copies of the same hard-coded hex.
  await page.evaluate(() => document.documentElement.style.setProperty('--dialogue-pink', '#0080ff'));
  expect(await paintSample(hero, .58, .44)).toEqual([0, 128, 255]);
  const blueGlass = await paintSample(card, .60, .44);
  expect(blueGlass[0]).toBeLessThanOrEqual(20);
  expect(blueGlass[1]).toBeGreaterThan(10);
  expect(blueGlass[2]).toBeGreaterThan(blueGlass[1] + 8);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'pink-surfaces.json'), JSON.stringify({ sample, onWhite, onBlack, mainInk }, null, 2));
});

test('the transparent center passes the wallpaper; the rounded rim deflects actual background texture', async ({ browser, page }) => {
  const capture = () => page.locator('.widget').screenshot({ animations: 'disabled', scale: 'css' });
  const previous = path.resolve('release/v1.0.4/Niuma-Glass-Preview.html');
  let previousGain: number | null = null;
  if (fs.existsSync(previous)) {
    const baseline = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: 'reduce' });
    try {
      await baseline.goto(pathToFileURL(previous).href);
      await expect(baseline.locator('.widget')).toBeVisible();
      previousGain = await backgroundGain(baseline);
    } finally {
      await baseline.close();
    }
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 376, height: 272 });
  await openWidget(page);
  await expect(page.locator('.widget')).toHaveAttribute('data-refraction', 'svg');
  const opacity = await glassOpacity(page);
  const gain = await backgroundGain(page);
  await paintBackdrop(page, 'stripes');
  const withLens = await capture();
  const displacement = page.locator('feDisplacementMap');
  await expect(displacement).toHaveCount(1);
  await displacement.evaluate(node => node.setAttribute('scale', '0'));
  const flat = await capture();
  const { edge } = await compareImages(page, withLens, flat);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'lens-on.png'), withLens);
  fs.writeFileSync(path.join(output, 'lens-zero.png'), flat);
  fs.writeFileSync(path.join(output, 'optics.json'), JSON.stringify({ previousGain, gain, opacity, edge }, null, 2));

  // Retain a translucent centre, with more pink coverage than the earlier clear glass.
  expect(gain).toBeGreaterThan(.55);
  expect(gain).toBeLessThan(.7);
  expect(opacity.centerAlpha).toBeGreaterThan(80);
  expect(opacity.centerAlpha).toBeLessThan(110);
  if (previousGain !== null) expect(gain).toBeGreaterThan(previousGain);
  const deflected = edge.filter(p => Math.abs(p.shift) >= 3 && p.confidence > .85 && p.confidence - p.zeroScore > .1);
  const left = deflected.filter(p => p.x < 20);
  const right = deflected.filter(p => p.x > 350);
  expect(left.length).toBeGreaterThan(0);
  expect(right.length).toBeGreaterThan(0);
  expect(Math.sign(left[0].shift)).toBe(-Math.sign(right[0].shift));
  const center = edge.find(p => p.x > 180 && p.x < 240)!;
  expect(Math.abs(center.shift)).toBeLessThanOrEqual(1);
});

test('offline preview preserves readable day and night digits without CSS URL backdrop filters', async ({ browser }) => {
  test.skip(!fs.existsSync(offlinePreview), 'Build the standalone preview to run this export check.');
  const context = await browser.newContext({
    viewport: { width: 1080, height: 700 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    offline: true,
    reducedMotion: 'reduce',
  });
  try {
    // Run the unsupported-URL branch in Chromium. This does not emulate the WebKit renderer.
    await context.addInitScript(() => {
      const supported = CSS.supports.bind(CSS);
      CSS.supports = (property, value?: string) => {
        if (value === undefined) return supported(property);
        if (property === 'backdrop-filter' && value.includes('url(')) return false;
        return supported(property, value);
      };
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(offlinePreview).href);
    const card = page.locator('.widget');
    await expect(card).toHaveAttribute('data-refraction', 'fallback');
    await expect(card).toHaveCSS('backdrop-filter', /blur\(/);
    await expect(page.locator('.preview-wallpaper-lens')).toBeVisible();
    const ratios = [];
    for (const [label, mode] of [['日光', 'light'], ['夜色', 'dark']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.preview-scene')).toHaveAttribute('data-glass-scene', mode);
      ratios.push({ mode, ...await widgetContrast(card) });
    }
    expect(ratios[0].time.color).not.toEqual(ratios[1].time.color);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'fallback-contrast.json'), JSON.stringify(ratios, null, 2));
  } finally {
    await context.close();
  }
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
  const contrast = [];
  for (const theme of ['夜色', '日光']) {
    const choice = page.getByRole('button', { name: theme, exact: true });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    const dark = theme === '夜色';
    await expect(page.locator('.preview-scene')).toHaveAttribute('data-theme', dark ? 'night' : 'day');
    contrast.push({ theme, ...await widgetContrast(card) });
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, dark ? 'offline-night.png' : 'offline-day.png'), animations: 'disabled' });
  }
  fs.writeFileSync(path.join(output, 'preview-contrast.json'), JSON.stringify(contrast, null, 2));
  await card.getByRole('button', { name: '隐藏浮窗' }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole('button', { name: '开启浮窗', exact: true }).click();
  await expect(card).toBeVisible();
  const views = page.getByRole('group', { name: '预览视图' });
  await views.getByRole('button', { name: '主界面', exact: true }).click();
  const main = page.frameLocator('iframe[title="主界面演示"]');
  const salaryCard = main.locator('.earnings-card');
  await expect(salaryCard).toBeVisible();
  expect(await paintSample(salaryCard, .58, .44)).toEqual([253, 237, 244]);
  await main.getByRole('button', { name: '设置我的日薪', exact: true }).click();
  const settings = main.getByRole('dialog');
  const dailySalary = settings.getByLabel('日薪', { exact: true });
  const startTime = settings.getByLabel('上班时间', { exact: true });
  const endTime = settings.getByLabel('下班时间', { exact: true });
  // The test clock is Friday afternoon. This completed custom shift earns the whole day rate.
  await dailySalary.fill('399');
  await startTime.fill('06:11');
  await endTime.fill('07:22');
  await settings.getByRole('button', { name: '保存并开始计薪' }).click();
  await expect(settings).toHaveCount(0);
  await expect(salaryCard.locator('.amount-integer')).toHaveText('399');
  await main.getByRole('button', { name: '工资与偏好设置' }).click();
  await expect(dailySalary).toHaveValue('399');
  await expect(startTime).toHaveValue('06:11');
  await expect(endTime).toHaveValue('07:22');
  await settings.getByRole('button', { name: '先不改了' }).click();
  await salaryCard.getByRole('button', { name: '开启悬浮窗' }).click();
  await expect(card).toBeVisible();
  await expect(views.getByRole('button', { name: '浮窗', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(card.locator('.widget-time-value')).toHaveText('06:11–07:22');
  await expect(card.locator('.amount-integer')).toHaveText('399');
  await expect(card.locator('.amount-decimal')).toHaveText('.00');
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
