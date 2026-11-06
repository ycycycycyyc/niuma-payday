import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_WIDGET_APPEARANCE, normalizeWidgetAppearance, validateWidgetAppearance } from '../shared/widget-appearance.mjs';

test('appearance reads recover absent, corrupt, partial and legacy preferences', () => {
  for (const value of [undefined, null, false, [], 'pink', 1]) {
    assert.deepEqual(normalizeWidgetAppearance(value), DEFAULT_WIDGET_APPEARANCE);
  }
  assert.deepEqual(normalizeWidgetAppearance({ tint: '#A0B1C2', opacity: NaN }), { scale: 1, tint: '#a0b1c2', opacity: .36 });
  assert.deepEqual(normalizeWidgetAppearance({ scale: -2, opacity: 5, tint: '#abc' }), { scale: .85, tint: '#f9dfeb', opacity: 1 });
  assert.deepEqual(normalizeWidgetAppearance({ scale: Infinity, opacity: '0.3', tint: 'url(test)' }), DEFAULT_WIDGET_APPEARANCE);
});

test('appearance writes accept only complete bounded values with a plain six digit colour', () => {
  assert.equal(validateWidgetAppearance(DEFAULT_WIDGET_APPEARANCE), true);
  for (const scale of [.85, 1.5]) for (const opacity of [.15, 1]) {
    assert.equal(validateWidgetAppearance({ scale, tint: '#A0B1C2', opacity }), true);
  }
  for (const value of [null, [], {}, { ...DEFAULT_WIDGET_APPEARANCE, extra: true },
    { ...DEFAULT_WIDGET_APPEARANCE, scale: .84 }, { ...DEFAULT_WIDGET_APPEARANCE, scale: 1.51 },
    { ...DEFAULT_WIDGET_APPEARANCE, scale: NaN }, { ...DEFAULT_WIDGET_APPEARANCE, scale: '1' },
    { ...DEFAULT_WIDGET_APPEARANCE, opacity: .149 }, { ...DEFAULT_WIDGET_APPEARANCE, opacity: 1.01 },
    { ...DEFAULT_WIDGET_APPEARANCE, tint: '#abc' }, { ...DEFAULT_WIDGET_APPEARANCE, tint: '#ffffff80' },
    { ...DEFAULT_WIDGET_APPEARANCE, tint: 'pink' }]) assert.equal(validateWidgetAppearance(value), false);
});
