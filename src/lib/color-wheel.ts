export type HsvColor = { h: number; s: number; v: number };

const unit = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const hue = (value: number) => Number.isFinite(value) ? ((value % 360) + 360) % 360 : 0;

export function hexToHsv(hex: string): HsvColor {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new RangeError('Expected a six-digit hex colour.');
  const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const high = Math.max(r, g, b);
  const low = Math.min(r, g, b);
  const delta = high - low;
  let h = 0;
  if (delta > 0) {
    if (high === r) h = 60 * ((g - b) / delta);
    else if (high === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: hue(h), s: high === 0 ? 0 : delta / high, v: high };
}

export function hsvToHex(color: HsvColor): string {
  const h = hue(color.h) / 60;
  const s = unit(color.s);
  const v = unit(color.v);
  const chroma = v * s;
  const middle = chroma * (1 - Math.abs(h % 2 - 1));
  const offset = v - chroma;
  const sectors = [
    [chroma, middle, 0], [middle, chroma, 0], [0, chroma, middle],
    [0, middle, chroma], [middle, 0, chroma], [chroma, 0, middle],
  ];
  return `#${sectors[Math.floor(h)].map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// Hue starts at twelve o'clock and increases clockwise; saturation grows radially.
export function colorAtPoint(x: number, y: number, radius: number, hueFallback = 0): { h: number; s: number } {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('The colour wheel needs a positive radius.');
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { h: hue(hueFallback), s: 0 };
  const distance = Math.hypot(x, y);
  return {
    h: distance < 1e-9 ? hue(hueFallback) : hue(Math.atan2(x, -y) * 180 / Math.PI),
    s: Math.min(1, distance / radius),
  };
}
