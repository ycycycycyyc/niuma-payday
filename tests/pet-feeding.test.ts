import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEED_DURATION_MS, createPetFeeding, stepPetFeeding, petFeedingFrame, petFeedingMenuRect,
  type PetFood,
} from '../shared/pet-feeding.mjs';

test('only supported foods start feeding and elapsed time finishes once without mutating its input', () => {
  for (const food of ['kibble', 'stick'] as const) {
    const original = createPetFeeding(food)!;
    Object.freeze(original);
    const eating = stepPetFeeding(original, FEED_DURATION_MS - 1)!;
    assert.deepEqual(original, { food, elapsedMs: 0 });
    assert.deepEqual(eating, { food, elapsedMs: FEED_DURATION_MS - 1 });
    assert.equal(stepPetFeeding(eating, 1), null);
    assert.equal(stepPetFeeding(original, FEED_DURATION_MS + 5000), null);
  }
  for (const food of ['', 'bone', 'Kibble', null, undefined, 1, {}, []]) {
    assert.equal(createPetFeeding(food), null);
  }
  assert.equal(stepPetFeeding(null, 100), null);
});

test('invalid or negative elapsed deltas cannot rewind, finish or corrupt a feeding', () => {
  const state = { food: 'kibble' as const, elapsedMs: 1200 };
  for (const delta of [NaN, Infinity, -Infinity, -500, 0]) {
    assert.deepEqual(stepPetFeeding(state, delta), state);
  }
  assert.deepEqual(stepPetFeeding({ ...state, elapsedMs: NaN }, 16), { ...state, elapsedMs: 16 });
});

test('each food has a complete eating sequence, decreasing portions and a final satisfied pose', () => {
  for (const [food, offset] of [['kibble', 0], ['stick', 8]] as const) {
    const frames = new Set<number>();
    let previousPortion = 1;
    for (let elapsedMs = 0; elapsedMs <= FEED_DURATION_MS; elapsedMs += 20) {
      const sample = petFeedingFrame({ food, elapsedMs });
      assert.ok(sample.frame >= offset && sample.frame < offset + 8);
      assert.ok(Number.isInteger(sample.frame));
      assert.ok(sample.portion <= previousPortion && sample.portion >= 0);
      previousPortion = sample.portion;
      frames.add(sample.frame);
    }
    assert.equal(frames.size, 8);
    assert.equal(petFeedingFrame({ food, elapsedMs: 0 }).stage, 'offer');
    assert.equal(petFeedingFrame({ food, elapsedMs: 800 }).stage, 'eat');
    assert.deepEqual(petFeedingFrame({ food, elapsedMs: 3800 }), {
      frame: offset + 7, stage: 'happy', portion: 0,
    });
  }
});

test('reduced motion changes pose only by stage instead of cycling through chewing frames', () => {
  for (const food of ['kibble', 'stick'] satisfies PetFood[]) {
    const offset = food === 'stick' ? 8 : 0;
    assert.equal(petFeedingFrame({ food, elapsedMs: 0 }, true).frame, offset + 1);
    for (const elapsedMs of [360, 800, 1600, 2400, 3300, 3599]) {
      assert.equal(petFeedingFrame({ food, elapsedMs }, true).frame, offset + 3);
    }
    assert.equal(petFeedingFrame({ food, elapsedMs: 3600 }, true).frame, offset + 7);
  }
});

test('feeding menus choose the available side and stay within narrow or offset surfaces', () => {
  const bounds = { x: 0, y: 0, width: 376, height: 72 };
  assert.deepEqual(petFeedingMenuRect({ x: 12, y: -2, width: 76, height: 76 }, bounds), {
    x: 92, y: 10, width: 104, height: 52,
  });
  assert.deepEqual(petFeedingMenuRect({ x: 288, y: -2, width: 76, height: 76 }, bounds), {
    x: 180, y: 10, width: 104, height: 52,
  });
  for (const surface of [bounds, { x: 0, y: 0, width: 320, height: 60 }, { x: -1920, y: 100, width: 1920, height: 1080 }]) {
    for (const x of [surface.x - 100, surface.x, surface.x + surface.width / 2, surface.x + surface.width + 100]) {
      for (const y of [surface.y - 100, surface.y + surface.height + 100]) {
        const menu = petFeedingMenuRect({ x, y, width: 76, height: 76 }, surface);
        assert.ok(menu.x >= surface.x && menu.x + menu.width <= surface.x + surface.width);
        assert.ok(menu.y >= surface.y && menu.y + menu.height <= surface.y + surface.height);
      }
    }
  }
});
