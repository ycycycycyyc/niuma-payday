import test from 'node:test';
import assert from 'node:assert/strict';
import layout from '../shared/widget-layout.json';
import { fullWidgetHeight, petLaneHeight, widgetBoundsInWorkArea } from '../shared/widget-geometry.mjs';

test('restoring a legacy card position on a monitor to the left preserves its card anchor', () => {
  const area = { x: -1920, y: 24, width: 1920, height: 1032 };
  const anchor = { x: -1240, y: 260 };
  const bounds = widgetBoundsInWorkArea(area, anchor);
  assert.equal(bounds.x, anchor.x);
  assert.equal(bounds.y + petLaneHeight(bounds.height), anchor.y);
  assert.equal(bounds.width, layout.width);
  assert.equal(bounds.height, fullWidgetHeight);
});

test('external monitor unplug returns the complete widget to the visible work area', () => {
  const area = { x: 40, y: 35, width: 1100, height: 690 };
  const topLeft = widgetBoundsInWorkArea(area, { x: -1600, y: -330 });
  assert.equal(topLeft.x, area.x);
  assert.equal(topLeft.y, area.y);
  const bottomRight = widgetBoundsInWorkArea(area, { x: 2900, y: 2500 });
  assert.equal(bottomRight.x + bottomRight.width, area.x + area.width);
  assert.equal(bottomRight.y + bottomRight.height, area.y + area.height);
});

test('limited display space keeps window controls on screen and adapts only the pet lane first', () => {
  const area = { x: -320, y: 0, width: 320, height: layout.cardHeight + 20 };
  const bounds = widgetBoundsInWorkArea(area);
  assert.deepEqual(bounds, area);
  assert.equal(petLaneHeight(bounds.height), 20);
  assert.equal(petLaneHeight(layout.cardHeight - 10), 0);
});
