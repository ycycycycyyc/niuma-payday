import assert from 'node:assert/strict';
import test from 'node:test';
import { colorAtPoint, hexToHsv, hsvToHex } from '../src/lib/color-wheel';

test('HSV represents the primary colours, white and black accurately', () => {
  for (const [hex, expected] of [
    ['#ff0000', { h: 0, s: 1, v: 1 }],
    ['#00ff00', { h: 120, s: 1, v: 1 }],
    ['#0000ff', { h: 240, s: 1, v: 1 }],
    ['#ffffff', { h: 0, s: 0, v: 1 }],
    ['#000000', { h: 0, s: 0, v: 0 }],
  ] as const) {
    assert.deepEqual(hexToHsv(hex), expected);
    assert.equal(hsvToHex(expected), hex);
  }
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#ff0000');
  assert.equal(hsvToHex({ h: -120, s: 1, v: 1 }), '#0000ff');
  assert.equal(hsvToHex({ h: 90, s: 0, v: .5 }), '#808080');
});

test('hex to HSV and back preserves byte channels across dark, pastel and saturated colours', () => {
  const values = [0, 1, 17, 64, 127, 128, 200, 254, 255];
  for (const r of values) for (const g of values) for (const b of values) {
    const input = `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const output = hsvToHex(hexToHsv(input));
    assert.match(output, /^#[\da-f]{6}$/);
    for (let channel = 0; channel < 3; channel++) {
      const start = 1 + channel * 2;
      assert.ok(Math.abs(parseInt(input.slice(start, start + 2), 16) - parseInt(output.slice(start, start + 2), 16)) <= 1, `${input} -> ${output}`);
    }
  }
  assert.equal(hsvToHex(hexToHsv('#F9DFEB')), '#f9dfeb');
});

test('wheel coordinates preserve hue at the centre and map clockwise around the perimeter', () => {
  assert.deepEqual(colorAtPoint(0, 0, 10, 270), { h: 270, s: 0 });
  assert.deepEqual(colorAtPoint(0, -10, 10), { h: 0, s: 1 });
  assert.deepEqual(colorAtPoint(10, 0, 10), { h: 90, s: 1 });
  assert.deepEqual(colorAtPoint(0, 10, 10), { h: 180, s: 1 });
  assert.deepEqual(colorAtPoint(-10, 0, 10), { h: 270, s: 1 });
  assert.deepEqual(colorAtPoint(0, -5, 10), { h: 0, s: .5 });
  assert.deepEqual(colorAtPoint(0, -100, 10), { h: 0, s: 1 });
  assert.throws(() => colorAtPoint(0, 0, 0), RangeError);
});
