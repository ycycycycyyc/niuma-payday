import type { Locator, Page } from '@playwright/test';

type Raster = { width: number; height: number; pixels: Uint8ClampedArray };
type Pair = { centerGain: number; edge: Array<{ x: number; shift: number; confidence: number; zeroScore: number }> };

/** Median of a small clear patch of the painted card, in screenshot sRGB. */
export async function paintSample(card: Locator, x: number, y: number) {
  const screenshot = await card.screenshot({ scale: 'css', animations: 'disabled' });
  return card.page().evaluate(async ({ data, x, y }) => {
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 9;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, Math.round(bitmap.width * x) - 4, Math.round(bitmap.height * y) - 4, 9, 9, 0, 0, 9, 9);
    const pixels = context.getImageData(0, 0, 9, 9).data;
    return [0, 1, 2].map(channel => {
      const values: number[] = [];
      for (let i = channel; i < pixels.length; i += 4) values.push(pixels[i]);
      values.sort((a, b) => a - b);
      return values[Math.floor(values.length / 2)];
    });
  }, { data: screenshot.toString('base64'), x, y });
}

// Sample the rendered backdrop after removing just this element's glyphs or icon strokes.
export async function textContrast(ink: Locator) {
  const color = await ink.evaluate(el => {
    el.setAttribute('data-qa-contrast', '');
    return getComputedStyle(el).color;
  });
  let shot: Buffer;
  try {
    shot = await ink.screenshot({
      scale: 'css',
      animations: 'disabled',
      style: `[data-qa-contrast] { color: transparent !important; text-shadow: none !important;
        -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; }
        svg[data-qa-contrast] * { fill: none !important; stroke: none !important; }`,
    });
  } finally {
    await ink.evaluate(el => el.removeAttribute('data-qa-contrast'));
  }
  const ratios = await ink.page().evaluate(async ({ encoded, color }) => {
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    function luminance(r: number, g: number, b: number) {
      const linear = (byte: number) => {
        const v = byte / 255;
        return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
      };
      return .2126 * linear(r) + .7152 * linear(g) + .0722 * linear(b);
    }
    // Let the renderer resolve CSS color spaces and any alpha before computing the ratio.
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const rgb = context.getImageData(0, 0, 1, 1).data;
    const alpha = rgb[3] / 255;
    const samples: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      const background = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
      const foreground = luminance(
        alpha * rgb[0] + (1 - alpha) * pixels[i],
        alpha * rgb[1] + (1 - alpha) * pixels[i + 1],
        alpha * rgb[2] + (1 - alpha) * pixels[i + 2],
      );
      samples.push((Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05));
    }
    samples.sort((a, b) => a - b);
    return {
      tenthPercentile: samples[Math.floor(samples.length * .10)],
      median: samples[Math.floor(samples.length * .50)],
    };
  }, { encoded: shot.toString('base64'), color });
  return { color, ...ratios };
}

/** Paint a known, stationary surface directly behind the production widget. */
export async function paintBackdrop(page: Page, pattern: 'black' | 'white' | 'stripes') {
  await page.locator('.widget').evaluate((card, pattern) => {
    const parent = card.parentElement!;
    let canvas = parent.querySelector<HTMLCanvasElement>('.qa-optical-target');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'qa-optical-target';
      parent.style.position = 'relative';
      // Overscan so that all filter inputs exist beyond the curved card edges.
      canvas.style.cssText = 'position:absolute;left:-50px;top:-50px;pointer-events:none;';
      parent.insertBefore(canvas, card);
    }
    canvas.width = Math.ceil(parent.getBoundingClientRect().width) + 100;
    canvas.height = Math.ceil(parent.getBoundingClientRect().height) + 100;
    const context = canvas.getContext('2d')!;
    if (pattern !== 'stripes') {
      context.fillStyle = pattern;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const bitmap = context.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) {
        // Three periods give the diagonal texture an unambiguous match over ±23 px.
        const t = (x + y) * 2 * Math.PI;
        const shade = 128 + 62 * Math.sin(t / 41) + 39 * Math.sin(t / 23 + 1.2) + 21 * Math.cos(t / 63);
        const offset = (y * bitmap.width + x) * 4;
        bitmap.data[offset] = shade;
        bitmap.data[offset + 1] = shade;
        bitmap.data[offset + 2] = shade;
        bitmap.data[offset + 3] = 255;
      }
    }
    context.putImageData(bitmap, 0, 0);
  }, pattern);
}

export async function compareImages(page: Page, first: Buffer, second: Buffer): Promise<Pair> {
  return page.evaluate(async ([firstEncoded, secondEncoded]) => {
    async function decode(encoded: string): Promise<Raster> {
      const raw = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));
      const image = await createImageBitmap(new Blob([raw], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
    }
    const [a, b] = await Promise.all([decode(firstEncoded), decode(secondEncoded)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Widget bounds changed between exposures');
    const grey = (r: Raster, x: number, y: number) => {
      const i = 4 * (y * r.width + x);
      return (r.pixels[i] + r.pixels[i + 1] + r.pixels[i + 2]) / 3;
    };
    const center: number[] = [];
    // A clear area between the amount and mascot avoids anchoring the result on text.
    for (let x = Math.round(a.width * .54); x < a.width * .63; x++) {
      for (let y = Math.round(a.height * .35); y < a.height * .58; y++) {
        center.push(Math.abs(grey(a, x, y) - grey(b, x, y)) / 255);
      }
    }
    center.sort((v, w) => v - w);

    const edge = [4, 7, 10, 14, Math.round(a.width * .56), a.width - 15, a.width - 11, a.width - 8, a.width - 5].map(x => {
      // Cross-correlation removes constant tint and contrast changes. A shifted
      // diagonal stripe on the vertical rim changes the best matching row offset.
      let best = -Infinity;
      let shift = 0;
      let zeroScore = 0;
      for (let offset = -23; offset <= 23; offset++) {
        let sumA = 0;
        let sumB = 0;
        let sumAA = 0;
        let sumBB = 0;
        let sumAB = 0;
        let n = 0;
        for (let y = Math.round(.32 * a.height); y < .67 * a.height; y++) {
          const first = grey(a, x, y);
          const second = grey(b, x, y + offset);
          sumA += first;
          sumB += second;
          sumAA += first * first;
          sumBB += second * second;
          sumAB += first * second;
          n++;
        }
        const variance = Math.max(0, (sumAA - sumA * sumA / n) * (sumBB - sumB * sumB / n));
        const score = variance ? (sumAB - sumA * sumB / n) / Math.sqrt(variance) : 0;
        if (offset === 0) zeroScore = score;
        if (score > best) {
          best = score;
          shift = offset;
        }
      }
      return { x, shift, confidence: best, zeroScore };
    });
    return { centerGain: center[Math.floor(center.length / 2)], edge };
  }, [first.toString('base64'), second.toString('base64')]);
}

export async function backgroundGain(page: Page) {
  const card = page.locator('.widget');
  await paintBackdrop(page, 'black');
  const black = await card.screenshot({ animations: 'disabled', scale: 'css' });
  await paintBackdrop(page, 'white');
  const white = await card.screenshot({ animations: 'disabled', scale: 'css' });
  return (await compareImages(page, black, white)).centerGain;
}
